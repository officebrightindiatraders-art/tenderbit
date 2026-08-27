import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { Plus, ShieldCheck } from 'lucide-react';

export default function EBG() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [showForm, setShowForm] = useState(false);

  const load = () => api.get('/ebg').then((r) => setRows(r.data));
  useEffect(() => { load(); api.get('/tenders').then((r) => setTenders(r.data)); }, []);

  const release = async (id) => {
    await api.post(`/ebg/${id}/release`, { released_date: new Date().toISOString().slice(0, 10) });
    toast.success('EBG released');
    load();
  };

  const tenderCode = (id) => tenders.find((t) => t.id === id)?.code || '—';

  const daysLeft = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / (1000 * 60 * 60 * 24));
  };
  const severity = (days) => {
    if (days == null) return null;
    if (days <= 7) return { cls: 'pill-danger', label: `${days}d left`, icon: '⚠' };
    if (days <= 30) return { cls: 'pill-warning', label: `${days}d left`, icon: '⏱' };
    if (days <= 60) return { cls: 'pill-muted', label: `${days}d left`, icon: '' };
    return null;
  };

  const active = rows.filter((r) => r.status === 'active');
  const totalBlocked = active.reduce((s, r) => s + r.amount, 0);
  const expiringCount = active.filter((r) => { const d = daysLeft(r.expiry_date); return d != null && d <= 60; }).length;

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="section-label mb-1">Financial Commitments</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">EBG / Bank Guarantees</h1>
          <p className="text-sm text-slate-500 mt-1">Not the same as an expense — this is money blocked or secured.</p>
        </div>
        {user?.role !== 'viewer' && (
          <button data-testid="new-ebg-btn" onClick={() => setShowForm(true)} className="bg-[#1E1B4B] hover:bg-[#312e81] text-white text-sm px-4 py-2.5 rounded-sm flex items-center gap-2"><Plus className="w-4 h-4" />New EBG</button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="kpi"><div className="kpi-label">Active EBGs</div><div className="kpi-value">{active.length}</div></div>
        <div className="kpi"><div className="kpi-label">Blocked Amount</div><div className="kpi-value text-indigo-900">{formatINR(totalBlocked)}</div></div>
        <div className="kpi"><div className="kpi-label">Expiring in 60 Days</div><div className={`kpi-value ${expiringCount > 0 ? 'text-red-700' : ''}`}>{expiringCount}</div></div>
        <div className="kpi"><div className="kpi-label">Released This Year</div><div className="kpi-value text-emerald-700">{rows.filter((r) => r.status === 'released').length}</div></div>
      </div>

      <div className="data-card overflow-hidden">
        <table className="w-full data-table">
          <thead><tr>
            <th>Tender</th><th>Bank</th><th>Reference</th><th>Issue</th><th>Expiry</th>
            <th className="text-right">Amount</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const days = r.status === 'active' ? daysLeft(r.expiry_date) : null;
              const sev = severity(days);
              return (
              <tr key={r.id}>
                <td className="font-mono text-[12px] text-indigo-900">{tenderCode(r.tender_id)}</td>
                <td>{r.bank}</td>
                <td className="font-mono text-xs text-slate-600">{r.reference || '—'}</td>
                <td>{formatDate(r.issue_date)}</td>
                <td>
                  <div>{formatDate(r.expiry_date)}</div>
                  {sev && <span className={`pill ${sev.cls} mt-0.5 inline-block`}>{sev.icon} {sev.label}</span>}
                  {r.status === 'released' && r.released_date && <div className="text-[10px] text-emerald-700 mt-0.5">Released {formatDate(r.released_date)}</div>}
                </td>
                <td className="num-cell font-semibold">{formatINR(r.amount)}</td>
                <td><span className={`pill ${r.status === 'active' ? 'pill-warning' : r.status === 'released' ? 'pill-success' : 'pill-danger'}`}>{r.status}</span></td>
                <td className="text-right">
                  {r.status === 'active' && user?.role !== 'viewer' && (
                    <button onClick={() => release(r.id)} className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm flex items-center gap-1 ml-auto"><ShieldCheck className="w-3 h-3" />Release</button>
                  )}
                </td>
              </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">No EBGs recorded.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <EBGForm tenders={tenders} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function EBGForm({ tenders, onClose, onSaved }) {
  const [form, setForm] = useState({ tender_id: '', amount: 0, bank: 'ICICI', issue_date: todayISO(), expiry_date: '', reference: '', status: 'active' });
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/ebg', form); toast.success('EBG added'); onSaved(); }
    catch (err) { toast.error('Failed'); }
  };
  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-16 px-4">
      <form onSubmit={submit} className="bg-white w-full max-w-lg rounded-sm border border-slate-200 shadow-lg" data-testid="ebg-form">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center"><h3 className="font-display text-lg font-semibold">New EBG</h3><button type="button" onClick={onClose}>✕</button></div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <label className="block col-span-2"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Tender *</span>
            <select required value={form.tender_id} onChange={(e) => setForm({ ...form, tender_id: e.target.value })} className={inp}>
              <option value="">Select…</option>
              {tenders.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Amount (₹) *</span><input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className={inp} data-testid="ebg-amount" /></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Bank</span><input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={inp} /></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Issue Date</span><input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} className={inp} /></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Expiry Date</span><input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className={inp} /></label>
          <label className="block col-span-2"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Reference</span><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={inp} /></label>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
          <button type="submit" data-testid="ebg-submit" className="px-4 py-2 text-sm bg-[#1E1B4B] text-white rounded-sm">Save</button>
        </div>
      </form>
    </div>
  );
}
