from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import re
import csv
import json
import uuid
import ipaddress
import tempfile
import logging
import bcrypt
import jwt
import httpx
import requests
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta, date as _date
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Response, Query, Form
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr

try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
    LLM_AVAILABLE = True
except Exception as _e:
    LLM_AVAILABLE = False
    logging.warning(f"emergentintegrations not available: {_e}")

# ---------- Setup ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Bright India Traders Finance")
api = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"

# ---------- Storage ----------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = os.environ.get("APP_NAME", "bit-finance")
_storage_key = None


def init_storage(force: bool = False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    try:
        resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        resp.raise_for_status()
        _storage_key = resp.json()["storage_key"]
        return _storage_key
    except Exception as e:
        logging.error(f"Storage init failed: {e}")
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key: raise HTTPException(503, "Storage unavailable")
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    if not key: raise HTTPException(503, "Storage unavailable")
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        _ = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": _storage_key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# ---------- Email (Emergent-managed Resend) ----------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "").strip()
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Bright India Traders")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO") or None

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host: return False
    try:
        ipaddress.ip_address(host); return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []
    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href"); self._text = []
    def handle_data(self, data):
        if self._href is not None: self._text.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text))); self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body: raise ValueError(f"Credentials ask forbidden: {p!r}")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")): continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r}")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Unsafe URL: {url!r}")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real: continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor host mismatch: {m.group(1)!r} vs {real!r}")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    """Send an email through Emergent's managed Resend. Fails soft — returns None if not configured."""
    if not EMAIL_KEY:
        logging.info(f"[email:skipped no key] to={to} subject={subject!r}")
        return None
    try:
        _assert_safe_email(subject, html)
    except ValueError as ge:
        logging.error(f"[email:guardrail] {ge}")
        return None
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO: payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception as e:
        logging.error(f"[email:send-fail] {e}")
        return None

# ---------- Auth ----------
def hash_password(pw: str) -> str: return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
def verify_password(pw: str, hashed: str) -> bool:
    try: return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception: return False

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {"sub": user_id, "email": email, "role": role, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    try: payload = jwt.decode(authorization[7:], JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError: raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError: raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user: raise HTTPException(401, "User not found")
    return user

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin": raise HTTPException(403, "Admin only")
    return user

def not_viewer(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") == "viewer": raise HTTPException(403, "Read-only user")
    return user

# ---------- Models ----------
class LoginIn(BaseModel):
    email: EmailStr; password: str

class TenderIn(BaseModel):
    tender_no: Optional[str] = ""
    department: str; name: str
    tender_date: Optional[str] = None
    closing_date: Optional[str] = None
    tender_value: float = 0; emd_amount: float = 0
    status: str = "Identified"
    responsible: Optional[str] = ""; notes: Optional[str] = ""

class ItemIn(BaseModel):
    tender_id: str; name: str
    quantity: float = 0; unit: str = "pcs"
    rate: float = 0; estimated_cost: float = 0

class TxnIn(BaseModel):
    date: str
    txn_type: Literal["expense", "income", "purchase", "refund", "ld", "reimbursement"] = "expense"
    tender_id: Optional[str] = None
    item_id: Optional[str] = None
    stage: Literal["pre_tender", "post_tender", "administration"]
    category: str
    description: Optional[str] = ""
    vendor: Optional[str] = ""
    amount: float
    quantity: Optional[float] = None
    rate: Optional[float] = None
    gst: Optional[float] = 0
    payment_status: Literal["requested", "approved", "paid", "payable", "rejected"] = "requested"
    paid_by: Optional[str] = ""
    account: Optional[str] = ""
    invoice_no: Optional[str] = ""; invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    document_id: Optional[str] = None
    remarks: Optional[str] = ""

class ApprovalAction(BaseModel):
    action: Literal["approve", "reject", "send_back"]
    remarks: Optional[str] = ""

class PayTxn(BaseModel):
    account: str; payment_date: str; bank_reference: Optional[str] = ""

class EBGIn(BaseModel):
    tender_id: str; amount: float; bank: str
    issue_date: str; expiry_date: str
    reference: Optional[str] = ""
    status: Literal["active", "released", "expired"] = "active"
    released_date: Optional[str] = None

class DocumentLinkIn(BaseModel):
    file_id: str
    tender_id: Optional[str] = None; txn_id: Optional[str] = None
    document_type: str
    notes: Optional[str] = ""

class InvoiceIn(BaseModel):
    tender_id: str; invoice_no: str
    invoice_date: str; due_date: Optional[str] = None
    amount: float; department: str
    remarks: Optional[str] = ""

class ReceiptIn(BaseModel):
    invoice_id: str; amount: float
    receipt_date: str; account: str
    bank_reference: Optional[str] = ""; ld_deducted: float = 0

class BankMatchIn(BaseModel):
    bank_txn_id: str; ledger_txn_id: str

class ReverseTxnIn(BaseModel):
    reason: str

class VendorIn(BaseModel):
    name: str; category: Optional[str] = ""; contact: Optional[str] = ""; gst: Optional[str] = ""

# ---------- Constants ----------
TENDER_STATUSES = [
    "Identified", "Under Evaluation", "Participating", "Submitted",
    "Technical Qualified", "Technically Disqualified", "Financially Opened",
    "L1", "Not L1", "AOC Received", "Execution", "Completed", "Cancelled",
]
CATEGORIES = {
    "pre_tender": ["EMD", "Stamp Paper", "Courier", "Sample", "Tender Filing"],
    "post_tender": ["Purchase", "Job Work", "Sample", "Courier", "Packing", "Transport", "Miscellaneous", "LD"],
    "administration": ["Salary", "Tender Software", "One-Time Expense", "Miscellaneous"],
}
ACCOUNTS = ["ICICI", "HDFC", "SBI", "Cash", "Dad", "Bharath"]
PAID_BY_OPTIONS = ["Company", "Dad", "Bharath", "Other"]
DOCUMENT_TYPES = [
    "tender_document", "aoc_contract", "bill_invoice", "payment_proof",
    "emd_proof", "ebg", "courier_proof", "sample_proof", "other",
]

# ---------- Utility ----------
def new_id() -> str: return str(uuid.uuid4())

async def next_sequence(name: str) -> int:
    doc = await db.counters.find_one_and_update({"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return doc["seq"] if doc and "seq" in doc else 1

async def next_tender_code() -> str:
    year = datetime.now(timezone.utc).year
    return f"BIT-{year}-{await next_sequence(f'tender-{year}'):03d}"

async def next_item_code(tender_code: str) -> str:
    return f"{tender_code}-I{await next_sequence(f'item-{tender_code}'):02d}"

async def next_txn_code() -> str:
    return f"TXN-{await next_sequence('txn'):06d}"

def now_iso() -> str: return datetime.now(timezone.utc).isoformat()

def app_url(path: str = "") -> str:
    base = os.environ.get("APP_PUBLIC_URL") or ""
    return (base.rstrip("/") + "/" + path.lstrip("/")) if base else "https://app.example.com" + "/" + path.lstrip("/")

# ---------- Audit Trail ----------
async def audit_write(entity: str, entity_id: str, action: str, user_email: str, before: Optional[dict] = None, after: Optional[dict] = None, note: str = ""):
    await db.audit.insert_one({
        "id": new_id(), "entity": entity, "entity_id": entity_id, "action": action,
        "user_email": user_email, "before": before, "after": after, "note": note,
        "at": now_iso(),
    })

# ---------- Notifications ----------
async def notify(*, to_email: Optional[str], to_user_id: Optional[str], event: str, title: str, message: str, link: Optional[str] = None, meta: Optional[dict] = None, email_html: Optional[str] = None, email_subject: Optional[str] = None):
    """Write in-app notification (visible in the bell) and optionally dispatch email."""
    doc = {
        "id": new_id(), "event": event, "title": title, "message": message,
        "link": link, "meta": meta or {},
        "to_email": to_email, "to_user_id": to_user_id,
        "read": False, "created_at": now_iso(),
    }
    await db.notifications.insert_one(dict(doc))
    if to_email and email_html and email_subject:
        try:
            await send_email(to=to_email, subject=email_subject, html=email_html)
        except Exception as e:
            logging.warning(f"notify email failed: {e}")


def _email_frame(title: str, body_html: str, cta_url: Optional[str] = None, cta_label: str = "Open in Bright India Traders") -> str:
    button = ""
    if cta_url:
        button = (f'<p style="margin:24px 0"><a href="{escape(cta_url)}" '
                  f'style="background:#1E1B4B;color:#fff;padding:10px 18px;border-radius:3px;'
                  f'text-decoration:none;font-family:Arial,sans-serif;font-size:14px">'
                  f'{escape(cta_label)}</a></p>')
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:#f8fafc;padding:24px 0"><tr><td align="center">'
        f'<table role="presentation" width="560" cellpadding="0" cellspacing="0" '
        f'style="background:#fff;border:1px solid #e2e8f0;border-radius:3px">'
        f'<tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif">'
        f'<div style="font-size:12px;color:#64748b;letter-spacing:1px;text-transform:uppercase">Bright India Traders · Finance</div>'
        f'<div style="font-size:18px;font-weight:600;color:#0f172a;margin-top:4px">{escape(title)}</div>'
        f'</td></tr><tr><td style="padding:24px;font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.6">'
        f'{body_html}{button}</td></tr>'
        f'<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8">'
        f'Sent by {escape(EMAIL_FROM_NAME)}. We never ask for your password or card details by email.'
        f'</td></tr></table></td></tr></table>'
    )

# ---------- Auth Routes ----------
@api.post("/auth/login")
async def login(payload: LoginIn):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = create_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)): return user

@api.post("/auth/logout")
async def logout(user: dict = Depends(get_current_user)): return {"ok": True}

@api.get("/masters")
async def masters(user: dict = Depends(get_current_user)):
    return {"statuses": TENDER_STATUSES, "categories": CATEGORIES, "accounts": ACCOUNTS,
            "document_types": DOCUMENT_TYPES, "paid_by": PAID_BY_OPTIONS}

# ---------- Notifications endpoints ----------
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    q = {"$or": [{"to_email": user["email"]}, {"to_user_id": user["id"]}, {"to_email": None, "to_user_id": None}]}
    if user.get("role") == "admin":
        q = {}  # admins see all
    docs = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(100).to_list(200)
    return docs

@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": nid}, {"$set": {"read": True}})
    return {"ok": True}

@api.post("/notifications/read-all")
async def mark_all_read(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({}, {"$set": {"read": True}})
    return {"ok": True}

# ---------- LLM PDF Extraction ----------
async def _extract_from_pdf(file: UploadFile, prompt: str, session_id: str) -> dict:
    if not LLM_AVAILABLE: raise HTTPException(503, "AI extraction not available")
    if not EMERGENT_KEY: raise HTTPException(503, "EMERGENT_LLM_KEY not configured")
    if not file.filename.lower().endswith(".pdf"): raise HTTPException(400, "Please upload a PDF file")
    data = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    try:
        tmp.write(data); tmp.close()
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=session_id,
            system_message=("You extract structured JSON from Indian government tender / contract PDFs. "
                "Return ONLY a raw JSON object — no prose, no markdown fences. "
                "Use null for missing text and 0 for missing numeric. Do not invent values."),
        ).with_model("gemini", "gemini-3.1-pro-preview")
        att = FileContentWithMimeType(file_path=tmp.name, mime_type="application/pdf")
        text = await chat.send_message(UserMessage(text=prompt, file_contents=[att]))
        text = text.strip() if isinstance(text, str) else str(text)
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"): text = text[4:].strip()
        s, e = text.find("{"), text.rfind("}")
        if s >= 0 and e > s: text = text[s:e+1]
        try: return json.loads(text)
        except Exception as e:
            logging.error(f"extract parse fail: {e}; raw={text[:400]}")
            raise HTTPException(422, "Could not parse extracted fields")
    finally:
        try: os.unlink(tmp.name)
        except Exception: pass

@api.post("/extract/tender")
async def extract_tender(file: UploadFile = File(...), user: dict = Depends(not_viewer)):
    prompt = (
        'Extract these fields from this tender document. Return ONLY JSON:\n'
        '{"tender_no": "gov ref no or null","name":"tender name or null",'
        '"department":"dept/ministry or null","tender_date":"YYYY-MM-DD or null",'
        '"closing_date":"YYYY-MM-DD or null","tender_value":number,"emd_amount":number}\n'
        'Do not include other keys.'
    )
    return await _extract_from_pdf(file, prompt, session_id=f"tender-extract-{new_id()[:8]}")

@api.post("/extract/aoc")
async def extract_aoc(file: UploadFile = File(...), user: dict = Depends(not_viewer)):
    prompt = (
        'Extract AOC/contract/PO fields. Return ONLY JSON:\n'
        '{"contract_no":"…","contract_date":"YYYY-MM-DD or null","contract_value":number,'
        '"delivery_date":"YYYY-MM-DD or null","items":[{"name":"…","quantity":number,'
        '"unit":"pcs/kg/etc","rate":number,"value":number}]}'
    )
    return await _extract_from_pdf(file, prompt, session_id=f"aoc-extract-{new_id()[:8]}")


@api.post("/extract/bill")
async def extract_bill(file: UploadFile = File(...), user: dict = Depends(not_viewer)):
    """AI-extract vendor, amount, invoice no, date, category hint from a supplier bill (PDF or image)."""
    if not LLM_AVAILABLE: raise HTTPException(503, "AI extraction not available")
    if not EMERGENT_KEY: raise HTTPException(503, "EMERGENT_LLM_KEY not configured")
    name = (file.filename or "").lower()
    is_pdf = name.endswith(".pdf")
    is_img = any(name.endswith(x) for x in (".png", ".jpg", ".jpeg", ".webp"))
    if not (is_pdf or is_img): raise HTTPException(400, "Upload a PDF or image")
    ext = name.rsplit(".", 1)[-1]
    mime = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}[ext]
    data = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False)
    try:
        tmp.write(data); tmp.close()
        prompt = (
            'Extract the following fields from this supplier bill / invoice / receipt. '
            'Return ONLY a raw JSON object:\n'
            '{"vendor":"supplier / party name or null",'
            ' "invoice_no":"bill or invoice number or null",'
            ' "invoice_date":"YYYY-MM-DD or null",'
            ' "amount":number (final total payable in ₹, digits only, no commas or currency),'
            ' "gst":number (GST amount if separately shown, else 0),'
            ' "category_hint":"one of: Yarn, Fabric, Weaving, Stitching, Packing, Transport, '
            'Courier, Sample, Purchase, Job Work, EMD, Stamp Paper, Tender Filing, Salary, '
            'Tender Software, One-Time Expense, Miscellaneous — best-fit or null",'
            ' "description":"1-line summary of what was billed or null"}'
        )
        chat = LlmChat(api_key=EMERGENT_KEY, session_id=f"bill-{new_id()[:8]}",
            system_message="You extract structured JSON from Indian supplier bills. Return raw JSON only. Use null / 0 for missing values.",
        ).with_model("gemini", "gemini-3.1-pro-preview")
        att = FileContentWithMimeType(file_path=tmp.name, mime_type=mime)
        text = await chat.send_message(UserMessage(text=prompt, file_contents=[att]))
        text = text.strip() if isinstance(text, str) else str(text)
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"): text = text[4:].strip()
        s, e = text.find("{"), text.rfind("}")
        if s >= 0 and e > s: text = text[s:e+1]
        try: return json.loads(text)
        except Exception as ex:
            logging.error(f"bill parse fail: {ex}; raw={text[:400]}")
            raise HTTPException(422, "Could not parse bill fields")
    finally:
        try: os.unlink(tmp.name)
        except Exception: pass

@api.post("/tenders/{tender_id}/apply-aoc")
async def apply_aoc(tender_id: str, body: dict, user: dict = Depends(not_viewer)):
    tender = await db.tenders.find_one({"id": tender_id})
    if not tender: raise HTTPException(404, "Tender not found")
    updates = {}
    for k in ("contract_no", "contract_date", "delivery_date"):
        if body.get(k): updates[k] = body[k]
    if body.get("contract_value") is not None:
        updates["contract_value"] = float(body["contract_value"] or 0)
        if not tender.get("tender_value"):
            updates["tender_value"] = float(body["contract_value"] or 0)
    updates["status"] = "AOC Received"
    if updates: await db.tenders.update_one({"id": tender_id}, {"$set": updates})
    created = []
    for it in (body.get("items") or []):
        code = await next_item_code(tender["code"])
        rate = float(it.get("rate") or 0); qty = float(it.get("quantity") or 0)
        est = float(it.get("value") or (rate * qty))
        doc = {"id": new_id(), "code": code, "tender_id": tender_id,
               "name": it.get("name") or "Item", "quantity": qty,
               "unit": it.get("unit") or "pcs", "rate": rate,
               "estimated_cost": est, "created_at": now_iso()}
        await db.items.insert_one(dict(doc)); doc.pop("_id", None); created.append(doc)
    return {"ok": True, "items_added": len(created), "items": created}

# ---------- Tenders ----------
@api.get("/tenders")
async def list_tenders(user: dict = Depends(get_current_user), status: Optional[str] = None):
    q = {"status": status} if status else {}
    return await db.tenders.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.post("/tenders")
async def create_tender(payload: TenderIn, user: dict = Depends(not_viewer)):
    code = await next_tender_code()
    doc = {"id": new_id(), "code": code, **payload.model_dump(),
           "created_at": now_iso(), "created_by": user["email"]}
    await db.tenders.insert_one(dict(doc)); doc.pop("_id", None)
    await audit_write("tender", doc["id"], "create", user["email"], after=doc)
    return doc

@api.get("/tenders/{tender_id}")
async def get_tender(tender_id: str, user: dict = Depends(get_current_user)):
    t = await db.tenders.find_one({"id": tender_id}, {"_id": 0})
    if not t: raise HTTPException(404, "Tender not found")
    return t

@api.patch("/tenders/{tender_id}")
async def update_tender(tender_id: str, payload: TenderIn, user: dict = Depends(not_viewer)):
    before = await db.tenders.find_one({"id": tender_id}, {"_id": 0})
    await db.tenders.update_one({"id": tender_id}, {"$set": payload.model_dump()})
    after = await db.tenders.find_one({"id": tender_id}, {"_id": 0})
    await audit_write("tender", tender_id, "update", user["email"], before=before, after=after)
    return after

@api.post("/tenders/{tender_id}/status")
async def update_status(tender_id: str, body: dict, user: dict = Depends(not_viewer)):
    status = body.get("status")
    if status not in TENDER_STATUSES: raise HTTPException(400, "Invalid status")
    await db.tenders.update_one({"id": tender_id}, {"$set": {"status": status}})
    await audit_write("tender", tender_id, "status_change", user["email"], after={"status": status})
    return {"ok": True}

# ---------- Items ----------
@api.get("/items")
async def list_items(tender_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"tender_id": tender_id} if tender_id else {}
    return await db.items.find(q, {"_id": 0}).to_list(1000)

@api.post("/items")
async def create_item(payload: ItemIn, user: dict = Depends(not_viewer)):
    tender = await db.tenders.find_one({"id": payload.tender_id})
    if not tender: raise HTTPException(404, "Tender not found")
    code = await next_item_code(tender["code"])
    doc = {"id": new_id(), "code": code, **payload.model_dump(), "created_at": now_iso()}
    await db.items.insert_one(dict(doc)); doc.pop("_id", None)
    return doc

@api.delete("/items/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(require_admin)):
    await db.items.delete_one({"id": item_id}); return {"ok": True}

# ---------- Transactions ----------
def _txn_date_filter(period: Optional[str]) -> Optional[dict]:
    if not period: return None
    today = _date.today()
    if period == "today": s = e = today
    elif period == "yesterday": s = e = today - timedelta(days=1)
    elif period == "last_7": s = today - timedelta(days=6); e = today
    elif period == "last_30": s = today - timedelta(days=29); e = today
    elif period == "this_month": s = today.replace(day=1); e = today
    elif period == "last_month":
        first_this = today.replace(day=1); e = first_this - timedelta(days=1); s = e.replace(day=1)
    elif period == "this_year": s = today.replace(month=1, day=1); e = today
    else: return None
    return {"date": {"$gte": s.isoformat(), "$lte": e.isoformat()}}


@api.get("/transactions")
async def list_txns(
    tender_id: Optional[str] = None, item_id: Optional[str] = None,
    stage: Optional[str] = None, payment_status: Optional[str] = None,
    category: Optional[str] = None, paid_by: Optional[str] = None,
    account: Optional[str] = None, txn_type: Optional[str] = None,
    period: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    missing_proof: Optional[bool] = None, reconciled: Optional[bool] = None,
    q: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query = {}
    if tender_id: query["tender_id"] = tender_id
    if item_id: query["item_id"] = item_id
    if stage: query["stage"] = stage
    if payment_status: query["payment_status"] = payment_status
    if category: query["category"] = category
    if paid_by: query["paid_by"] = paid_by
    if account: query["account"] = account
    if txn_type: query["txn_type"] = txn_type
    if reconciled is not None: query["reconciled"] = reconciled
    if missing_proof: query["document_id"] = None
    df = _txn_date_filter(period)
    if df: query.update(df)
    elif date_from or date_to:
        r = {}
        if date_from: r["$gte"] = date_from
        if date_to: r["$lte"] = date_to
        query["date"] = r
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"code": rx}, {"vendor": rx}, {"description": rx}, {"invoice_no": rx}, {"category": rx}]
    txns = await db.transactions.find(query, {"_id": 0}).sort("date", -1).to_list(3000)
    total = sum((t.get("amount") or 0) if t.get("txn_type") != "income" else 0 for t in txns)
    income = sum((t.get("amount") or 0) if t.get("txn_type") == "income" else 0 for t in txns)
    return {"items": txns, "count": len(txns), "total_expense": total, "total_income": income}


@api.post("/transactions")
async def create_txn(payload: TxnIn, user: dict = Depends(not_viewer)):
    code = await next_txn_code()
    doc = {"id": new_id(), "code": code, **payload.model_dump(),
           "approval_status": "pending" if payload.payment_status != "paid" else "approved",
           "approved_by": None, "approved_at": None, "payment_date": None,
           "bank_reference": "", "reconciled": False, "is_reversed": False,
           "created_at": now_iso(), "created_by": user["email"]}
    if user["role"] == "admin" and payload.payment_status in ("approved", "paid"):
        doc["approval_status"] = "approved"; doc["approved_by"] = user["email"]; doc["approved_at"] = now_iso()
    await db.transactions.insert_one(dict(doc)); doc.pop("_id", None)
    await audit_write("transaction", doc["id"], "create", user["email"], after=doc)
    # Notify admins if requested
    if payload.payment_status == "requested":
        admin = await db.users.find_one({"role": "admin"}, {"_id": 0})
        if admin:
            tender = await db.tenders.find_one({"id": payload.tender_id}, {"_id": 0}) if payload.tender_id and payload.tender_id != "COMPANY" else None
            tender_str = tender["code"] if tender else (payload.tender_id or "Company")
            body = (
                f'<p>A new expense has been submitted for your approval.</p>'
                f'<table cellpadding="6" cellspacing="0" style="border:1px solid #e2e8f0;width:100%">'
                f'<tr><td style="color:#64748b">Transaction</td><td><strong>{escape(code)}</strong></td></tr>'
                f'<tr><td style="color:#64748b">Tender</td><td>{escape(str(tender_str))}</td></tr>'
                f'<tr><td style="color:#64748b">Category</td><td>{escape(payload.category)}</td></tr>'
                f'<tr><td style="color:#64748b">Amount</td><td><strong>₹{payload.amount:,.0f}</strong></td></tr>'
                f'<tr><td style="color:#64748b">Requested by</td><td>{escape(user["email"])}</td></tr>'
                f'<tr><td style="color:#64748b">Description</td><td>{escape(payload.description or "—")}</td></tr>'
                f'</table>'
            )
            await notify(to_email=admin["email"], to_user_id=admin["id"],
                event="approval_requested",
                title=f"New expense awaiting approval · ₹{payload.amount:,.0f}",
                message=f"{code} · {payload.category} for {tender_str}",
                link=f"/approvals",
                meta={"txn_id": doc["id"], "code": code, "amount": payload.amount},
                email_html=_email_frame("New expense to approve", body, cta_url="https://bid-ledger-system.preview.emergentagent.com/approvals", cta_label="Review in dashboard"),
                email_subject=f"New expense to approve · {code} · ₹{payload.amount:,.0f}",
            )
    return doc

@api.get("/transactions/{txn_id}")
async def get_txn(txn_id: str, user: dict = Depends(get_current_user)):
    t = await db.transactions.find_one({"id": txn_id}, {"_id": 0})
    if not t: raise HTTPException(404, "Not found")
    return t

@api.get("/transactions/{txn_id}/details")
async def get_txn_details(txn_id: str, user: dict = Depends(get_current_user)):
    t = await db.transactions.find_one({"id": txn_id}, {"_id": 0})
    if not t: raise HTTPException(404, "Not found")
    tender = await db.tenders.find_one({"id": t.get("tender_id")}, {"_id": 0}) if t.get("tender_id") and t["tender_id"] != "COMPANY" else None
    item = await db.items.find_one({"id": t.get("item_id")}, {"_id": 0}) if t.get("item_id") else None
    docs = await db.documents.find({"txn_id": txn_id}, {"_id": 0}).to_list(50)
    if t.get("document_id"):
        f = await db.files.find_one({"id": t["document_id"], "is_deleted": False}, {"_id": 0})
        if f: docs.append({"id": None, "file_id": f["id"], "document_type": "bill_invoice", "file": f, "linked_at": t.get("created_at")})
    for d in docs:
        if not d.get("file"):
            d["file"] = await db.files.find_one({"id": d["file_id"], "is_deleted": False}, {"_id": 0})
    bank = await db.bank_txns.find_one({"matched_txn_id": txn_id}, {"_id": 0}) if t.get("reconciled") else None
    history = await db.audit.find({"entity": "transaction", "entity_id": txn_id}, {"_id": 0}).sort("at", 1).to_list(100)
    return {"transaction": t, "tender": tender, "item": item, "documents": docs, "bank": bank, "history": history}

@api.post("/transactions/{txn_id}/approve")
async def approve_txn(txn_id: str, body: ApprovalAction, user: dict = Depends(require_admin)):
    existing = await db.transactions.find_one({"id": txn_id})
    if not existing: raise HTTPException(404, "Not found")
    self_approve = (existing.get("created_by") or "").lower() == user["email"].lower()
    update = {"approved_by": user["email"], "approved_at": now_iso(), "approval_remarks": body.remarks}
    if body.action == "approve":
        update["approval_status"] = "approved"; update["payment_status"] = "approved"
    elif body.action == "reject":
        update["approval_status"] = "rejected"; update["payment_status"] = "rejected"
    else:
        update["approval_status"] = "clarification"
    if self_approve:
        update["self_approved"] = True
    await db.transactions.update_one({"id": txn_id}, {"$set": update})
    audit_note = f"self-approved: {body.remarks or ''}" if self_approve else (body.remarks or "")
    await audit_write("transaction", txn_id, f"approval:{body.action}{' (self)' if self_approve else ''}", user["email"], after=update, note=audit_note)
    # Notify requester
    requester_email = existing.get("created_by")
    if requester_email:
        verb = {"approve": "approved", "reject": "rejected", "send_back": "sent back for clarification"}[body.action]
        req_user = await db.users.find_one({"email": requester_email}, {"_id": 0})
        body_html = (f'<p>Your expense <strong>{escape(existing["code"])}</strong> for '
                     f'<strong>₹{existing["amount"]:,.0f}</strong> ({escape(existing["category"])}) '
                     f'has been <strong>{verb}</strong> by {escape(user["email"])}.</p>'
                     f'{"<p><em>" + escape(body.remarks) + "</em></p>" if body.remarks else ""}')
        await notify(to_email=requester_email, to_user_id=req_user["id"] if req_user else None,
            event=f"approval_{body.action}",
            title=f"Expense {verb} · {existing['code']}",
            message=f"₹{existing['amount']:,.0f} · {existing['category']}",
            link=f"/transactions?txn={txn_id}",
            meta={"txn_id": txn_id},
            email_html=_email_frame(f"Expense {verb}", body_html),
            email_subject=f"Your expense {existing['code']} was {verb}")
    return {"ok": True}

@api.post("/transactions/{txn_id}/pay")
async def pay_txn(txn_id: str, body: PayTxn, user: dict = Depends(not_viewer)):
    existing = await db.transactions.find_one({"id": txn_id})
    if not existing: raise HTTPException(404, "Not found")
    upd = {"payment_status": "paid", "payment_date": body.payment_date,
           "account": body.account, "bank_reference": body.bank_reference}
    await db.transactions.update_one({"id": txn_id}, {"$set": upd})
    await audit_write("transaction", txn_id, "paid", user["email"], after=upd)
    # Notify requester
    if existing.get("created_by") and existing["created_by"].lower() != user["email"].lower():
        req_user = await db.users.find_one({"email": existing["created_by"]}, {"_id": 0})
        body_html = (f'<p>Payment of <strong>₹{existing["amount"]:,.0f}</strong> for '
                     f'<strong>{escape(existing["code"])}</strong> ({escape(existing["category"])}) '
                     f'was completed on {escape(body.payment_date)} via {escape(body.account)}.</p>')
        await notify(to_email=existing["created_by"], to_user_id=req_user["id"] if req_user else None,
            event="payment_completed",
            title=f"Payment completed · {existing['code']}",
            message=f"₹{existing['amount']:,.0f} via {body.account}",
            link=f"/transactions?txn={txn_id}",
            meta={"txn_id": txn_id},
            email_html=_email_frame("Payment completed", body_html),
            email_subject=f"Payment completed · {existing['code']}")
    return {"ok": True}

@api.post("/transactions/{txn_id}/reverse")
async def reverse_txn(txn_id: str, body: ReverseTxnIn, user: dict = Depends(require_admin)):
    existing = await db.transactions.find_one({"id": txn_id})
    if not existing: raise HTTPException(404, "Not found")
    if existing.get("is_reversed"): raise HTTPException(400, "Already reversed")
    # Create a mirroring reversal txn with negative amount
    code = await next_txn_code()
    rev = dict(existing); rev.pop("_id", None)
    rev.update({
        "id": new_id(), "code": code, "amount": -abs(existing["amount"]),
        "description": f"Reversal of {existing['code']}: {body.reason}",
        "payment_status": "paid", "approval_status": "approved",
        "approved_by": user["email"], "approved_at": now_iso(),
        "reconciled": False, "is_reversed": False,
        "reverses_txn_id": existing["id"],
        "created_at": now_iso(), "created_by": user["email"],
    })
    await db.transactions.insert_one(dict(rev))
    await db.transactions.update_one({"id": txn_id}, {"$set": {"is_reversed": True, "reversed_by_txn": code, "reversed_reason": body.reason}})
    await audit_write("transaction", txn_id, "reverse", user["email"], note=body.reason, after={"reversed_by": code})
    rev.pop("_id", None)
    return {"ok": True, "reversal": rev}

# ---------- Search ----------
@api.get("/search")
async def global_search(q: str, user: dict = Depends(get_current_user)):
    if not q or len(q) < 2: return {"results": []}
    rx = {"$regex": re.escape(q), "$options": "i"}
    results = []
    async for t in db.tenders.find({"$or": [{"code": rx}, {"name": rx}, {"tender_no": rx}, {"department": rx}]}, {"_id": 0}).limit(10):
        results.append({"type": "tender", "id": t["id"], "code": t["code"], "title": t["name"], "sub": t.get("department", ""), "link": f"/tenders/{t['id']}"})
    async for tx in db.transactions.find({"$or": [{"code": rx}, {"vendor": rx}, {"description": rx}, {"invoice_no": rx}]}, {"_id": 0}).limit(15):
        results.append({"type": "transaction", "id": tx["id"], "code": tx["code"], "title": f"{tx.get('category','')} · ₹{tx.get('amount',0):,.0f}", "sub": tx.get("vendor") or tx.get("description") or "", "link": f"/transactions?txn={tx['id']}"})
    async for it in db.items.find({"$or": [{"code": rx}, {"name": rx}]}, {"_id": 0}).limit(10):
        results.append({"type": "item", "id": it["id"], "code": it["code"], "title": it["name"], "sub": it["code"], "link": f"/tenders/{it['tender_id']}"})
    async for inv in db.invoices.find({"$or": [{"invoice_no": rx}, {"department": rx}]}, {"_id": 0}).limit(10):
        results.append({"type": "invoice", "id": inv["id"], "code": inv["invoice_no"], "title": inv["invoice_no"], "sub": inv.get("department", ""), "link": f"/receivables"})
    return {"results": results}

# ---------- Vendors ----------
@api.get("/vendors")
async def list_vendors(user: dict = Depends(get_current_user)):
    saved = await db.vendors.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    # Also include distinct vendors from transactions not yet in master
    txn_vendors = await db.transactions.distinct("vendor")
    saved_names = {v["name"] for v in saved}
    for v in txn_vendors:
        if v and v not in saved_names:
            saved.append({"name": v, "id": None, "from_txns": True})
    return saved

@api.post("/vendors")
async def create_vendor(payload: VendorIn, user: dict = Depends(not_viewer)):
    if not payload.name.strip(): raise HTTPException(400, "Name required")
    existing = await db.vendors.find_one({"name": payload.name.strip()})
    if existing: return {"id": existing["id"], "name": existing["name"]}
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.vendors.insert_one(dict(doc)); doc.pop("_id", None)
    return doc

# ---------- EBG ----------
@api.get("/ebg")
async def list_ebg(user: dict = Depends(get_current_user)):
    return await db.ebg.find({}, {"_id": 0}).sort("issue_date", -1).to_list(1000)

@api.post("/ebg")
async def create_ebg(payload: EBGIn, user: dict = Depends(not_viewer)):
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.ebg.insert_one(dict(doc)); doc.pop("_id", None)
    return doc

@api.post("/ebg/{ebg_id}/release")
async def release_ebg(ebg_id: str, body: dict = None, user: dict = Depends(not_viewer)):
    body = body or {}
    rd = body.get("released_date") or _date.today().isoformat()
    await db.ebg.update_one({"id": ebg_id}, {"$set": {"status": "released", "released_date": rd}})
    return {"ok": True}

# ---------- Documents ----------
@api.post("/documents")
async def link_document(payload: DocumentLinkIn, user: dict = Depends(not_viewer)):
    if payload.document_type not in DOCUMENT_TYPES: raise HTTPException(400, "Invalid type")
    if not (payload.tender_id or payload.txn_id): raise HTTPException(400, "Must link to tender or txn")
    doc = {"id": new_id(), "file_id": payload.file_id, "tender_id": payload.tender_id,
           "txn_id": payload.txn_id, "document_type": payload.document_type,
           "notes": payload.notes, "linked_by": user["email"], "linked_at": now_iso()}
    await db.documents.insert_one(dict(doc)); doc.pop("_id", None)
    return doc

@api.get("/documents")
async def list_documents(tender_id: Optional[str] = None, txn_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if tender_id: q["tender_id"] = tender_id
    if txn_id: q["txn_id"] = txn_id
    docs = await db.documents.find(q, {"_id": 0}).sort("linked_at", -1).to_list(500)
    for d in docs:
        d["file"] = await db.files.find_one({"id": d["file_id"], "is_deleted": False}, {"_id": 0})
    return [d for d in docs if d.get("file")]

@api.delete("/documents/{doc_id}")
async def unlink_document(doc_id: str, user: dict = Depends(not_viewer)):
    d = await db.documents.find_one({"id": doc_id})
    if not d: raise HTTPException(404, "Not found")
    await db.documents.delete_one({"id": doc_id})
    await db.files.update_one({"id": d["file_id"]}, {"$set": {"is_deleted": True}})
    return {"ok": True}

# ---------- Invoices / Receivables ----------
@api.get("/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    invoices = await db.invoices.find({}, {"_id": 0}).sort("invoice_date", -1).to_list(1000)
    for inv in invoices:
        receipts = await db.receipts.find({"invoice_id": inv["id"]}, {"_id": 0}).to_list(500)
        inv["received"] = sum(r["amount"] for r in receipts)
        inv["ld_deducted"] = sum(r.get("ld_deducted", 0) for r in receipts)
        inv["outstanding"] = round(inv["amount"] - inv["received"] - inv["ld_deducted"], 2)
    return invoices

@api.post("/invoices")
async def create_invoice(payload: InvoiceIn, user: dict = Depends(not_viewer)):
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.invoices.insert_one(dict(doc)); doc.pop("_id", None)
    return doc

@api.post("/receipts")
async def record_receipt(payload: ReceiptIn, user: dict = Depends(not_viewer)):
    inv = await db.invoices.find_one({"id": payload.invoice_id})
    if not inv: raise HTTPException(404, "Invoice not found")
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.receipts.insert_one(dict(doc))
    tcode = await next_txn_code()
    await db.transactions.insert_one({
        "id": new_id(), "code": tcode, "date": payload.receipt_date,
        "txn_type": "income", "tender_id": inv["tender_id"], "item_id": None,
        "stage": "post_tender", "category": "Department Payment",
        "description": f"Payment received for {inv['invoice_no']}",
        "vendor": inv["department"], "amount": payload.amount,
        "payment_status": "paid", "account": payload.account,
        "bank_reference": payload.bank_reference, "approval_status": "approved",
        "reconciled": False, "is_reversed": False,
        "created_at": now_iso(), "created_by": user["email"],
    })
    doc.pop("_id", None); return doc

# ---------- Bank ----------
@api.post("/bank/upload")
async def upload_bank(file: UploadFile = File(...), account: str = Query(...), user: dict = Depends(not_viewer)):
    text = (await file.read()).decode(errors="ignore")
    reader = csv.DictReader(io.StringIO(text)); inserted = 0
    for row in reader:
        date = row.get("Date") or row.get("date") or row.get("Txn Date") or ""
        desc = row.get("Description") or row.get("Narration") or row.get("Particulars") or ""
        debit = float((row.get("Debit") or row.get("Withdrawal") or "0").replace(",", "") or 0)
        credit = float((row.get("Credit") or row.get("Deposit") or "0").replace(",", "") or 0)
        ref = row.get("Ref No") or row.get("Reference") or row.get("Cheque No") or ""
        amt = credit - debit
        await db.bank_txns.insert_one({"id": new_id(), "account": account, "date": date,
            "description": desc, "amount": amt, "direction": "credit" if amt > 0 else "debit",
            "reference": ref, "matched_txn_id": None, "reconciled": False,
            "created_at": now_iso()})
        inserted += 1
    return {"inserted": inserted}

@api.post("/bank/manual")
async def add_bank_manual(body: dict, user: dict = Depends(not_viewer)):
    amt = float(body["amount"])
    doc = {"id": new_id(), "account": body["account"], "date": body["date"],
           "description": body.get("description", ""), "amount": amt,
           "direction": "credit" if amt > 0 else "debit",
           "reference": body.get("reference", ""), "matched_txn_id": None,
           "reconciled": False, "created_at": now_iso()}
    await db.bank_txns.insert_one(dict(doc)); doc.pop("_id", None); return doc

@api.get("/bank")
async def list_bank(reconciled: Optional[bool] = None, user: dict = Depends(get_current_user)):
    q = {} if reconciled is None else {"reconciled": reconciled}
    return await db.bank_txns.find(q, {"_id": 0}).sort("date", -1).to_list(2000)

@api.post("/bank/match")
async def match_bank(body: BankMatchIn, user: dict = Depends(not_viewer)):
    await db.bank_txns.update_one({"id": body.bank_txn_id}, {"$set": {"matched_txn_id": body.ledger_txn_id, "reconciled": True}})
    await db.transactions.update_one({"id": body.ledger_txn_id}, {"$set": {"reconciled": True}})
    await audit_write("transaction", body.ledger_txn_id, "reconciled", user["email"], after={"bank_txn_id": body.bank_txn_id})
    return {"ok": True}

# ---------- Files ----------
@api.post("/files/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(not_viewer)):
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
    file_id = new_id()
    path = f"{APP_NAME}/uploads/{user['id']}/{file_id}.{ext}"
    data = await file.read(); ct = file.content_type or "application/octet-stream"
    result = put_object(path, data, ct)
    rec = {"id": file_id, "storage_path": result["path"], "original_filename": file.filename,
           "content_type": ct, "size": result.get("size", len(data)),
           "is_deleted": False, "uploaded_by": user["email"], "created_at": now_iso()}
    await db.files.insert_one(dict(rec)); rec.pop("_id", None); return rec

@api.get("/files/{file_id}/download")
async def download_file(file_id: str, authorization: Optional[str] = Header(None), auth: Optional[str] = Query(None)):
    header = authorization or (f"Bearer {auth}" if auth else None)
    if not header: raise HTTPException(401, "Not authenticated")
    try: jwt.decode(header[7:], JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception: raise HTTPException(401, "Invalid token")
    rec = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not rec: raise HTTPException(404, "Not found")
    data, ct = get_object(rec["storage_path"])
    return Response(content=data, media_type=rec.get("content_type", ct))

# ---------- Reports ----------
@api.get("/reports/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    txns = await db.transactions.find({}, {"_id": 0}).to_list(5000)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(1000)
    receipts = await db.receipts.find({}, {"_id": 0}).to_list(2000)
    ebg = await db.ebg.find({"status": "active"}, {"_id": 0}).to_list(200)

    revenue = sum(r["amount"] for r in receipts)
    total_receivable = 0.0
    for inv in invoices:
        rs = sum(r["amount"] for r in receipts if r["invoice_id"] == inv["id"])
        ls = sum(r.get("ld_deducted", 0) for r in receipts if r["invoice_id"] == inv["id"])
        total_receivable += max(inv["amount"] - rs - ls, 0)
    total_payable = sum(t["amount"] for t in txns if t.get("payment_status") == "payable")
    pending_approvals = sum(1 for t in txns if t.get("approval_status") == "pending")
    pre_cost = sum(t["amount"] for t in txns if t.get("stage") == "pre_tender" and t["txn_type"] != "income")
    post_cost = sum(t["amount"] for t in txns if t.get("stage") == "post_tender" and t["txn_type"] not in ("income", "refund"))
    admin_cost = sum(t["amount"] for t in txns if t.get("stage") == "administration")
    ebg_blocked = sum(e["amount"] for e in ebg)
    emd_paid = sum(t["amount"] for t in txns if t.get("category") == "EMD" and t["txn_type"] == "expense")
    emd_refund = sum(t["amount"] for t in txns if t.get("category") == "EMD" and t["txn_type"] == "refund")
    emd_outstanding = emd_paid - emd_refund

    active_tenders = await db.tenders.count_documents({"status": {"$in": ["Participating", "L1", "AOC Received", "Execution"]}})
    total_tenders = await db.tenders.count_documents({})

    active_tender_docs = await db.tenders.find({"status": {"$in": ["L1", "AOC Received", "Execution", "Completed"]}}, {"_id": 0}).to_list(500)
    tender_value_total = sum(float(t.get("contract_value") or t.get("tender_value") or 0) for t in active_tender_docs)

    tenders_by_id = {t["id"]: t for t in await db.tenders.find({}, {"_id": 0}).to_list(1000)}
    today = _date.today(); expiring = []
    for e in ebg:
        try: exp = _date.fromisoformat(e["expiry_date"])
        except Exception: continue
        days = (exp - today).days
        if days <= 60:
            expiring.append({"id": e["id"], "amount": e["amount"], "expiry_date": e["expiry_date"],
                "days_left": days, "bank": e.get("bank"),
                "tender_code": tenders_by_id.get(e.get("tender_id"), {}).get("code", "-"),
                "severity": "critical" if days <= 7 else ("warning" if days <= 30 else "notice")})
    expiring.sort(key=lambda x: x["days_left"])

    # Action Required counts
    missing_proof = sum(1 for t in txns if not t.get("document_id") and t.get("payment_status") in ("paid", "approved"))
    unmatched_bank = await db.bank_txns.count_documents({"reconciled": False})
    payables_overdue = sum(1 for t in txns if t.get("payment_status") == "payable" and t.get("due_date") and t["due_date"] < today.isoformat())
    receivables_overdue = 0
    for inv in invoices:
        if inv.get("due_date") and inv["due_date"] < today.isoformat():
            rs = sum(r["amount"] for r in receipts if r["invoice_id"] == inv["id"])
            ls = sum(r.get("ld_deducted", 0) for r in receipts if r["invoice_id"] == inv["id"])
            if inv["amount"] - rs - ls > 0.01: receivables_overdue += 1

    # Personal reimbursement rollup
    personal = {}
    for t in txns:
        if t.get("paid_by") in ("Dad", "Bharath") and t.get("payment_status") in ("paid", "approved") and not t.get("is_reversed"):
            k = t["paid_by"]; personal[k] = personal.get(k, 0) + t["amount"]

    return {
        "revenue": revenue, "receivables": total_receivable, "payables": total_payable,
        "pending_approvals": pending_approvals,
        "pre_tender_cost": pre_cost, "post_tender_cost": post_cost, "admin_cost": admin_cost,
        "total_actual_cost": pre_cost + post_cost,
        "gross_contribution": revenue - pre_cost - post_cost,
        "operating_contribution": revenue - pre_cost - post_cost - admin_cost,
        "ebg_blocked": ebg_blocked, "emd_outstanding": emd_outstanding,
        "active_tenders": active_tenders, "total_tenders": total_tenders,
        "tender_value_total": tender_value_total, "ebg_expiring": expiring,
        "action_required": {
            "pending_approvals": pending_approvals,
            "missing_proof": missing_proof,
            "unmatched_bank": unmatched_bank,
            "payables_overdue": payables_overdue,
            "receivables_overdue": receivables_overdue,
            "ebg_expiring_soon": len([e for e in expiring if e["severity"] in ("critical", "warning")]),
        },
        "personal_reimbursement": personal,
    }

@api.get("/reports/tender-pnl/{tender_id}")
async def tender_pnl(tender_id: str, user: dict = Depends(get_current_user)):
    tender = await db.tenders.find_one({"id": tender_id}, {"_id": 0})
    if not tender: raise HTTPException(404, "Tender not found")
    items = await db.items.find({"tender_id": tender_id}, {"_id": 0}).to_list(200)
    txns = await db.transactions.find({"tender_id": tender_id}, {"_id": 0}).to_list(2000)
    invoices = await db.invoices.find({"tender_id": tender_id}, {"_id": 0}).to_list(200)
    receipts_all = await db.receipts.find({}, {"_id": 0}).to_list(2000)
    revenue = sum(r["amount"] for r in receipts_all for inv in invoices if r["invoice_id"] == inv["id"])
    def cat_group(stage):
        out = {}
        for t in txns:
            if t.get("stage") != stage or t.get("txn_type") == "income": continue
            sign = -1 if t.get("txn_type") == "refund" else 1
            out[t["category"]] = out.get(t["category"], 0) + sign * t["amount"]
        return out
    pre = cat_group("pre_tender"); post = cat_group("post_tender")
    pre_total, post_total = sum(pre.values()), sum(post.values())
    total_cost = pre_total + post_total
    contribution = revenue - total_cost
    margin = (contribution / revenue * 100) if revenue else 0
    item_pnl = []
    for it in items:
        item_cost = sum(t["amount"] for t in txns if t.get("item_id") == it["id"] and t.get("txn_type") not in ("income", "refund"))
        item_rev = (it.get("quantity", 0) or 0) * (it.get("rate", 0) or 0)
        item_pnl.append({"item_id": it["id"], "code": it.get("code"), "name": it["name"],
            "quantity": it.get("quantity"), "rate": it.get("rate"),
            "revenue": item_rev, "cost": item_cost, "profit": item_rev - item_cost,
            "margin": (item_rev - item_cost) / item_rev * 100 if item_rev else 0,
            "estimated_cost": it.get("estimated_cost", 0),
            "variance": item_cost - (it.get("estimated_cost", 0) or 0)})
    return {"tender": tender, "revenue": revenue, "pre_tender": pre, "post_tender": post,
            "pre_total": pre_total, "post_total": post_total, "total_cost": total_cost,
            "contribution": contribution, "margin": margin, "items": item_pnl}

def _age_bucket(days: int) -> str:
    if days <= 0: return "current"
    if days <= 30: return "0-30"
    if days <= 60: return "31-60"
    if days <= 90: return "61-90"
    return "90+"

@api.get("/reports/payables")
async def payables(user: dict = Depends(get_current_user)):
    txns = await db.transactions.find({"payment_status": "payable"}, {"_id": 0}).to_list(1000)
    tenders = {t["id"]: t for t in await db.tenders.find({}, {"_id": 0}).to_list(1000)}
    today = _date.today()
    for t in txns:
        t["tender_code"] = tenders.get(t.get("tender_id"), {}).get("code", "-")
        days_od = 0
        if t.get("due_date"):
            try:
                due = _date.fromisoformat(t["due_date"])
                days_od = (today - due).days
            except Exception: days_od = 0
        t["days_overdue"] = days_od
        t["ageing"] = _age_bucket(days_od)
    return txns

@api.get("/reports/receivables")
async def receivables(user: dict = Depends(get_current_user)):
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(1000)
    tenders = {t["id"]: t for t in await db.tenders.find({}, {"_id": 0}).to_list(1000)}
    receipts = await db.receipts.find({}, {"_id": 0}).to_list(2000)
    today = _date.today(); out = []
    for inv in invoices:
        rs = sum(r["amount"] for r in receipts if r["invoice_id"] == inv["id"])
        ls = sum(r.get("ld_deducted", 0) for r in receipts if r["invoice_id"] == inv["id"])
        outstanding = inv["amount"] - rs - ls
        if outstanding > 0.01:
            days_od = 0
            if inv.get("due_date"):
                try:
                    due = _date.fromisoformat(inv["due_date"])
                    days_od = (today - due).days
                except Exception: days_od = 0
            inv["received"] = rs; inv["outstanding"] = outstanding
            inv["tender_code"] = tenders.get(inv.get("tender_id"), {}).get("code", "-")
            inv["days_overdue"] = days_od
            inv["ageing"] = _age_bucket(days_od)
            out.append(inv)
    return out

@api.get("/reports/personal-payments")
async def personal_payments(user: dict = Depends(get_current_user)):
    """Rollup of payments made by Dad/Bharath/Other personally that need reimbursement."""
    txns = await db.transactions.find({"paid_by": {"$in": ["Dad", "Bharath", "Other"]}}, {"_id": 0}).to_list(2000)
    tenders = {t["id"]: t for t in await db.tenders.find({}, {"_id": 0}).to_list(1000)}
    # Group by paid_by
    by_person = {}
    for t in txns:
        if t.get("is_reversed"): continue
        p = t["paid_by"]; by_person.setdefault(p, {"total": 0.0, "transactions": []})
        by_person[p]["total"] += t["amount"] * (-1 if t["txn_type"] == "reimbursement" else 1)
        t["tender_code"] = tenders.get(t.get("tender_id"), {}).get("code", t.get("tender_id") or "-")
        by_person[p]["transactions"].append(t)
    return by_person

# ---------- Admin / Reset ----------
@api.post("/admin/reset")
async def reset_data(body: dict, user: dict = Depends(require_admin)):
    """Wipe all business data but keep user accounts. Requires {"confirm":"RESET"}."""
    if (body or {}).get("confirm") != "RESET":
        raise HTTPException(400, "Please confirm with {\"confirm\": \"RESET\"}")
    for coll in ["tenders", "items", "transactions", "invoices", "receipts",
                 "ebg", "bank_txns", "documents", "files", "notifications",
                 "counters", "vendors"]:
        await db[coll].delete_many({})
    await audit_write("system", "reset", "reset", user["email"], note="All business data cleared")
    return {"ok": True, "cleared": True}


@api.get("/admin/email-status")
async def email_status(user: dict = Depends(require_admin)):
    """Report whether the outbound email integration is configured."""
    return {
        "configured": bool(EMAIL_KEY),
        "from_name": EMAIL_FROM_NAME,
        "reply_to": EMAIL_REPLY_TO,
        "instructions": ("Add EMERGENT_EMAIL_KEY to /app/backend/.env "
                         "(provisioned by the platform) then restart backend."),
    }


# ---------- Reports export ----------
@api.get("/reports/transactions.csv")
async def transactions_csv(
    tender_id: Optional[str] = None, item_id: Optional[str] = None,
    stage: Optional[str] = None, payment_status: Optional[str] = None,
    category: Optional[str] = None, paid_by: Optional[str] = None,
    account: Optional[str] = None, txn_type: Optional[str] = None,
    period: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
    missing_proof: Optional[bool] = None, q: Optional[str] = None,
    authorization: Optional[str] = Header(None), auth: Optional[str] = Query(None),
):
    # Auth via header OR query for direct link download
    header = authorization or (f"Bearer {auth}" if auth else None)
    if not header: raise HTTPException(401, "Not authenticated")
    try: jwt.decode(header[7:], JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception: raise HTTPException(401, "Invalid token")

    query = {}
    if tender_id: query["tender_id"] = tender_id
    if item_id: query["item_id"] = item_id
    if stage: query["stage"] = stage
    if payment_status: query["payment_status"] = payment_status
    if category: query["category"] = category
    if paid_by: query["paid_by"] = paid_by
    if account: query["account"] = account
    if txn_type: query["txn_type"] = txn_type
    if missing_proof: query["document_id"] = None
    df = _txn_date_filter(period)
    if df: query.update(df)
    elif date_from or date_to:
        r = {}
        if date_from: r["$gte"] = date_from
        if date_to: r["$lte"] = date_to
        query["date"] = r
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"code": rx}, {"vendor": rx}, {"description": rx}, {"invoice_no": rx}, {"category": rx}]

    txns = await db.transactions.find(query, {"_id": 0}).sort("date", -1).to_list(5000)
    tenders_by_id = {t["id"]: t for t in await db.tenders.find({}, {"_id": 0}).to_list(2000)}
    items_by_id = {i["id"]: i for i in await db.items.find({}, {"_id": 0}).to_list(2000)}

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Transaction ID", "Date", "Type", "Tender", "Item", "Stage", "Category",
                "Vendor", "Description", "Amount (INR)", "Paid By", "Account",
                "Payment Status", "Approval Status", "Approved By", "Payment Date",
                "Bank Reference", "Reconciled", "Created By", "Created At"])
    for t in txns:
        tender_code = tenders_by_id.get(t.get("tender_id"), {}).get("code") if t.get("tender_id") else (t.get("tender_id") or "")
        item_code = items_by_id.get(t.get("item_id"), {}).get("code", "") if t.get("item_id") else ""
        w.writerow([
            t.get("code", ""), t.get("date", ""), t.get("txn_type", ""),
            tender_code or "", item_code, t.get("stage", ""), t.get("category", ""),
            t.get("vendor", ""), t.get("description", ""), t.get("amount", 0),
            t.get("paid_by", ""), t.get("account", ""),
            t.get("payment_status", ""), t.get("approval_status", ""),
            t.get("approved_by", ""), t.get("payment_date", ""),
            t.get("bank_reference", ""), "Yes" if t.get("reconciled") else "No",
            t.get("created_by", ""), t.get("created_at", ""),
        ])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="transactions-{_date.today().isoformat()}.csv"'})


# ---------- Seed ----------
async def seed():
    await db.users.create_index("email", unique=True)
    await db.tenders.create_index("code")
    await db.transactions.create_index([("tender_id", 1), ("date", -1)])
    await db.transactions.create_index("code")
    await db.transactions.create_index("payment_status")
    await db.bank_txns.create_index("account")
    await db.notifications.create_index([("created_at", -1)])
    async def ensure_user(email, password, name, role):
        email = email.lower()
        u = await db.users.find_one({"email": email})
        if not u:
            await db.users.insert_one({"id": new_id(), "email": email, "name": name, "role": role,
                "password_hash": hash_password(password), "created_at": now_iso()})
        elif not verify_password(password, u["password_hash"]):
            await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password), "name": name, "role": role}})
    await ensure_user(os.environ["ADMIN_EMAIL"], os.environ["ADMIN_PASSWORD"], "Owner (Admin)", "admin")
    await ensure_user(os.environ["STAFF_EMAIL"], os.environ["STAFF_PASSWORD"], "Bharath (Staff)", "staff")

@app.on_event("startup")
async def startup():
    await seed()
    try: init_storage()
    except Exception as e: logging.warning(f"Storage deferred: {e}")

@app.on_event("shutdown")
async def shutdown(): client.close()

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)
