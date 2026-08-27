"""Backend regression tests — Bright India Traders finance app (iteration 3).

Covers: auth (admin/staff), fresh-slate reset, tender creation, transaction creation,
SELF-APPROVE (the reported bug: previously 403), audit trail, CSV report export
(header + ?auth= query token), AI bill extract endpoint guard, RBAC.
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


def _creds():
    content = CRED_FILE.read_text(encoding="utf-8")
    emails = re.findall(r"(?im)^\s*[-*]\s*\*\*Email\*\*\s*:\s*(\S+)", content)
    passwords = re.findall(r"(?im)^\s*[-*]\s*\*\*Password\*\*\s*:\s*(\S+)", content)
    return emails, passwords


@pytest.fixture(scope="session")
def creds():
    if not CRED_FILE.exists():
        pytest.skip("missing test_credentials.md")
    emails, passwords = _creds()
    if len(emails) < 2 or len(passwords) < 2:
        pytest.skip("credentials not parseable")
    return {
        "admin": {"email": emails[0], "password": passwords[0]},
        "staff": {"email": emails[1], "password": passwords[1]},
    }


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    return r.json()


@pytest.fixture(scope="session")
def admin_token(session, creds):
    data = _login(session, creds["admin"]["email"], creds["admin"]["password"])
    assert data["user"]["role"] == "admin"
    assert isinstance(data["token"], str) and len(data["token"]) > 20
    return data["token"]


@pytest.fixture(scope="session")
def staff_token(session, creds):
    data = _login(session, creds["staff"]["email"], creds["staff"]["password"])
    assert data["user"]["role"] == "staff"
    return data["token"]


@pytest.fixture(scope="session")
def AH(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def SH(staff_token):
    return {"Authorization": f"Bearer {staff_token}"}


# ---------------- Auth module ----------------
class TestAuth:
    def test_me_admin(self, session, AH, creds):
        r = session.get(f"{API}/auth/me", headers=AH, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == creds["admin"]["email"].lower()
        assert "password_hash" not in d
        assert "_id" not in d

    def test_bad_password_401(self, session, creds):
        r = session.post(f"{API}/auth/login", json={"email": creds["admin"]["email"], "password": "WRONG_pw_1"}, timeout=30)
        assert r.status_code == 401

    def test_no_token_401(self, session):
        r = session.get(f"{API}/auth/me", headers={"Authorization": ""}, timeout=30)
        assert r.status_code == 401

    def test_masters(self, session, AH):
        r = session.get(f"{API}/masters", headers=AH, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("categories") and d.get("accounts")


# ---------------- Fresh slate / admin reset ----------------
class TestFreshSlate:
    def test_staff_cannot_reset(self, session, SH):
        r = session.post(f"{API}/admin/reset", headers=SH, timeout=60)
        assert r.status_code == 403

    def test_admin_reset_and_empty_state(self, session, AH):
        r = session.post(f"{API}/admin/reset", headers=AH, timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True

        t = session.get(f"{API}/tenders", headers=AH, timeout=30)
        assert t.status_code == 200 and t.json() == []
        tx = session.get(f"{API}/transactions", headers=AH, timeout=30)
        assert tx.status_code == 200
        d = tx.json()
        assert d["items"] == [] and d["count"] == 0
        assert d["total_expense"] == 0 and d["total_income"] == 0

    def test_dashboard_zeros(self, session, AH):
        r = session.get(f"{API}/reports/dashboard", headers=AH, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "_id" not in str(d)
        # spend-type numeric KPIs should be zero on a clean DB
        for k, v in d.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                assert v == 0, f"KPI {k} not zero on fresh DB: {v}"


# ---------------- Tenders + Transactions + self-approve ----------------
@pytest.fixture(scope="session")
def created():
    return {}


class TestTenderTxnApprovalFlow:
    def test_create_tender(self, session, AH, created):
        payload = {
            "tender_no": "TEST_TN_001", "department": "TEST_PWD", "name": "TEST_Supply of Cables",
            "tender_date": date.today().isoformat(), "closing_date": date.today().isoformat(),
            "tender_value": 250000, "emd_amount": 5000, "status": "Identified",
            "responsible": "Bharath", "notes": "TEST tender",
        }
        r = session.post(f"{API}/tenders", headers=AH, json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "_id" not in d
        assert d["name"] == payload["name"] and d["emd_amount"] == 5000
        assert d.get("code")
        created["tender_id"] = d["id"]
        created["tender_code"] = d["code"]

        g = session.get(f"{API}/tenders/{d['id']}", headers=AH, timeout=30)
        assert g.status_code == 200
        assert g.json()["tender"]["name"] == payload["name"] if "tender" in g.json() else g.json()["name"] == payload["name"]

    def test_tender_in_list(self, session, AH, created):
        r = session.get(f"{API}/tenders", headers=AH, timeout=30)
        assert r.status_code == 200
        codes = [t["code"] for t in r.json()]
        assert created["tender_code"] in codes

    def test_create_transaction_requested(self, session, AH, created, creds):
        payload = {
            "date": date.today().isoformat(), "txn_type": "expense", "tender_id": created["tender_id"],
            "stage": "pre_tender", "category": "EMD", "description": "TEST EMD payment",
            "amount": 5000, "payment_status": "requested", "paid_by": "Dad", "account": "",
        }
        r = session.post(f"{API}/transactions", headers=AH, json=payload, timeout=60)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert "_id" not in d
        assert d["amount"] == 5000 and d["category"] == "EMD"
        assert d["approval_status"] == "pending" and d["payment_status"] == "requested"
        assert d["created_by"] == creds["admin"]["email"].lower()
        created["txn_id"] = d["id"]
        created["txn_code"] = d["code"]

        g = session.get(f"{API}/transactions/{d['id']}", headers=AH, timeout=30)
        assert g.status_code == 200 and g.json()["code"] == d["code"]

    def test_txn_in_pending_queue(self, session, AH, created):
        r = session.get(f"{API}/transactions?payment_status=requested", headers=AH, timeout=30)
        assert r.status_code == 200
        assert created["txn_id"] in [t["id"] for t in r.json()["items"]]

    def test_staff_cannot_approve(self, session, SH, created):
        r = session.post(f"{API}/transactions/{created['txn_id']}/approve",
                         headers=SH, json={"action": "approve"}, timeout=30)
        assert r.status_code == 403

    def test_owner_self_approve_succeeds(self, session, AH, created, creds):
        """Reported bug: self-approve used to return 403."""
        r = session.post(f"{API}/transactions/{created['txn_id']}/approve",
                         headers=AH, json={"action": "approve", "remarks": "TEST owner approval"}, timeout=60)
        assert r.status_code == 200, f"self-approve failed: {r.status_code} {r.text[:300]}"
        assert r.json().get("ok") is True

        g = session.get(f"{API}/transactions/{created['txn_id']}", headers=AH, timeout=30)
        t = g.json()
        assert t["approval_status"] == "approved"
        assert t["payment_status"] == "approved"
        assert t["approved_by"] == creds["admin"]["email"].lower()
        assert t.get("self_approved") is True

    def test_removed_from_pending_queue(self, session, AH, created):
        r = session.get(f"{API}/transactions?payment_status=requested", headers=AH, timeout=30)
        assert created["txn_id"] not in [t["id"] for t in r.json()["items"]]

    def test_audit_history_has_self_flag(self, session, AH, created):
        r = session.get(f"{API}/transactions/{created['txn_id']}/details", headers=AH, timeout=30)
        assert r.status_code == 200
        d = r.json()
        actions = [h["action"] for h in d["history"]]
        assert "create" in actions
        assert "approval:approve (self)" in actions, actions
        assert d["tender"] and d["tender"]["id"] == created["tender_id"]

    def test_approve_missing_txn_404(self, session, AH):
        r = session.post(f"{API}/transactions/does-not-exist/approve", headers=AH,
                         json={"action": "approve"}, timeout=30)
        assert r.status_code == 404

    def test_approve_invalid_action_422(self, session, AH, created):
        r = session.post(f"{API}/transactions/{created['txn_id']}/approve", headers=AH,
                         json={"action": "bogus"}, timeout=30)
        assert r.status_code == 422


# ---------------- CSV report export ----------------
class TestCsvExport:
    def test_csv_with_query_token(self, session, admin_token, created):
        r = session.get(f"{API}/reports/transactions.csv?period=last_30&auth={admin_token}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")
        body = r.text
        assert "Transaction ID" in body.splitlines()[0]
        assert created["txn_code"] in body
        assert created["tender_code"] in body

    def test_csv_with_header_token(self, session, AH):
        r = session.get(f"{API}/reports/transactions.csv", headers=AH, timeout=60)
        assert r.status_code == 200
        assert "Transaction ID" in r.text

    def test_csv_no_auth_401(self, session):
        r = session.get(f"{API}/reports/transactions.csv", timeout=30)
        assert r.status_code == 401

    def test_csv_bad_token_401(self, session):
        r = session.get(f"{API}/reports/transactions.csv?auth=not.a.token", timeout=30)
        assert r.status_code == 401

    def test_csv_filter_excludes(self, session, admin_token, created):
        r = session.get(f"{API}/reports/transactions.csv?category=Courier&auth={admin_token}", timeout=60)
        assert r.status_code == 200
        assert created["txn_code"] not in r.text


# ---------------- AI bill extraction endpoint guards (no Gemini call) ----------------
class TestBillExtractGuards:
    def test_requires_auth(self, session):
        r = session.post(f"{API}/extract/bill", timeout=30)
        assert r.status_code in (401, 422)

    def test_missing_file_422(self, session, AH):
        h = {k: v for k, v in AH.items()}
        r = requests.post(f"{API}/extract/bill", headers=h, timeout=30)
        assert r.status_code == 422, r.status_code


# ---------------- Other report endpoints smoke ----------------
class TestReportsSmoke:
    @pytest.mark.parametrize("path", [
        "/reports/dashboard", "/reports/payables", "/reports/receivables",
        "/reports/personal-payments", "/bank", "/ebg", "/notifications",
        "/vendors", "/invoices",
    ])
    def test_get_ok(self, session, AH, path):
        r = session.get(f"{API}{path}", headers=AH, timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
        assert "ObjectId" not in r.text
