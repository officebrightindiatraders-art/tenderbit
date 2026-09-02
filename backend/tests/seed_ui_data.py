"""Seed minimal UI test data (tender + requested/paid txns) for frontend Playwright run."""
import os
import re
from datetime import date
from pathlib import Path

import requests
from dotenv import dotenv_values

API = (os.environ.get("REACT_APP_BACKEND_URL")
       or dotenv_values("/app/frontend/.env").get("REACT_APP_BACKEND_URL")).rstrip("/") + "/api"
c = Path("/app/memory/test_credentials.md").read_text()
emails = re.findall(r"(?im)^\s*[-*]\s*\*\*Email\*\*\s*:\s*(\S+)", c)
pwds = re.findall(r"(?im)^\s*[-*]\s*\*\*Password\*\*\s*:\s*(\S+)", c)
tok = requests.post(f"{API}/auth/login", json={"email": emails[0], "password": pwds[0]}, timeout=30).json()["token"]
H = {"Authorization": f"Bearer {tok}"}
TODAY = date.today().isoformat()

t = requests.post(f"{API}/tenders", headers=H, json={
    "tender_no": "TEST_UI_001", "department": "TEST_PWD", "name": "TEST_UI Tender",
    "tender_date": TODAY, "closing_date": TODAY, "tender_value": 900000,
    "emd_amount": 50000, "status": "Participating", "responsible": "Bharath"}, timeout=30)
t.raise_for_status()
tid = t.json()["id"]


def txn(**o):
    p = {"date": TODAY, "txn_type": "expense", "tender_id": tid, "stage": "pre_tender",
         "category": "EMD", "description": "TEST_ui", "amount": 50000,
         "payment_status": "requested", "paid_by": "Dad", "account": ""}
    p.update(o)
    r = requests.post(f"{API}/transactions", headers=H, json=p, timeout=90)
    r.raise_for_status()
    return r.json()


a = txn(description="TEST_ui requested EMD")
b = txn(stage="post_tender", category="Transport", description="TEST_ui paid transport",
        amount=9000, payment_status="paid", paid_by="Company", account="HDFC CC")
print("tender", tid)
print("requested", a["code"], a["id"])
print("paid", b["code"], b["id"])
