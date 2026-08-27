import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';

export default function Payables() {
  const { masters, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = () => api.get('/reports/payables').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="section-label mb-1">Money Going Out</div>
      <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Supplier Payables</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">Invoices recorded when received — not just when paid.</p>

      <div className="kpi mb-6 max-w-sm">
        <div className="kpi-label">Total Payable</div>
        <div className="kpi-value text-amber-700">{formatINR(total)}</div>
        <div className="kpi-sub">{rows.length} open bills</div>
      </div>

      <div className="data-card overflow-hidden">
        <table className="w-full data-table">
          <thead><tr>
            <th>TXN</th><th>Tender</th><th>Vendor</th><th>Category</th><th>Invoice Date</th>
            <th>Due Date</th><th className="text-right">Amount</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`payable-${r.code}`}>
                <td className="font-mono text-[12px]">{r.code}</td>
                <td className="font-mono text-[12px] text-indigo-900">{r.tender_code}</td>
                <td>{r.vendor || '—'}</td>
                <td>{r.category}</td>
                <td>{formatDate(r.invoice_date || r.date)}</td>
                <td>{formatDate(r.due_date)}</td>
                <td className="num-cell font-semibold text-amber-700">{formatINR(r.amount)}</td>
                <td className="text-right">
                  {user?.role !== 'viewer' && <button onClick={() => setSelected(r)} className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm">Mark Paid</button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">No open payables.</td></tr>}
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
