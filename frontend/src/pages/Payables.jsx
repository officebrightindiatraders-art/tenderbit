import { useEffect, useState, useMemo } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';

const bucketPill = (b) => ({
  current: 'pill-muted', '0-30': 'pill-primary', '31-60': 'pill-warning',
  '61-90': 'pill-danger', '90+': 'pill-danger',
})[b] || 'pill-muted';

export default function Payables() {
  const { masters, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = () => api.get('/reports/payables').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filter === 'overdue') return rows.filter((r) => r.days_overdue > 0);
    if (filter === 'due_soon') return rows.filter((r) => r.days_overdue <= 0 && r.days_overdue > -7);
    if (filter === 'current') return rows.filter((r) => r.days_overdue <= 0);
    return rows;
  }, [rows, filter]);

  const total = filtered.reduce((s, r) => s + r.amount, 0);
  const overdueTotal = rows.filter((r) => r.days_overdue > 0).reduce((s, r) => s + r.amount, 0);

  // Ageing buckets
  const buckets = { current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  rows.forEach((r) => { buckets[r.ageing] = (buckets[r.ageing] || 0) + r.amount; });

  return (
    <div className="p-8 max-w-[1500px]">
      <div className="section-label mb-1">Money We Need to Pay</div>
      <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Supplier Payables</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">Invoices recorded when received — not just when paid.</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="kpi"><div className="kpi-label">Total Payable</div><div className="kpi-value text-amber-700">{formatINR(rows.reduce((s, r) => s + r.amount, 0))}</div><div className="kpi-sub">{rows.length} open</div></div>
        <div className="kpi"><div className="kpi-label">Overdue</div><div className="kpi-value text-red-700">{formatINR(overdueTotal)}</div></div>
        <div className="kpi"><div className="kpi-label">0-30 Days</div><div className="kpi-value num">{formatINR(buckets['0-30'] || 0)}</div></div>
        <div className="kpi"><div className="kpi-label">31-60 Days</div><div className="kpi-value num text-amber-700">{formatINR(buckets['31-60'] || 0)}</div></div>
        <div className="kpi"><div className="kpi-label">60+ Days</div><div className="kpi-value num text-red-700">{formatINR((buckets['61-90'] || 0) + (buckets['90+'] || 0))}</div></div>
      </div>

      <div className="flex gap-2 mb-3">
        {[
          { k: 'all', l: 'All open' }, { k: 'overdue', l: 'Overdue' },
          { k: 'due_soon', l: 'Due soon' }, { k: 'current', l: 'Not yet due' },
        ].map((f) => (
          <button key={f.k} onClick={() => setFilter(f.k)} data-testid={`filter-${f.k}`}
            className={`px-3 py-1.5 text-xs rounded-sm ${filter === f.k ? 'bg-[#1E1B4B] text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            {f.l}
          </button>
        ))}
      </div>

      <div className="data-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 flex justify-between items-center bg-slate-50/60">
          <div className="text-sm text-slate-700"><span className="font-mono font-semibold">{filtered.length}</span> bills</div>
          <div className="text-sm"><span className="text-slate-500">Total </span><span className="num font-semibold text-amber-700">{formatINR(total)}</span></div>
        </div>
        <table className="w-full data-table">
          <thead><tr>
            <th>TXN</th><th>Tender</th><th>Vendor</th><th>Category</th><th>Invoice Date</th>
            <th>Due Date</th><th>Ageing</th><th className="text-right">Amount</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} data-testid={`payable-${r.code}`}>
                <td className="font-mono text-[12px]">{r.code}</td>
                <td className="font-mono text-[12px] text-indigo-900">{r.tender_code}</td>
                <td>{r.vendor || '—'}</td>
                <td>{r.category}</td>
                <td>{formatDate(r.invoice_date || r.date)}</td>
                <td>{formatDate(r.due_date)}</td>
                <td>
                  <span className={`pill ${bucketPill(r.ageing)}`}>{r.ageing}</span>
                  {r.days_overdue > 0 && <span className="text-red-700 text-xs ml-1">({r.days_overdue}d overdue)</span>}
                </td>
                <td className="num-cell font-semibold text-amber-700">{formatINR(r.amount)}</td>
                <td className="text-right">
                  {user?.role !== 'viewer' && <button onClick={() => setSelected(r)} className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm">Mark Paid</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-slate-400 text-sm">No open bills in this view.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && <PayModal txn={selected} accounts={masters.accounts} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} />}
    </div>
  );
}

function PayModal({ txn, accounts, onClose, onSaved }) {
  const [form, setForm] = useState({ account: accounts[0] || 'ICICI', payment_date: todayISO(), bank_reference: '' });
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post(`/transactions/${txn.id}/pay`, form); toast.success('Marked paid'); onSaved(); }
    catch (err) { toast.error('Failed'); }
  };
  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-16 px-4">
      <form onSubmit={submit} className="bg-white w-full max-w-md rounded-sm border border-slate-200 shadow-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
          <div><h3 className="font-display text-lg font-semibold">Mark Paid</h3><div className="text-xs text-slate-500 mt-0.5">{txn.code} · {formatINR(txn.amount)}</div></div>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Account</span><select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} className={inp}>{accounts.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Payment Date</span><input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} className={inp} /></label>
          <label className="col-span-2 block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Bank Reference</span><input value={form.bank_reference} onChange={(e) => setForm({ ...form, bank_reference: e.target.value })} className={inp} /></label>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm">Confirm Payment</button>
        </div>
      </form>
    </div>
  );
}
