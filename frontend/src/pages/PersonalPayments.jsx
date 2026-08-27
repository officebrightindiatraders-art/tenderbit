import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '@/lib/api';
import { formatINR, formatDate } from '@/lib/format';
import { Wallet } from 'lucide-react';

export default function PersonalPayments() {
  const [data, setData] = useState({});
  const [params] = useSearchParams();
  const focusPerson = params.get('person');

  useEffect(() => { api.get('/reports/personal-payments').then((r) => setData(r.data)); }, []);

  const people = Object.keys(data).sort();
  const grandTotal = people.reduce((s, p) => s + data[p].total, 0);

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="section-label mb-1">Reimbursements</div>
      <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Personal Payments</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">Money paid personally by Dad, Bharath or others — awaiting reimbursement.</p>

      <div className="kpi max-w-sm mb-6">
        <div className="kpi-label">Total to Reimburse</div>
        <div className="kpi-value text-indigo-900">{formatINR(grandTotal)}</div>
        <div className="kpi-sub">Across {people.length} people</div>
      </div>

      {people.length === 0 && (
        <div className="data-card p-10 text-center">
          <Wallet className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <div className="text-sm text-slate-500">No personal payments yet. When a transaction is marked as "Paid By: Dad / Bharath", it will show up here.</div>
        </div>
      )}

      {people.map((person) => {
        const info = data[person];
        return (
          <div key={person} className="data-card mb-6 overflow-hidden" data-testid={`person-${person}`}>
            <div className={`px-5 py-4 border-b border-slate-200 flex items-center justify-between ${focusPerson === person ? 'bg-indigo-50' : 'bg-slate-50/60'}`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#1E1B4B] text-white font-semibold flex items-center justify-center">
                  {person.slice(0, 1)}
                </div>
                <div>
                  <div className="font-display font-semibold text-slate-900">{person}</div>
                  <div className="text-xs text-slate-500">{info.transactions.length} transactions</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase text-slate-500 font-semibold tracking-wider">To reimburse</div>
                <div className="num text-xl font-semibold text-indigo-900">{formatINR(info.total)}</div>
              </div>
            </div>
            <table className="w-full data-table">
              <thead><tr>
                <th>TXN</th><th>Date</th><th>Tender</th><th>Category</th><th>Description</th>
                <th>Status</th><th className="text-right">Amount</th>
              </tr></thead>
              <tbody>
                {info.transactions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((t) => (
                  <tr key={t.id}>
                    <td><Link to={`/transactions?txn=${t.id}`} className="font-mono text-[12px] text-indigo-700 hover:underline">{t.code}</Link></td>
                    <td>{formatDate(t.date)}</td>
                    <td className="font-mono text-[12px] text-indigo-900">{t.tender_code}</td>
                    <td>{t.category}</td>
                    <td className="text-slate-600 max-w-xs truncate">{t.description || t.vendor || '—'}</td>
                    <td><span className={`pill ${t.payment_status === 'paid' ? 'pill-success' : 'pill-warning'}`}>{t.payment_status}</span></td>
                    <td className={`num-cell font-semibold ${t.txn_type === 'reimbursement' ? 'text-emerald-700' : ''}`}>
                      {t.txn_type === 'reimbursement' ? '-' : ''}{formatINR(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
