import { useEffect, useState, useMemo } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { Plus, X, Upload } from 'lucide-react';

const statusPill = (s) => ({
  requested: 'pill-warning', approved: 'pill-primary', paid: 'pill-success',
  payable: 'pill-warning', rejected: 'pill-danger',
})[s] || 'pill-muted';

export default function Transactions() {
  const { masters, user } = useAuth();
  const [txns, setTxns] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState({ tender_id: '', stage: '', payment_status: '' });

  const load = () => {
    const q = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v) q.append(k, v); });
    api.get(`/transactions?${q.toString()}`).then((r) => setTxns(r.data));
  };
  useEffect(() => { load(); }, [filter]);
  useEffect(() => { api.get('/tenders').then((r) => setTenders(r.data)); }, []);

  const tenderCode = (id) => id === 'COMPANY' ? 'COMPANY' : (tenders.find((t) => t.id === id)?.code || '—');

  return (
    <div className="p-8 max-w-[1500px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="section-label mb-1">Transaction Ledger</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">All Transactions</h1>
          <p className="text-sm text-slate-500 mt-1">Enter every financial event once. Reports build themselves.</p>
        </div>
        {user?.role !== 'viewer' && (
          <button data-testid="new-txn-btn" onClick={() => setShowForm(true)} className="bg-[#1E1B4B] hover:bg-[#312e81] text-white text-sm px-4 py-2.5 rounded-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Transaction
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <select value={filter.tender_id} onChange={(e) => setFilter({ ...filter, tender_id: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-sm text-sm bg-white">
          <option value="">All Tenders</option>
          <option value="COMPANY">Company (Overhead)</option>
          {tenders.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
        </select>
        <select value={filter.stage} onChange={(e) => setFilter({ ...filter, stage: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-sm text-sm bg-white">
          <option value="">All Stages</option>
          <option value="pre_tender">Pre-Tender</option>
          <option value="post_tender">Post-Tender</option>
          <option value="administration">Administration</option>
        </select>
        <select value={filter.payment_status} onChange={(e) => setFilter({ ...filter, payment_status: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-sm text-sm bg-white">
          <option value="">All Statuses</option>
          {['requested', 'approved', 'paid', 'payable', 'rejected'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="data-card overflow-hidden">
        <table className="w-full data-table">
          <thead>
            <tr>
              <th>TXN ID</th><th>Date</th><th>Tender</th><th>Stage</th><th>Category</th>
              <th>Vendor / Party</th><th className="text-right">Amount</th><th>Status</th><th>Account</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} data-testid={`txn-row-${t.code}`}>
                <td className="font-mono text-[12px] text-slate-600">{t.code}</td>
                <td>{formatDate(t.date)}</td>
                <td className="font-mono text-[12px] text-indigo-900">{tenderCode(t.tender_id)}</td>
                <td><span className="pill pill-muted">{t.stage?.replace('_', ' ')}</span></td>
                <td>{t.category}</td>
                <td className="text-slate-600">{t.vendor || '—'}</td>
                <td className={`num-cell ${t.txn_type === 'income' ? 'text-emerald-700 font-semibold' : ''}`}>
                  {t.txn_type === 'income' ? '+' : ''}{formatINR(t.amount)}
                </td>
                <td><span className={`pill ${statusPill(t.payment_status)}`}>{t.payment_status}</span></td>
                <td className="text-slate-600">{t.account || '—'}</td>
              </tr>
            ))}
            {txns.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-slate-400 text-sm">No transactions match your filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <TxnForm
          masters={masters} tenders={tenders} isAdmin={user?.role === 'admin'}
          onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function TxnForm({ masters, tenders, isAdmin, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: todayISO(), txn_type: 'expense', tender_id: '', item_id: '',
    stage: 'pre_tender', category: '', description: '', vendor: '',
    amount: 0, payment_status: 'requested', paid_by: '', account: '',
    remarks: '', document_id: null,
  });
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState('');

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.tender_id && form.tender_id !== 'COMPANY') {
      api.get(`/items?tender_id=${form.tender_id}`).then((r) => setItems(r.data));
    } else setItems([]);
  }, [form.tender_id]);

  const categoryList = masters.categories[form.stage] || [];

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      upd('document_id', data.id);
      setUploadedName(file.name);
      toast.success('File attached');
    } catch (err) { toast.error('Upload failed'); }
    finally { setUploading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.category) { toast.error('Select a category'); return; }
    setBusy(true);
    try {
      const payload = {
        ...form,
        tender_id: form.tender_id || null,
        item_id: form.item_id || null,
      };
      const { data } = await api.post('/transactions', payload);
      toast.success(`Created ${data.code}`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-10 px-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-white w-full max-w-3xl rounded-sm border border-slate-200 shadow-lg" data-testid="txn-form">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="font-display text-lg font-semibold">New Transaction</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-6 grid grid-cols-3 gap-4">
          <L label="Date *"><input required type="date" value={form.date} onChange={(e) => upd('date', e.target.value)} className={inp} /></L>
          <L label="Type"><select value={form.txn_type} onChange={(e) => upd('txn_type', e.target.value)} className={inp}>
            <option value="expense">Expense</option><option value="purchase">Purchase (Payable)</option>
            <option value="refund">Refund</option><option value="ld">LD / Penalty</option>
            <option value="reimbursement">Reimbursement</option>
          </select></L>
          <L label="Stage *"><select required value={form.stage} onChange={(e) => { upd('stage', e.target.value); upd('category', ''); }} className={inp} data-testid="tx-stage">
            <option value="pre_tender">Pre-Tender</option><option value="post_tender">Post-Tender</option>
            <option value="administration">Administration (Company)</option>
          </select></L>
          <L label="Tender *"><select required value={form.tender_id} onChange={(e) => upd('tender_id', e.target.value)} className={inp} data-testid="tx-tender">
            <option value="">Select tender…</option>
            <option value="COMPANY">Company (Overhead)</option>
            {tenders.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </select></L>
          <L label="Item (optional)"><select value={form.item_id} onChange={(e) => upd('item_id', e.target.value)} className={inp} disabled={!items.length}>
            <option value="">— Tender-level / Shared —</option>
            {items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
          </select></L>
          <L label="Category *"><select required value={form.category} onChange={(e) => upd('category', e.target.value)} className={inp} data-testid="tx-category">
            <option value="">Select category…</option>
            {categoryList.map((c) => <option key={c}>{c}</option>)}
          </select></L>
          <L label="Vendor / Party"><input value={form.vendor} onChange={(e) => upd('vendor', e.target.value)} className={inp} /></L>
          <L label="Amount (₹) *"><input required type="number" step="0.01" value={form.amount} onChange={(e) => upd('amount', parseFloat(e.target.value) || 0)} className={inp} data-testid="tx-amount" /></L>
          <L label="Payment Status"><select value={form.payment_status} onChange={(e) => upd('payment_status', e.target.value)} className={inp} data-testid="tx-status">
            <option value="requested">Requested (needs approval)</option>
            <option value="payable">Payable (invoice received)</option>
            {isAdmin && <option value="approved">Approved</option>}
            {isAdmin && <option value="paid">Paid</option>}
          </select></L>
          <L label="Paid By"><input value={form.paid_by} onChange={(e) => upd('paid_by', e.target.value)} className={inp} placeholder="Dad / Bharath / Company" /></L>
          <L label="Account"><select value={form.account} onChange={(e) => upd('account', e.target.value)} className={inp}>
            <option value="">—</option>
            {masters.accounts.map((a) => <option key={a}>{a}</option>)}
          </select></L>
          <L label="Bill / Receipt">
            <div className="flex items-center gap-2">
              <label className="cursor-pointer flex items-center gap-1.5 px-3 py-2 border border-dashed border-slate-300 rounded-sm text-xs text-slate-600 hover:bg-slate-50">
                <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : (uploadedName || 'Upload')}
                <input type="file" hidden onChange={handleUpload} data-testid="tx-file" />
              </label>
            </div>
          </L>
          <label className="col-span-3 block">
            <span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Description</span>
            <input value={form.description} onChange={(e) => upd('description', e.target.value)} className={inp} />
          </label>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
          <button type="submit" disabled={busy} data-testid="tx-submit" className="px-4 py-2 text-sm bg-[#1E1B4B] hover:bg-[#312e81] text-white rounded-sm">
            {busy ? 'Saving…' : 'Save Transaction'}
          </button>
        </div>
      </form>
    </div>
  );
}

function L({ label, children }) {
  return <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>{children}</label>;
}
