from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import csv
import uuid
import logging
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Response, Query
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr

# ---------- Setup ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Bright India Traders Finance")
api = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"

# ---------- Object storage ----------
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
    if not key:
        raise HTTPException(status_code=503, detail="Storage unavailable")
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    if not key:
        raise HTTPException(status_code=503, detail="Storage unavailable")
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60
    )
    if resp.status_code == 404:
        _ = init_storage(force=True)
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": _storage_key}, timeout=60
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# ---------- Auth helpers ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def not_viewer(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Read-only user")
    return user

# ---------- Models ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str


class TenderIn(BaseModel):
    tender_no: Optional[str] = ""
    department: str
    name: str
    tender_date: Optional[str] = None
    closing_date: Optional[str] = None
    tender_value: float = 0
    emd_amount: float = 0
    status: str = "Identified"
    responsible: Optional[str] = ""
    notes: Optional[str] = ""


class ItemIn(BaseModel):
    tender_id: str
    name: str
    quantity: float = 0
    unit: str = "pcs"
    rate: float = 0
    estimated_cost: float = 0


class TxnIn(BaseModel):
    date: str
    txn_type: Literal["expense", "income", "purchase", "refund", "ld", "reimbursement"] = "expense"
    tender_id: Optional[str] = None  # None or "COMPANY"
    item_id: Optional[str] = None    # None means shared/tender-level
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
    invoice_no: Optional[str] = ""
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    document_id: Optional[str] = None
    remarks: Optional[str] = ""


class ApprovalAction(BaseModel):
    action: Literal["approve", "reject", "send_back"]
    remarks: Optional[str] = ""


class PayTxn(BaseModel):
    account: str
    payment_date: str
    bank_reference: Optional[str] = ""


class EBGIn(BaseModel):
    tender_id: str
    amount: float
    bank: str
    issue_date: str
    expiry_date: str
    reference: Optional[str] = ""
    status: Literal["active", "released", "expired"] = "active"


class InvoiceIn(BaseModel):
    tender_id: str
    invoice_no: str
    invoice_date: str
    due_date: Optional[str] = None
    amount: float
    department: str
    remarks: Optional[str] = ""


class ReceiptIn(BaseModel):
    invoice_id: str
    amount: float
    receipt_date: str
    account: str
    bank_reference: Optional[str] = ""
    ld_deducted: float = 0


class BankMatchIn(BaseModel):
    bank_txn_id: str
    ledger_txn_id: str

# ---------- Constants ----------
TENDER_STATUSES = [
    "Identified", "Under Evaluation", "Participating", "Submitted",
    "Technical Qualified", "Technically Disqualified", "Financially Opened",
    "L1", "Not L1", "AOC Received", "Execution", "Completed", "Cancelled",
]

CATEGORIES = {
    "pre_tender": ["EMD", "Stamp Paper", "Courier", "Sample", "Tender Filing"],
    "post_tender": [
        "EBG", "Yarn", "Fabric", "Finished Goods", "Weaving", "Stitching",
        "Packing", "Transport", "Courier", "Printing/Screen", "Loading",
        "Unloading", "Inventory", "Miscellaneous", "LD/Penalty",
    ],
    "administration": [
        "Salary", "Tender Software", "Documentation", "Professional Fees",
        "Office", "Communication", "Other Overhead",
    ],
}

ACCOUNTS = ["ICICI", "HDFC", "SBI", "Cash", "Dad", "Bharath"]

# ---------- Utility ----------
def new_id() -> str:
    return str(uuid.uuid4())


async def next_sequence(name: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    return doc["seq"] if doc and "seq" in doc else 1


async def next_tender_code() -> str:
    year = datetime.now(timezone.utc).year
    seq = await next_sequence(f"tender-{year}")
    return f"BIT-{year}-{seq:03d}"


async def next_item_code(tender_code: str) -> str:
    seq = await next_sequence(f"item-{tender_code}")
    return f"{tender_code}-I{seq:02d}"


async def next_txn_code() -> str:
    seq = await next_sequence("txn")
    return f"TXN-{seq:06d}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ---------- Auth Routes ----------
@api.post("/auth/login")
async def login(payload: LoginIn):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/logout")
async def logout(user: dict = Depends(get_current_user)):
    return {"ok": True}


@api.get("/masters")
async def masters(user: dict = Depends(get_current_user)):
    return {
        "statuses": TENDER_STATUSES,
        "categories": CATEGORIES,
        "accounts": ACCOUNTS,
    }

# ---------- Tenders ----------
@api.get("/tenders")
async def list_tenders(user: dict = Depends(get_current_user), status: Optional[str] = None):
    q = {}
    if status:
        q["status"] = status
    docs = await db.tenders.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api.post("/tenders")
async def create_tender(payload: TenderIn, user: dict = Depends(not_viewer)):
    code = await next_tender_code()
    doc = {
        "id": new_id(),
        "code": code,
        **payload.model_dump(),
        "created_at": now_iso(),
        "created_by": user["email"],
    }
    await db.tenders.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api.get("/tenders/{tender_id}")
async def get_tender(tender_id: str, user: dict = Depends(get_current_user)):
    t = await db.tenders.find_one({"id": tender_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Tender not found")
    return t


@api.patch("/tenders/{tender_id}")
async def update_tender(tender_id: str, payload: TenderIn, user: dict = Depends(not_viewer)):
    await db.tenders.update_one({"id": tender_id}, {"$set": payload.model_dump()})
    return await db.tenders.find_one({"id": tender_id}, {"_id": 0})


@api.post("/tenders/{tender_id}/status")
async def update_status(tender_id: str, body: dict, user: dict = Depends(not_viewer)):
    status = body.get("status")
    if status not in TENDER_STATUSES:
        raise HTTPException(400, "Invalid status")
    await db.tenders.update_one({"id": tender_id}, {"$set": {"status": status}})
    return {"ok": True}

# ---------- Items ----------
@api.get("/items")
async def list_items(tender_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if tender_id:
        q["tender_id"] = tender_id
    return await db.items.find(q, {"_id": 0}).to_list(1000)


@api.post("/items")
async def create_item(payload: ItemIn, user: dict = Depends(not_viewer)):
    tender = await db.tenders.find_one({"id": payload.tender_id})
    if not tender:
        raise HTTPException(404, "Tender not found")
    code = await next_item_code(tender["code"])
    doc = {
        "id": new_id(),
        "code": code,
        **payload.model_dump(),
        "created_at": now_iso(),
    }
    await db.items.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(require_admin)):
    await db.items.delete_one({"id": item_id})
    return {"ok": True}

# ---------- Transactions ----------
@api.get("/transactions")
async def list_txns(
    tender_id: Optional[str] = None,
    item_id: Optional[str] = None,
    stage: Optional[str] = None,
    payment_status: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {}
    if tender_id: q["tender_id"] = tender_id
    if item_id: q["item_id"] = item_id
    if stage: q["stage"] = stage
    if payment_status: q["payment_status"] = payment_status
    return await db.transactions.find(q, {"_id": 0}).sort("date", -1).to_list(2000)


@api.post("/transactions")
async def create_txn(payload: TxnIn, user: dict = Depends(not_viewer)):
    code = await next_txn_code()
    doc = {
        "id": new_id(),
        "code": code,
        **payload.model_dump(),
        "approval_status": "pending" if payload.payment_status != "paid" else "approved",
        "approved_by": None,
        "approved_at": None,
        "payment_date": None,
        "bank_reference": "",
        "reconciled": False,
        "created_at": now_iso(),
        "created_by": user["email"],
    }
    if user["role"] == "admin" and payload.payment_status in ("approved", "paid"):
        doc["approval_status"] = "approved"
        doc["approved_by"] = user["email"]
        doc["approved_at"] = now_iso()
    await db.transactions.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api.get("/transactions/{txn_id}")
async def get_txn(txn_id: str, user: dict = Depends(get_current_user)):
    t = await db.transactions.find_one({"id": txn_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Not found")
    return t


@api.post("/transactions/{txn_id}/approve")
async def approve_txn(txn_id: str, body: ApprovalAction, user: dict = Depends(require_admin)):
    update = {"approved_by": user["email"], "approved_at": now_iso(), "approval_remarks": body.remarks}
    if body.action == "approve":
        update["approval_status"] = "approved"
        update["payment_status"] = "approved"
    elif body.action == "reject":
        update["approval_status"] = "rejected"
        update["payment_status"] = "rejected"
    else:
        update["approval_status"] = "clarification"
    await db.transactions.update_one({"id": txn_id}, {"$set": update})
    return {"ok": True}


@api.post("/transactions/{txn_id}/pay")
async def pay_txn(txn_id: str, body: PayTxn, user: dict = Depends(not_viewer)):
    await db.transactions.update_one(
        {"id": txn_id},
        {"$set": {
            "payment_status": "paid",
            "payment_date": body.payment_date,
            "account": body.account,
            "bank_reference": body.bank_reference,
        }},
    )
    return {"ok": True}

# ---------- EBG ----------
@api.get("/ebg")
async def list_ebg(user: dict = Depends(get_current_user)):
    return await db.ebg.find({}, {"_id": 0}).sort("issue_date", -1).to_list(1000)


@api.post("/ebg")
async def create_ebg(payload: EBGIn, user: dict = Depends(not_viewer)):
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.ebg.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api.post("/ebg/{ebg_id}/release")
async def release_ebg(ebg_id: str, user: dict = Depends(not_viewer)):
    await db.ebg.update_one({"id": ebg_id}, {"$set": {"status": "released"}})
    return {"ok": True}

# ---------- Invoices / Receivables ----------
@api.get("/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    invoices = await db.invoices.find({}, {"_id": 0}).sort("invoice_date", -1).to_list(1000)
    # Compute outstanding
    for inv in invoices:
        receipts = await db.receipts.find({"invoice_id": inv["id"]}, {"_id": 0}).to_list(500)
        inv["received"] = sum(r["amount"] for r in receipts)
        inv["ld_deducted"] = sum(r.get("ld_deducted", 0) for r in receipts)
        inv["outstanding"] = round(inv["amount"] - inv["received"] - inv["ld_deducted"], 2)
    return invoices


@api.post("/invoices")
async def create_invoice(payload: InvoiceIn, user: dict = Depends(not_viewer)):
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.invoices.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api.post("/receipts")
async def record_receipt(payload: ReceiptIn, user: dict = Depends(not_viewer)):
    inv = await db.invoices.find_one({"id": payload.invoice_id})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    doc = {"id": new_id(), **payload.model_dump(), "created_at": now_iso()}
    await db.receipts.insert_one(dict(doc))
    # Also create an income transaction
    tcode = await next_txn_code()
    await db.transactions.insert_one({
        "id": new_id(), "code": tcode, "date": payload.receipt_date,
        "txn_type": "income", "tender_id": inv["tender_id"], "item_id": None,
        "stage": "post_tender", "category": "Department Payment",
        "description": f"Payment received for {inv['invoice_no']}",
        "vendor": inv["department"], "amount": payload.amount,
        "payment_status": "paid", "account": payload.account,
        "bank_reference": payload.bank_reference,
        "approval_status": "approved", "reconciled": False,
        "created_at": now_iso(), "created_by": user["email"],
    })
    doc.pop("_id", None)
    return doc

# ---------- Bank ----------
@api.post("/bank/upload")
async def upload_bank(file: UploadFile = File(...), account: str = Query(...), user: dict = Depends(not_viewer)):
    content = await file.read()
    text = content.decode(errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    inserted = 0
    for row in reader:
        # Try common column headings
        date = row.get("Date") or row.get("date") or row.get("Txn Date") or ""
        desc = row.get("Description") or row.get("Narration") or row.get("Particulars") or ""
        debit = float((row.get("Debit") or row.get("Withdrawal") or "0").replace(",", "") or 0)
        credit = float((row.get("Credit") or row.get("Deposit") or "0").replace(",", "") or 0)
        ref = row.get("Ref No") or row.get("Reference") or row.get("Cheque No") or ""
        amount = credit - debit
        doc = {
            "id": new_id(),
            "account": account,
            "date": date,
            "description": desc,
            "amount": amount,
            "direction": "credit" if amount > 0 else "debit",
            "reference": ref,
            "matched_txn_id": None,
            "reconciled": False,
            "created_at": now_iso(),
        }
        await db.bank_txns.insert_one(dict(doc))
        inserted += 1
    return {"inserted": inserted}


@api.post("/bank/manual")
async def add_bank_manual(body: dict, user: dict = Depends(not_viewer)):
    doc = {
        "id": new_id(),
        "account": body["account"],
        "date": body["date"],
        "description": body.get("description", ""),
        "amount": float(body["amount"]),
        "direction": "credit" if float(body["amount"]) > 0 else "debit",
        "reference": body.get("reference", ""),
        "matched_txn_id": None,
        "reconciled": False,
        "created_at": now_iso(),
    }
    await db.bank_txns.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api.get("/bank")
async def list_bank(reconciled: Optional[bool] = None, user: dict = Depends(get_current_user)):
    q = {}
    if reconciled is not None:
        q["reconciled"] = reconciled
    return await db.bank_txns.find(q, {"_id": 0}).sort("date", -1).to_list(2000)


@api.post("/bank/match")
async def match_bank(body: BankMatchIn, user: dict = Depends(not_viewer)):
    await db.bank_txns.update_one(
        {"id": body.bank_txn_id},
        {"$set": {"matched_txn_id": body.ledger_txn_id, "reconciled": True}},
    )
    await db.transactions.update_one(
        {"id": body.ledger_txn_id}, {"$set": {"reconciled": True}}
    )
    return {"ok": True}

# ---------- Files ----------
@api.post("/files/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(not_viewer)):
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
    file_id = new_id()
    path = f"{APP_NAME}/uploads/{user['id']}/{file_id}.{ext}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    result = put_object(path, data, ct)
    rec = {
        "id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": ct,
        "size": result.get("size", len(data)),
        "is_deleted": False,
        "uploaded_by": user["email"],
        "created_at": now_iso(),
    }
    await db.files.insert_one(dict(rec))
    rec.pop("_id", None)
    return rec


@api.get("/files/{file_id}/download")
async def download_file(file_id: str, authorization: Optional[str] = Header(None), auth: Optional[str] = Query(None)):
    header = authorization or (f"Bearer {auth}" if auth else None)
    if not header:
        raise HTTPException(401, "Not authenticated")
    try:
        jwt.decode(header[7:], JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        raise HTTPException(401, "Invalid token")
    rec = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not rec:
        raise HTTPException(404, "Not found")
    data, ct = get_object(rec["storage_path"])
    return Response(content=data, media_type=rec.get("content_type", ct))

# ---------- Reports ----------
@api.get("/reports/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    txns = await db.transactions.find({}, {"_id": 0}).to_list(5000)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(1000)
    ebg = await db.ebg.find({"status": "active"}, {"_id": 0}).to_list(200)

    revenue = 0.0
    receipts = await db.receipts.find({}, {"_id": 0}).to_list(2000)
    for r in receipts:
        revenue += r["amount"]

    total_receivable = 0.0
    for inv in invoices:
        rec_sum = sum(r["amount"] for r in receipts if r["invoice_id"] == inv["id"])
        ld_sum = sum(r.get("ld_deducted", 0) for r in receipts if r["invoice_id"] == inv["id"])
        total_receivable += max(inv["amount"] - rec_sum - ld_sum, 0)

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

    return {
        "revenue": revenue,
        "receivables": total_receivable,
        "payables": total_payable,
        "pending_approvals": pending_approvals,
        "pre_tender_cost": pre_cost,
        "post_tender_cost": post_cost,
        "admin_cost": admin_cost,
        "gross_contribution": revenue - pre_cost - post_cost,
        "operating_contribution": revenue - pre_cost - post_cost - admin_cost,
        "ebg_blocked": ebg_blocked,
        "emd_outstanding": emd_outstanding,
        "active_tenders": active_tenders,
        "total_tenders": total_tenders,
    }


@api.get("/reports/tender-pnl/{tender_id}")
async def tender_pnl(tender_id: str, user: dict = Depends(get_current_user)):
    tender = await db.tenders.find_one({"id": tender_id}, {"_id": 0})
    if not tender:
        raise HTTPException(404, "Tender not found")
    items = await db.items.find({"tender_id": tender_id}, {"_id": 0}).to_list(200)
    txns = await db.transactions.find({"tender_id": tender_id}, {"_id": 0}).to_list(2000)
    invoices = await db.invoices.find({"tender_id": tender_id}, {"_id": 0}).to_list(200)
    receipts_all = await db.receipts.find({}, {"_id": 0}).to_list(2000)

    revenue = 0.0
    for inv in invoices:
        for r in receipts_all:
            if r["invoice_id"] == inv["id"]:
                revenue += r["amount"]

    def cat_group(stage):
        out = {}
        for t in txns:
            if t.get("stage") != stage or t.get("txn_type") in ("income",):
                continue
            sign = -1 if t.get("txn_type") == "refund" else 1
            out[t["category"]] = out.get(t["category"], 0) + sign * t["amount"]
        return out

    pre = cat_group("pre_tender")
    post = cat_group("post_tender")
    pre_total = sum(pre.values())
    post_total = sum(post.values())
    total_cost = pre_total + post_total
    contribution = revenue - total_cost
    margin = (contribution / revenue * 100) if revenue else 0

    # Item-level P&L
    item_pnl = []
    for it in items:
        item_cost = sum(
            t["amount"] for t in txns
            if t.get("item_id") == it["id"] and t.get("txn_type") not in ("income", "refund")
        )
        item_rev = (it.get("quantity", 0) or 0) * (it.get("rate", 0) or 0)
        item_pnl.append({
            "item_id": it["id"], "code": it.get("code"), "name": it["name"],
            "quantity": it.get("quantity"), "rate": it.get("rate"),
            "revenue": item_rev, "cost": item_cost,
            "profit": item_rev - item_cost,
            "margin": (item_rev - item_cost) / item_rev * 100 if item_rev else 0,
            "estimated_cost": it.get("estimated_cost", 0),
            "variance": item_cost - (it.get("estimated_cost", 0) or 0),
        })

    return {
        "tender": tender,
        "revenue": revenue,
        "pre_tender": pre,
        "post_tender": post,
        "pre_total": pre_total,
        "post_total": post_total,
        "total_cost": total_cost,
        "contribution": contribution,
        "margin": margin,
        "items": item_pnl,
    }


@api.get("/reports/payables")
async def payables(user: dict = Depends(get_current_user)):
    txns = await db.transactions.find({"payment_status": "payable"}, {"_id": 0}).to_list(1000)
    tenders = {t["id"]: t for t in await db.tenders.find({}, {"_id": 0}).to_list(1000)}
    for t in txns:
        t["tender_code"] = tenders.get(t.get("tender_id"), {}).get("code", "-")
    return txns


@api.get("/reports/receivables")
async def receivables(user: dict = Depends(get_current_user)):
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(1000)
    tenders = {t["id"]: t for t in await db.tenders.find({}, {"_id": 0}).to_list(1000)}
    receipts = await db.receipts.find({}, {"_id": 0}).to_list(2000)
    out = []
    for inv in invoices:
        rec_sum = sum(r["amount"] for r in receipts if r["invoice_id"] == inv["id"])
        ld_sum = sum(r.get("ld_deducted", 0) for r in receipts if r["invoice_id"] == inv["id"])
        outstanding = inv["amount"] - rec_sum - ld_sum
        if outstanding > 0.01:
            inv["received"] = rec_sum
            inv["outstanding"] = outstanding
            inv["tender_code"] = tenders.get(inv.get("tender_id"), {}).get("code", "-")
            out.append(inv)
    return out

# ---------- Seed ----------
async def seed():
    await db.users.create_index("email", unique=True)
    await db.tenders.create_index("code")
    await db.transactions.create_index([("tender_id", 1), ("date", -1)])
    await db.bank_txns.create_index("account")

    async def ensure_user(email, password, name, role):
        email = email.lower()
        u = await db.users.find_one({"email": email})
        if not u:
            await db.users.insert_one({
                "id": new_id(), "email": email, "name": name, "role": role,
                "password_hash": hash_password(password), "created_at": now_iso(),
            })
        elif not verify_password(password, u["password_hash"]):
            await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password), "name": name, "role": role}})

    await ensure_user(os.environ["ADMIN_EMAIL"], os.environ["ADMIN_PASSWORD"], "Owner (Admin)", "admin")
    await ensure_user(os.environ["STAFF_EMAIL"], os.environ["STAFF_PASSWORD"], "Bharath (Staff)", "staff")


@app.on_event("startup")
async def startup():
    await seed()
    try:
        init_storage()
    except Exception as e:
        logging.warning(f"Storage init deferred: {e}")


@app.on_event("shutdown")
async def shutdown():
    client.close()


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
