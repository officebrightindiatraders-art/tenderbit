"""Iteration 8 — (a) approval visibility rule for cost KPIs, (b) PATCH edit txn, (c) DELETE txn.

Single ordered class. Uses admin + staff creds from /app/memory/test_credentials.md.
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
API = base_url.rstrip("/") + "/api"

CRED_FILE = Path("/app/memory/test_credentials.md")
TODAY = date.today().isoformat()
EMD = 50000.0
EDITED = 45000.0


@pytest.fixture(scope="module")
def ctx():
    if not CRED_FILE.exists():
        pytest.skip("missing test_credentials.md")
    content = CRED_FILE.read_text(encoding="utf-8")
    emails = re.findall(r"(?im)^\s*[-*]\s*\*\*Email\*\*\s*:\s*(\S+)", content)
    passwords = re.findall(r"(?im)^\s*[-*]\s*\*\*Password\*\*\s*:\s*(\S+)", content)
    if len(emails) < 2 or len(passwords) < 2:
        pytest.skip("credentials not parseable")
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})

    def login(email, pw):
        r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
        if r.status_code != 200:
            pytest.fail(f"login {email} failed {r.status_code}: {r.text[:300]}")
        return r.json()["token"]

    return {
        "s": s,
        "AH": {"Authorization": f"Bearer {login(emails[0], passwords[0])}"},
        "SH": {"Authorization": f"Bearer {login(emails[1], passwords[1])}"},
        "store": {},
    }


def dash(ctx):
    r = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def mk_txn(ctx, hdr, **over):
    payload = {
        "date": TODAY, "txn_type": "expense", "tender_id": ctx["store"]["tender_id"],
        "stage": "pre_tender", "category": "EMD", "description": "TEST_txn",
        "amount": EMD, "payment_status": "requested", "paid_by": "Dad", "account": "",
    }
    payload.update(over)
    r = ctx["s"].post(f"{API}/transactions", headers=hdr, json=payload, timeout=90)
    assert r.status_code == 200, r.text[:400]
    return r.json()


class TestApprovalRuleAndEditDelete:
    # ---------- setup ----------
    def test_01_reset_and_tender(self, ctx):
        r = ctx["s"].post(f"{API}/admin/reset", headers=ctx["AH"], json={"confirm": "RESET"}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        d = dash(ctx)
        assert d["pre_tender_cost"] == 0 and d["total_actual_cost"] == 0

        t = ctx["s"].post(f"{API}/tenders", headers=ctx["AH"], json={
            "tender_no": "TEST_APPR_001", "department": "TEST_PWD", "name": "TEST_Approval Rule",
            "tender_date": TODAY, "closing_date": TODAY, "tender_value": 1000000,
            "emd_amount": EMD, "status": "Participating", "responsible": "Bharath",
        }, timeout=30)
        assert t.status_code == 200, t.text[:300]
        ctx["store"]["tender_id"] = t.json()["id"]

    # ---------- (a) approval visibility rule ----------
    def test_02_requested_txn_excluded_from_kpis(self, ctx):
        d0 = mk_txn(ctx, ctx["SH"], description="TEST_requested EMD")
        assert d0["payment_status"] == "requested"
        ctx["store"]["txn_id"] = d0["id"]

        d = dash(ctx)
        assert d["pre_tender_cost"] == 0, f"requested txn counted: {d['pre_tender_cost']}"
        assert d["total_actual_cost"] == 0, d
        assert d["gross_contribution"] == 0, d
        assert d["pending_approvals"] == 1, d

        p = ctx["s"].get(f"{API}/reports/tender-pnl/{ctx['store']['tender_id']}", headers=ctx["AH"], timeout=30).json()
        assert p["pre_total"] == 0, p
        assert p["total_cost"] == 0, p

    def test_03_approve_makes_it_count(self, ctx):
        r = ctx["s"].post(f"{API}/transactions/{ctx['store']['txn_id']}/approve", headers=ctx["AH"],
                          json={"action": "approve", "remarks": "TEST approve"}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        t = ctx["s"].get(f"{API}/transactions/{ctx['store']['txn_id']}", headers=ctx["AH"], timeout=30).json()
        assert t["payment_status"] == "approved"

        d = dash(ctx)
        assert d["pre_tender_cost"] == EMD, d
        assert d["total_actual_cost"] == EMD, d
        p = ctx["s"].get(f"{API}/reports/tender-pnl/{ctx['store']['tender_id']}", headers=ctx["AH"], timeout=30).json()
        assert p["pre_total"] == EMD, p

    def test_04_payable_counts_as_cost(self, ctx):
        before = dash(ctx)["post_tender_cost"]
        pay = mk_txn(ctx, ctx["AH"], stage="post_tender", category="Transport",
                     description="TEST_payable purchase", amount=12000, payment_status="payable",
                     paid_by="Company", due_date=TODAY)
        ctx["store"]["payable_id"] = pay["id"]
        d = dash(ctx)
        assert d["post_tender_cost"] == before + 12000, d
        assert d["payables"] == 12000, d

    # ---------- (b) PATCH edit ----------
    def test_05_patch_updates_amount_and_kpis(self, ctx):
        tid = ctx["store"]["txn_id"]
        r = ctx["s"].patch(f"{API}/transactions/{tid}", headers=ctx["AH"],
                           json={"amount": EDITED, "description": "corrected"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert "_id" not in body
        assert body["amount"] == EDITED
        assert body["description"] == "corrected"

        # GET verifies persistence
        g = ctx["s"].get(f"{API}/transactions/{tid}", headers=ctx["AH"], timeout=30).json()
        assert g["amount"] == EDITED and g["description"] == "corrected"

        d = dash(ctx)
        assert d["pre_tender_cost"] == EDITED, d

    def test_06_audit_has_edit_entry(self, ctx):
        det = ctx["s"].get(f"{API}/transactions/{ctx['store']['txn_id']}/details",
                           headers=ctx["AH"], timeout=30).json()
        edits = [h for h in det["history"] if h["action"] == "edit"]
        assert edits, [h["action"] for h in det["history"]]
        e = edits[-1]
        assert e["before"]["amount"] == EMD, e["before"]["amount"]
        assert e["after"]["amount"] == EDITED, e["after"]["amount"]
        assert "amount" in (e.get("note") or "")

    def test_07_patch_only_disallowed_keys_400(self, ctx):
        r = ctx["s"].patch(f"{API}/transactions/{ctx['store']['txn_id']}", headers=ctx["AH"],
                           json={"payment_status": "paid", "code": "HACK", "approval_status": "approved"}, timeout=30)
        assert r.status_code == 400, f"{r.status_code}: {r.text[:300]}"
        g = ctx["s"].get(f"{API}/transactions/{ctx['store']['txn_id']}", headers=ctx["AH"], timeout=30).json()
        assert g["payment_status"] == "approved" and g["code"] != "HACK"

    def test_08_patch_unknown_id_404(self, ctx):
        r = ctx["s"].patch(f"{API}/transactions/does-not-exist", headers=ctx["AH"],
                           json={"amount": 1}, timeout=30)
        assert r.status_code == 404, f"{r.status_code}: {r.text[:200]}"

    def test_09_patch_reversed_txn_400(self, ctx):
        paid = mk_txn(ctx, ctx["AH"], stage="post_tender", category="Transport",
                      description="TEST_to reverse", amount=8000, payment_status="paid",
                      paid_by="Company", account="HDFC CC")
        rv = ctx["s"].post(f"{API}/transactions/{paid['id']}/reverse", headers=ctx["AH"],
                           json={"reason": "TEST reversal"}, timeout=90)
        assert rv.status_code == 200, rv.text[:300]
        r = ctx["s"].patch(f"{API}/transactions/{paid['id']}", headers=ctx["AH"],
                           json={"amount": 1000}, timeout=30)
        assert r.status_code == 400, f"{r.status_code}: {r.text[:300]}"
        # net effect of reversal pair still zero
        d = dash(ctx)
        assert d["post_tender_cost"] == 12000, f"reversal pair not netted: {d['post_tender_cost']}"

    def test_10_staff_cannot_patch_approved(self, ctx):
        r = ctx["s"].patch(f"{API}/transactions/{ctx['store']['txn_id']}", headers=ctx["SH"],
                           json={"amount": 1}, timeout=30)
        assert r.status_code == 403, f"{r.status_code}: {r.text[:300]}"

    # ---------- (c) DELETE ----------
    def test_11_delete_requested_ok(self, ctx):
        t = mk_txn(ctx, ctx["SH"], description="TEST_delete requested", amount=1111)
        r = ctx["s"].delete(f"{API}/transactions/{t['id']}", headers=ctx["AH"], timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        g = ctx["s"].get(f"{API}/transactions/{t['id']}", headers=ctx["AH"], timeout=30)
        assert g.status_code == 404

    def test_12_delete_rejected_ok(self, ctx):
        t = mk_txn(ctx, ctx["SH"], description="TEST_delete rejected", amount=2222)
        ctx["s"].post(f"{API}/transactions/{t['id']}/approve", headers=ctx["AH"],
                      json={"action": "reject", "remarks": "TEST"}, timeout=90)
        r = ctx["s"].delete(f"{API}/transactions/{t['id']}", headers=ctx["AH"], timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert ctx["s"].get(f"{API}/transactions/{t['id']}", headers=ctx["AH"], timeout=30).status_code == 404

    def test_13_delete_payable_ok(self, ctx):
        r = ctx["s"].delete(f"{API}/transactions/{ctx['store']['payable_id']}", headers=ctx["AH"], timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = dash(ctx)
        assert d["payables"] == 0, d

    def test_14_delete_approved_409(self, ctx):
        r = ctx["s"].delete(f"{API}/transactions/{ctx['store']['txn_id']}", headers=ctx["AH"], timeout=30)
        assert r.status_code == 409, f"{r.status_code}: {r.text[:300]}"
        assert "reverse" in r.text.lower()
        assert ctx["s"].get(f"{API}/transactions/{ctx['store']['txn_id']}", headers=ctx["AH"], timeout=30).status_code == 200

    def test_15_delete_paid_409(self, ctx):
        t = mk_txn(ctx, ctx["AH"], stage="post_tender", category="Transport", amount=3333,
                   payment_status="paid", paid_by="Company", account="HDFC CC",
                   description="TEST_paid nodelete")
        r = ctx["s"].delete(f"{API}/transactions/{t['id']}", headers=ctx["AH"], timeout=30)
        assert r.status_code == 409, f"{r.status_code}: {r.text[:300]}"
        assert "reverse" in r.text.lower()

    def test_16_staff_cannot_delete(self, ctx):
        t = mk_txn(ctx, ctx["SH"], description="TEST_staff delete attempt", amount=4444)
        r = ctx["s"].delete(f"{API}/transactions/{t['id']}", headers=ctx["SH"], timeout=30)
        assert r.status_code == 403, f"{r.status_code}: {r.text[:300]}"
        assert ctx["s"].get(f"{API}/transactions/{t['id']}", headers=ctx["AH"], timeout=30).status_code == 200

    def test_17_delete_unknown_404(self, ctx):
        r = ctx["s"].delete(f"{API}/transactions/nope-nope", headers=ctx["AH"], timeout=30)
        assert r.status_code == 404, f"{r.status_code}: {r.text[:200]}"

    def test_99_cleanup(self, ctx):
        r = ctx["s"].post(f"{API}/admin/reset", headers=ctx["AH"], json={"confirm": "RESET"}, timeout=120)
        assert r.status_code == 200
