"""Tender CRUD tests (iteration 6): PATCH partial update, references, delete (safe/blocked/force cascade),
archive/unarchive + include_archived, and role guards.

Run serially: pytest /app/backend/tests/test_tender_crud.py -n 0
"""
import os
import re
from datetime import date
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"
CRED_FILE = Path("/app/memory/test_credentials.md")
TODAY = date.today().isoformat()


@pytest.fixture(scope="module")
def creds():
    if not CRED_FILE.exists():
        pytest.skip("missing test_credentials.md")
    content = CRED_FILE.read_text(encoding="utf-8")
    emails = re.findall(r"(?im)^\s*[-*]\s*\*\*Email\*\*\s*:\s*(\S+)", content)
    passwords = re.findall(r"(?im)^\s*[-*]\s*\*\*Password\*\*\s*:\s*(\S+)", content)
    if len(emails) < 2 or len(passwords) < 2:
        pytest.skip("credentials not parseable")
    return {"admin": {"email": emails[0], "password": passwords[0]},
            "staff": {"email": emails[1], "password": passwords[1]}}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def AH(session, creds):
    return {"Authorization": f"Bearer {_login(session, **creds['admin'])}"}


@pytest.fixture(scope="module")
def SH(session, creds):
    return {"Authorization": f"Bearer {_login(session, **creds['staff'])}"}


@pytest.fixture(scope="module")
def created_tender_ids():
    return []


def _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Tender", **extra):
    payload = {"tender_no": "TEST/CRUD/001", "department": "TEST_DEPT", "name": name,
               "tender_date": TODAY, "tender_value": 100000, "emd_amount": 5000,
               "status": "Identified", "responsible": "QA", "notes": "TEST_ seed"}
    payload.update(extra)
    r = session.post(f"{API}/tenders", json=payload, headers=AH, timeout=30)
    assert r.status_code == 200, r.text[:300]
    t = r.json()
    assert "_id" not in t
    assert t["code"]
    created_tender_ids.append(t["id"])
    return t


def _mk_txn(session, AH, tender_id, amount=1000, payment_status="paid"):
    body = {"date": TODAY, "txn_type": "expense", "tender_id": tender_id, "stage": "pre_tender",
            "category": "EMD", "description": "TEST_CRUD txn", "amount": amount,
            "payment_status": payment_status, "paid_by": "Company", "account": "ICICI"}
    r = session.post(f"{API}/transactions", json=body, headers=AH, timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def cleanup(session, AH, created_tender_ids):
    yield
    for tid in created_tender_ids:
        try:
            session.delete(f"{API}/tenders/{tid}?force=true", headers=AH, timeout=30)
        except Exception:
            pass


# ---------------- PATCH partial update ----------------
class TestPatchTender:
    def test_patch_partial_preserves_other_fields(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Patch")
        r = session.patch(f"{API}/tenders/{t['id']}", json={"name": "TEST_CRUD Patched", "tender_value": 250000},
                          headers=AH, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["name"] == "TEST_CRUD Patched"
        assert d["tender_value"] == 250000
        # untouched fields preserved
        assert d["department"] == "TEST_DEPT"
        assert d["emd_amount"] == 5000
        assert d["tender_no"] == "TEST/CRUD/001"
        assert d["code"] == t["code"]
        assert "_id" not in d
        # persisted
        g = session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30)
        assert g.status_code == 200
        gd = g.json()
        assert gd["name"] == "TEST_CRUD Patched"
        assert gd["department"] == "TEST_DEPT"
        assert gd["tender_value"] == 250000

    def test_patch_ignores_unknown_fields_only(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Patch2")
        r = session.patch(f"{API}/tenders/{t['id']}", json={"code": "HACKED", "id": "HACKED"},
                          headers=AH, timeout=30)
        assert r.status_code == 400, f"expected 400 Nothing to update, got {r.status_code}"
        g = session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).json()
        assert g["code"] == t["code"]
        assert g["id"] == t["id"]

    def test_patch_404_unknown_tender(self, session, AH):
        r = session.patch(f"{API}/tenders/does-not-exist-xyz", json={"name": "x"}, headers=AH, timeout=30)
        assert r.status_code == 404

    def test_patch_audit_trail_update_recorded(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Audit")
        r = session.patch(f"{API}/tenders/{t['id']}", json={"notes": "TEST_ audited change"}, headers=AH, timeout=30)
        assert r.status_code == 200
        # audit is written to db.audit; verify via mongo since there is no public tender-audit endpoint
        from pymongo import MongoClient
        backend_env = dotenv_values("/app/backend/.env")
        mongo_url = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
        if not mongo_url or not db_name:
            pytest.skip("MONGO_URL/DB_NAME unavailable")
        cli = MongoClient(mongo_url)
        rows = list(cli[db_name].audit.find({"entity": "tender", "entity_id": t["id"]}, {"_id": 0}))
        cli.close()
        actions = [x["action"] for x in rows]
        assert "create" in actions
        assert "update" in actions


# ---------------- references + delete ----------------
class TestReferencesAndDelete:
    def test_references_safe_tender(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Refs safe")
        r = session.get(f"{API}/tenders/{t['id']}/references", headers=AH, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["items", "transactions", "invoices", "ebg", "documents", "total", "safe_to_delete"]:
            assert k in d, f"missing key {k}"
        assert d["total"] == 0
        assert d["safe_to_delete"] is True

    def test_delete_safe_tender(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Delete safe")
        r = session.delete(f"{API}/tenders/{t['id']}", headers=AH, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("deleted") is True
        assert session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).status_code == 404
        listed = session.get(f"{API}/tenders", headers=AH, timeout=30).json()
        assert t["id"] not in [x["id"] for x in listed]

    def test_delete_blocked_409_with_txn(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Delete blocked")
        _mk_txn(session, AH, t["id"], amount=1500)
        r = session.delete(f"{API}/tenders/{t['id']}", headers=AH, timeout=30)
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text[:300]}"
        msg = (r.json().get("detail") or "").lower()
        assert "transaction" in msg and ("archive" in msg or "force" in msg)
        # still exists
        assert session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).status_code == 200
        refs = session.get(f"{API}/tenders/{t['id']}/references", headers=AH, timeout=30).json()
        assert refs["transactions"] == 1
        assert refs["safe_to_delete"] is False

    def test_force_delete_cascades(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Force delete")
        tid = t["id"]
        _mk_txn(session, AH, tid, amount=2000)
        _mk_txn(session, AH, tid, amount=3000)
        # item
        ri = session.post(f"{API}/items", json={"tender_id": tid, "name": "TEST_CRUD item", "quantity": 1,
                                                "unit": "pcs", "rate": 10, "estimated_cost": 10},
                          headers=AH, timeout=30)
        assert ri.status_code == 200, ri.text[:300]
        # invoice + receipt
        rinv = session.post(f"{API}/invoices", json={"tender_id": tid, "invoice_no": "TEST_CRUD-INV-1",
                                                    "invoice_date": TODAY, "amount": 5000,
                                                    "department": "TEST_DEPT"}, headers=AH, timeout=30)
        assert rinv.status_code == 200, rinv.text[:300]
        inv_id = rinv.json()["id"]
        rrec = session.post(f"{API}/receipts", json={"invoice_id": inv_id, "amount": 1000,
                                                    "receipt_date": TODAY, "account": "ICICI"},
                            headers=AH, timeout=30)
        assert rrec.status_code == 200, rrec.text[:300]
        # ebg
        rebg = session.post(f"{API}/ebg", json={"tender_id": tid, "amount": 10000, "bank": "ICICI",
                                                "issue_date": TODAY, "expiry_date": TODAY,
                                                "reference": "TEST_CRUD-EBG"}, headers=AH, timeout=30)
        assert rebg.status_code == 200, rebg.text[:300]

        refs = session.get(f"{API}/tenders/{tid}/references", headers=AH, timeout=30).json()
        # receipt recording auto-creates an income txn on the tender, so >= 2
        assert refs["transactions"] >= 2
        assert refs["items"] == 1 and refs["invoices"] == 1 and refs["ebg"] == 1
        tender_txn_count = refs["transactions"]

        txns_before = session.get(f"{API}/transactions", headers=AH, timeout=30).json()["count"]
        r = session.delete(f"{API}/tenders/{tid}?force=true", headers=AH, timeout=30)
        assert r.status_code == 200, r.text[:300]

        assert session.get(f"{API}/tenders/{tid}", headers=AH, timeout=30).status_code == 404
        txns_after_resp = session.get(f"{API}/transactions", headers=AH, timeout=30).json()
        txns_after = txns_after_resp["items"]
        assert txns_after_resp["count"] == txns_before - tender_txn_count
        assert tid not in [x.get("tender_id") for x in txns_after]
        assert session.get(f"{API}/items?tender_id={tid}", headers=AH, timeout=30).json() == []
        invoices = session.get(f"{API}/invoices", headers=AH, timeout=30).json()
        assert inv_id not in [i["id"] for i in invoices]
        ebgs = session.get(f"{API}/ebg", headers=AH, timeout=30).json()
        assert tid not in [e.get("tender_id") for e in ebgs]
        refs_after = session.get(f"{API}/tenders/{tid}/references", headers=AH, timeout=30).json()
        assert refs_after["total"] == 0

    def test_delete_404_unknown(self, session, AH):
        r = session.delete(f"{API}/tenders/nope-xyz-123", headers=AH, timeout=30)
        assert r.status_code == 404


# ---------------- archive / unarchive ----------------
class TestArchive:
    def test_archive_hides_from_default_list(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Archive")
        r = session.post(f"{API}/tenders/{t['id']}/archive", json={"reason": "TEST_ closed out"},
                         headers=AH, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).json()
        assert d["archived"] is True
        assert d["archive_reason"] == "TEST_ closed out"
        assert d.get("archived_by")
        default_list = session.get(f"{API}/tenders", headers=AH, timeout=30).json()
        assert t["id"] not in [x["id"] for x in default_list], "archived tender still in default list"
        all_list = session.get(f"{API}/tenders?include_archived=true", headers=AH, timeout=30).json()
        assert t["id"] in [x["id"] for x in all_list]

    def test_unarchive_restores(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Unarchive")
        assert session.post(f"{API}/tenders/{t['id']}/archive", json={"reason": "TEST_"},
                            headers=AH, timeout=30).status_code == 200
        r = session.post(f"{API}/tenders/{t['id']}/unarchive", headers=AH, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).json()
        assert d.get("archived") in (None, False)
        assert "archive_reason" not in d
        default_list = session.get(f"{API}/tenders", headers=AH, timeout=30).json()
        assert t["id"] in [x["id"] for x in default_list]

    def test_archive_no_reason_ok(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Archive noreason")
        r = session.post(f"{API}/tenders/{t['id']}/archive", headers=AH, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).json()["archived"] is True

    def test_archive_404_unknown(self, session, AH):
        r = session.post(f"{API}/tenders/nope-arch-1/archive", json={"reason": "x"}, headers=AH, timeout=30)
        assert r.status_code == 404

    def test_unarchive_404_unknown(self, session, AH):
        r = session.post(f"{API}/tenders/nope-unarch-1/unarchive", headers=AH, timeout=30)
        assert r.status_code == 404, f"expected 404 for unknown tender, got {r.status_code}"


# ---------------- role guards ----------------
class TestRoleGuards:
    def test_staff_cannot_delete(self, session, AH, SH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Staff delete")
        r = session.delete(f"{API}/tenders/{t['id']}", headers=SH, timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"
        assert session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).status_code == 200

    def test_staff_cannot_force_delete(self, session, AH, SH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Staff force")
        r = session.delete(f"{API}/tenders/{t['id']}?force=true", headers=SH, timeout=30)
        assert r.status_code == 403
        assert session.get(f"{API}/tenders/{t['id']}", headers=AH, timeout=30).status_code == 200

    def test_staff_can_patch_and_archive(self, session, AH, SH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Staff patch")
        r = session.patch(f"{API}/tenders/{t['id']}", json={"notes": "TEST_ staff note"}, headers=SH, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["notes"] == "TEST_ staff note"
        ra = session.post(f"{API}/tenders/{t['id']}/archive", json={"reason": "TEST_ staff archive"},
                          headers=SH, timeout=30)
        assert ra.status_code == 200
        session.post(f"{API}/tenders/{t['id']}/unarchive", headers=SH, timeout=30)

    def test_delete_requires_auth(self, session, AH, created_tender_ids):
        t = _mk_tender(session, AH, created_tender_ids, name="TEST_CRUD Noauth")
        r = session.delete(f"{API}/tenders/{t['id']}", timeout=30)
        assert r.status_code == 401
