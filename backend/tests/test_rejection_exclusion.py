"""Iteration 4 — rejected / reversed transactions must be excluded from all cost aggregations.

Single test class (keeps ordering deterministic under pytest-xdist --dist loadscope) that:
  1. resets DB, creates tender
  2. staff creates a pre_tender EMD txn (requested) -> admin REJECTS it
  3. asserts dashboard + tender-pnl are all zeros, pending_approvals == 0
  4. asserts the rejected row is still listed with payment_status 'rejected'
  5. creates a paid txn, admin REVERSES it -> dashboard must not include it
  6. regression: a normal approved txn still counts
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
REJECT_AMOUNT = 1284394.0
REVERSE_AMOUNT = 50000.0
GOOD_AMOUNT = 7000.0


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

    admin = login(emails[0], passwords[0])
    staff = login(emails[1], passwords[1])
    return {
        "s": s,
        "AH": {"Authorization": f"Bearer {admin}"},
        "SH": {"Authorization": f"Bearer {staff}"},
        "store": {},
    }


class TestRejectedReversedExclusion:
    # ---- setup: clean slate + tender ----
    def test_01_reset(self, ctx):
        r = ctx["s"].post(f"{API}/admin/reset", headers=ctx["AH"], json={"confirm": "RESET"}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("ok") is True
        d = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d["pre_tender_cost"] == 0 and d["total_actual_cost"] == 0
        assert d["emd_outstanding"] == 0 and d["pending_approvals"] == 0

    def test_02_create_tender(self, ctx):
        payload = {
            "tender_no": "TEST_REJ_001", "department": "TEST_PWD", "name": "TEST_Rejection Tender",
            "tender_date": TODAY, "closing_date": TODAY, "tender_value": 5000000,
            "emd_amount": REJECT_AMOUNT, "status": "Participating", "responsible": "Bharath",
        }
        r = ctx["s"].post(f"{API}/tenders", headers=ctx["AH"], json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "_id" not in d
        ctx["store"]["tender_id"] = d["id"]

    # ---- staff creates, admin rejects ----
    def test_03_staff_creates_requested_emd(self, ctx):
        payload = {
            "date": TODAY, "txn_type": "expense", "tender_id": ctx["store"]["tender_id"],
            "stage": "pre_tender", "category": "EMD", "description": "TEST EMD to be rejected",
            "amount": REJECT_AMOUNT, "payment_status": "requested", "paid_by": "Dad", "account": "",
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["SH"], json=payload, timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["amount"] == REJECT_AMOUNT
        assert d["approval_status"] == "pending" and d["payment_status"] == "requested"
        ctx["store"]["rej_id"] = d["id"]

        dash = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        # Iteration 8 approval rule: 'requested' txns must NOT be counted in cost KPIs
        assert dash["pre_tender_cost"] == 0, "requested txn must be excluded from pre_tender_cost"
        assert dash["pending_approvals"] == 1

    def test_04_admin_rejects(self, ctx):
        r = ctx["s"].post(f"{API}/transactions/{ctx['store']['rej_id']}/approve", headers=ctx["AH"],
                          json={"action": "reject", "remarks": "TEST rejection"}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        g = ctx["s"].get(f"{API}/transactions/{ctx['store']['rej_id']}", headers=ctx["AH"], timeout=30)
        t = g.json()
        assert t["approval_status"] == "rejected"
        assert t["payment_status"] == "rejected"

    def test_05_dashboard_all_zero_after_reject(self, ctx):
        d = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d["pre_tender_cost"] == 0, d
        assert d["post_tender_cost"] == 0, d
        assert d["admin_cost"] == 0, d
        assert d["total_actual_cost"] == 0, d
        assert d["emd_outstanding"] == 0, d
        assert d["gross_contribution"] == 0, d
        assert d["operating_contribution"] == 0, d
        assert d["payables"] == 0, d
        assert d["pending_approvals"] == 0, d
        assert d["action_required"]["pending_approvals"] == 0, d

    def test_06_tender_pnl_zero_after_reject(self, ctx):
        r = ctx["s"].get(f"{API}/reports/tender-pnl/{ctx['store']['tender_id']}", headers=ctx["AH"], timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["pre_total"] == 0, d
        assert d["post_total"] == 0, d
        assert d["total_cost"] == 0, d
        assert d["contribution"] == 0, d
        assert d["margin"] == 0, d
        assert sum(d["pre_tender"].values()) == 0, d["pre_tender"]

    def test_07_rejected_row_still_listed(self, ctx):
        r = ctx["s"].get(f"{API}/transactions", headers=ctx["AH"], timeout=30)
        assert r.status_code == 200
        rows = {t["id"]: t for t in r.json()["items"]}
        assert ctx["store"]["rej_id"] in rows, "rejected txn disappeared from list"
        assert rows[ctx["store"]["rej_id"]]["payment_status"] == "rejected"

    def test_08_rejected_details_endpoint(self, ctx):
        r = ctx["s"].get(f"{API}/transactions/{ctx['store']['rej_id']}/details", headers=ctx["AH"], timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert any("reject" in h["action"] for h in d["history"]), [h["action"] for h in d["history"]]

    def test_09_payables_excludes_rejected(self, ctx):
        r = ctx["s"].get(f"{API}/reports/payables", headers=ctx["AH"], timeout=30)
        assert r.status_code == 200
        assert ctx["store"]["rej_id"] not in [t["id"] for t in r.json()]

    # ---- reversal exclusion ----
    def test_10_create_paid_txn_and_reverse(self, ctx):
        payload = {
            "date": TODAY, "txn_type": "expense", "tender_id": ctx["store"]["tender_id"],
            "stage": "post_tender", "category": "Transport", "description": "TEST paid to be reversed",
            "amount": REVERSE_AMOUNT, "payment_status": "paid", "paid_by": "Company", "account": "HDFC CC",
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["AH"], json=payload, timeout=90)
        assert r.status_code == 200, r.text[:400]
        ctx["store"]["rev_id"] = r.json()["id"]

        d = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d["post_tender_cost"] == REVERSE_AMOUNT, d

        rv = ctx["s"].post(f"{API}/transactions/{ctx['store']['rev_id']}/reverse", headers=ctx["AH"],
                           json={"reason": "TEST reversal"}, timeout=90)
        assert rv.status_code == 200, rv.text[:300]
        g = ctx["s"].get(f"{API}/transactions/{ctx['store']['rev_id']}", headers=ctx["AH"], timeout=30).json()
        assert g.get("is_reversed") is True

    def test_11_dashboard_excludes_reversed(self, ctx):
        d = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d["post_tender_cost"] == 0, f"reversed txn still affects post_tender_cost: {d['post_tender_cost']}"
        assert d["total_actual_cost"] == 0, d
        assert d["pre_tender_cost"] == 0, d

    def test_12_tender_pnl_excludes_reversed(self, ctx):
        d = ctx["s"].get(f"{API}/reports/tender-pnl/{ctx['store']['tender_id']}", headers=ctx["AH"], timeout=30).json()
        assert d["post_total"] == 0, f"reversed txn still in pnl post_total: {d['post_total']}"
        assert d["total_cost"] == 0, d

    # ---- regression: valid txn still counts ----
    def test_13_valid_txn_still_counts(self, ctx):
        payload = {
            "date": TODAY, "txn_type": "expense", "tender_id": ctx["store"]["tender_id"],
            "stage": "pre_tender", "category": "Tender Fee", "description": "TEST valid tender fee",
            "amount": GOOD_AMOUNT, "payment_status": "paid", "paid_by": "Company", "account": "HDFC CC",
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["AH"], json=payload, timeout=90)
        assert r.status_code == 200, r.text[:400]
        ctx["store"]["good_id"] = r.json()["id"]

        d = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d["pre_tender_cost"] == GOOD_AMOUNT, d
        assert d["total_actual_cost"] == GOOD_AMOUNT, d
        assert d["gross_contribution"] == -GOOD_AMOUNT, d

        p = ctx["s"].get(f"{API}/reports/tender-pnl/{ctx['store']['tender_id']}", headers=ctx["AH"], timeout=30).json()
        assert p["pre_total"] == GOOD_AMOUNT, p
        assert p["total_cost"] == GOOD_AMOUNT, p
        assert p["contribution"] == -GOOD_AMOUNT, p

    def test_14_payable_txn_counts_then_rejected_excluded(self, ctx):
        payload = {
            "date": TODAY, "txn_type": "expense", "tender_id": ctx["store"]["tender_id"],
            "stage": "post_tender", "category": "Transport", "description": "TEST payable",
            "amount": 3000, "payment_status": "payable", "paid_by": "Company", "account": "",
            "due_date": TODAY,
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["AH"], json=payload, timeout=90)
        assert r.status_code == 200, r.text[:400]
        pid = r.json()["id"]
        d = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d["payables"] == 3000, d
        assert pid in [t["id"] for t in ctx["s"].get(f"{API}/reports/payables", headers=ctx["AH"], timeout=30).json()]

        rj = ctx["s"].post(f"{API}/transactions/{pid}/approve", headers=ctx["AH"],
                           json={"action": "reject", "remarks": "TEST reject payable"}, timeout=90)
        assert rj.status_code == 200, rj.text[:300]
        d2 = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d2["payables"] == 0, d2
        assert pid not in [t["id"] for t in ctx["s"].get(f"{API}/reports/payables", headers=ctx["AH"], timeout=30).json()]

    def test_15_emd_refund_flow_regression(self, ctx):
        """EMD paid then refunded -> emd_outstanding back to 0; refund excluded when reversed."""
        base = {
            "date": TODAY, "tender_id": ctx["store"]["tender_id"], "stage": "pre_tender",
            "category": "EMD", "paid_by": "Company", "account": "HDFC CC", "payment_status": "paid",
        }
        e1 = ctx["s"].post(f"{API}/transactions", headers=ctx["AH"],
                           json={**base, "txn_type": "expense", "amount": 10000, "description": "TEST EMD paid"},
                           timeout=90)
        assert e1.status_code == 200, e1.text[:300]
        d = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d["emd_outstanding"] == 10000, d

        e2 = ctx["s"].post(f"{API}/transactions", headers=ctx["AH"],
                           json={**base, "txn_type": "refund", "amount": 10000, "description": "TEST EMD refund"},
                           timeout=90)
        assert e2.status_code == 200, e2.text[:300]
        d2 = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d2["emd_outstanding"] == 0, d2

    # ---- iteration 5: missing_proof must ignore reversed pair ----
    def test_16_missing_proof_excludes_reversed_pair(self, ctx):
        d0 = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        base_mp = d0["action_required"]["missing_proof"]

        payload = {
            "date": TODAY, "txn_type": "expense", "tender_id": ctx["store"]["tender_id"],
            "stage": "post_tender", "category": "Transport", "description": "TEST paid no proof",
            "amount": 2500, "payment_status": "paid", "paid_by": "Company", "account": "HDFC CC",
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["AH"], json=payload, timeout=90)
        assert r.status_code == 200, r.text[:400]
        tid = r.json()["id"]
        d1 = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d1["action_required"]["missing_proof"] == base_mp + 1, d1["action_required"]

        rv = ctx["s"].post(f"{API}/transactions/{tid}/reverse", headers=ctx["AH"],
                           json={"reason": "TEST reversal mp"}, timeout=90)
        assert rv.status_code == 200, rv.text[:300]
        d2 = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d2["action_required"]["missing_proof"] == base_mp, \
            f"reversed pair still counted in missing_proof: {d2['action_required']}"
        # cost aggregation must be unchanged by the reversed pair
        assert d2["post_tender_cost"] == d1["post_tender_cost"] - 2500, d2

    # ---- iteration 5: personal reimbursement rollup with reversal ----
    def test_17_personal_reimbursement_excludes_reversed_pair(self, ctx):
        payload = {
            "date": TODAY, "txn_type": "expense", "tender_id": ctx["store"]["tender_id"],
            "stage": "post_tender", "category": "Transport", "description": "TEST dad paid",
            "amount": 5000, "payment_status": "paid", "paid_by": "Dad", "account": "",
        }
        r = ctx["s"].post(f"{API}/transactions", headers=ctx["AH"], json=payload, timeout=90)
        assert r.status_code == 200, r.text[:400]
        tid = r.json()["id"]
        d1 = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        assert d1["personal_reimbursement"].get("Dad") == 5000, d1["personal_reimbursement"]

        rv = ctx["s"].post(f"{API}/transactions/{tid}/reverse", headers=ctx["AH"],
                           json={"reason": "TEST reversal personal"}, timeout=90)
        assert rv.status_code == 200, rv.text[:300]
        d2 = ctx["s"].get(f"{API}/reports/dashboard", headers=ctx["AH"], timeout=30).json()
        pp = ctx["s"].get(f"{API}/reports/personal-payments", headers=ctx["AH"], timeout=30).json()
        dad_total = pp.get("Dad", {}).get("total", 0)
        assert d2["personal_reimbursement"].get("Dad", 0) == 0, \
            f"reversed pair leaves wrong personal_reimbursement: {d2['personal_reimbursement']} / personal-payments Dad total={dad_total}"
        assert dad_total == 0, f"/reports/personal-payments Dad total wrong after reversal: {dad_total}"

    # ---- cleanup ----
    def test_99_cleanup(self, ctx):
        r = ctx["s"].post(f"{API}/admin/reset", headers=ctx["AH"], json={"confirm": "RESET"}, timeout=120)
        assert r.status_code == 200
