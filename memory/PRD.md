# Bright India Traders — Tender Finance System

## Original Problem Statement
Build a complete tender finance system for a textile trading business that participates in government tenders. Core principle: every financial event is entered once, tagged (Tender/Item/Category/Stage), approved where required, paid, matched with the bank, and then automatically appears in every report (Tender P&L, Item P&L, Receivables/Payables, Working Capital, Bank Reconciliation, Estimate vs Actual).

## User Personas
- **Owner / Approver ("Dad")** — Admin role. Approves every discretionary expense before payment. Reviews dashboard, sees tender P&L, working capital, EBG blocked, EMD outstanding.
- **Staff ("Bharath")** — Requestor. Enters day-to-day transactions (stamp paper, courier, weaving bills, transport). Cannot approve.
- **Viewer** — Read-only stakeholder (accountant/auditor).

## Architecture
- **Backend**: FastAPI + Motor (MongoDB) + PyJWT auth + bcrypt. All routes under `/api`.
- **Frontend**: React 19 + React Router + Recharts + shadcn/ui + Tailwind. Sidebar layout, IBM Plex Sans typography, Swiss high-contrast finance-grade theme.
- **Storage**: Emergent object storage for bill/receipt uploads (soft-delete via `is_deleted`).
- **Auth**: JWT Bearer (30-day), stored in `localStorage`.

## What's Been Implemented (2026-02-27)
- **Auth & Roles**: JWT login with Admin/Staff/Viewer. Admin+Staff seeded on startup.
- **Tender Master**: BIT-YYYY-### auto-codes, full 13-status pipeline (Identified → Completed), CRUD + status change.
- **Item Master**: BIT-YYYY-###-I## codes under each tender with quantity/unit/rate/estimated_cost.
- **Transaction Ledger**: One unified table with stage (Pre/Post/Admin) → category cascade, vendor, amount, tender_id, item_id, payment_status, paid_by, account, file attachment. TXN-###### codes.
- **Approval Workflow**: `requested` → admin approves/rejects/queries. Staff cannot approve (403).
- **Bank Reconciliation**: CSV upload (auto-parses Date/Description/Debit/Credit), manual entry, side-by-side match UI, reconciled flag on both bank and ledger records.
- **EBG Register**: Separate from expenses. Active/Released/Expired lifecycle. Aggregated blocked-amount KPI.
- **Receivables**: Invoice → Receipt (with LD deduction) → auto-creates income transaction → auto-reduces outstanding.
- **Payables**: Purchase txns in `payable` status → mark-paid modal with account + bank ref.
- **Dashboard**: 6 KPIs (revenue, receivables, payables, gross contribution, EBG blocked, EMD outstanding), Revenue-vs-Costs bar chart, Working Capital snapshot.
- **Tender P&L**: Per-tender revenue, pre/post cost breakdown by category, contribution & margin, per-item P&L with estimate-vs-actual variance.
- **File Uploads**: Object-storage-backed bill/receipt attachment on transactions.
- **Master Data**: 13 tender statuses, 27 categories across 3 stages, 6 accounts (ICICI/HDFC/SBI/Cash/Dad/Bharath) all seeded.

## Backlog / Next Phase
- **P0**: Weekly/Monthly review reports (email digest), Tender acquisition-cost report (₹ per L1 won)
- **P1**: Estimate-vs-Actual comparison table on tender page (side-by-side with edit-estimate flow), Supplier ledger view (grouped payables by vendor)
- **P1**: EBG expiry reminders (60/30/7 days before expiry)
- **P2**: GST breakdown per txn, Sample tracking register, Personal-money-payable (Dad reimbursement) rollup screen
- **P2**: Advanced item-cost allocation rules (allocate shared fabric to items by qty/rate)
- **P2**: Two-tier approval limits (₹0-5k department, ₹5k-25k Dad, ₹25k+ dual approval)
