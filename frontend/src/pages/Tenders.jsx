import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';

const statusPill = (s) => {
  if (['L1', 'AOC Received', 'Execution'].includes(s)) return 'pill-success';
  if (['Not L1', 'Cancelled', 'Technically Disqualified'].includes(s)) return 'pill-danger';
  if (['Completed'].includes(s)) return 'pill-primary';
  return 'pill-warning';
};

export default function Tenders() {
  const { masters, user } = useAuth();
  const [tenders, setTenders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const nav = useNavigate();

  const load = () => api.get('/tenders').then((r) => setTenders(r.data));
  useEffect(() => { load(); }, []);

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="section-label mb-1">Master Registry</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Tenders</h1>
          <p className="text-sm text-slate-500 mt-1">Every tender gets a unique BIT ID. All expenses attach here.</p>
        </div>
        {user?.role !== 'viewer' && (
          <button
            data-testid="new-tender-btn"
            onClick={() => setShowForm(true)}
            className="bg-[#1E1B4B] hover:bg-[#312e81] text-white text-sm px-4 py-2.5 rounded-sm flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Tender
          </button>
        )}
      </div>

      <div className="data-card overflow-hidden">
        <table className="w-full data-table">
          <thead>
            <tr>
              <th>Tender ID</th><th>Tender No.</th><th>Department</th><th>Name</th>
              <th>Closing</th><th className="text-right">Value</th><th className="text-right">EMD</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tenders.map((t) => (
              <tr
                key={t.id}
                onClick={() => nav(`/tenders/${t.id}`)}
                className="cursor-pointer"
                data-testid={`tender-row-${t.code}`}
              >
                <td className="font-mono text-[13px] text-indigo-900 font-semibold">{t.code}</td>
                <td className="text-slate-600">{t.tender_no || '—'}</td>
                <td>{t.department}</td>
                <td className="max-w-xs truncate">{t.name}</td>
                <td className="text-slate-600">{formatDate(t.closing_date)}</td>
                <td className="num-cell">{formatINR(t.tender_value)}</td>
                <td className="num-cell">{formatINR(t.emd_amount)}</td>
                <td><span className={`pill ${statusPill(t.status)}`}>{t.status}</span></td>
              </tr>
            ))}
            {tenders.length === 0 && (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">No tenders yet. Click <b>New Tender</b> to begin.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && <TenderForm statuses={masters.statuses} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function TenderForm({ statuses, onClose, onSaved }) {
  const [form, setForm] = useState({
    tender_no: '', department: '', name: '',
    tender_date: todayISO(), closing_date: '',
    tender_value: 0, emd_amount: 0, status: 'Identified',
    responsible: '', notes: '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/tenders', form);
      toast.success(`Created ${data.code}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed');
    } finally { setBusy(false); }
  };

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-16 px-4">
      <form onSubmit={submit} className="bg-white w-full max-w-2xl rounded-sm border border-slate-200 shadow-lg" data-testid="tender-form">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="font-display text-lg font-semibold">New Tender</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <Field label="Government Tender No."><input value={form.tender_no} onChange={(e) => upd('tender_no', e.target.value)} className={inp} data-testid="tf-tenderno" /></Field>
          <Field label="Department *"><input required value={form.department} onChange={(e) => upd('department', e.target.value)} className={inp} data-testid="tf-department" /></Field>
          <Field label="Tender Name *" wide><input required value={form.name} onChange={(e) => upd('name', e.target.value)} className={inp} data-testid="tf-name" /></Field>
          <Field label="Tender Date"><input type="date" value={form.tender_date} onChange={(e) => upd('tender_date', e.target.value)} className={inp} /></Field>
          <Field label="Closing Date"><input type="date" value={form.closing_date} onChange={(e) => upd('closing_date', e.target.value)} className={inp} /></Field>
          <Field label="Tender Value (₹)"><input type="number" value={form.tender_value} onChange={(e) => upd('tender_value', parseFloat(e.target.value) || 0)} className={inp} data-testid="tf-value" /></Field>
          <Field label="EMD Amount (₹)"><input type="number" value={form.emd_amount} onChange={(e) => upd('emd_amount', parseFloat(e.target.value) || 0)} className={inp} /></Field>
          <Field label="Status"><select value={form.status} onChange={(e) => upd('status', e.target.value)} className={inp}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Responsible"><input value={form.responsible} onChange={(e) => upd('responsible', e.target.value)} className={inp} /></Field>
          <Field label="Notes" wide><textarea rows={2} value={form.notes} onChange={(e) => upd('notes', e.target.value)} className={inp} /></Field>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
          <button type="submit" disabled={busy} data-testid="tf-submit" className="px-4 py-2 text-sm bg-[#1E1B4B] hover:bg-[#312e81] text-white rounded-sm">{busy ? 'Saving…' : 'Create Tender'}</button>
        </div>
      </form>
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
function Field({ label, wide, children }) {
  return <label className={`block ${wide ? 'col-span-2' : ''}`}>
    <span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>
    {children}
  </label>;
}
