import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { Plus, X, Upload, Filter, RotateCcw, FileText as FileIcon, ExternalLink } from 'lucide-react';

const statusPill = (s) => ({
  requested: 'pill-warning', approved: 'pill-primary', paid: 'pill-success',
  payable: 'pill-warning', rejected: 'pill-danger',
})[s] || 'pill-muted';

const DATE_PRESETS = [
  { key: '', label: 'All time' }, { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' }, { key: 'last_7', label: 'Last 7 days' },
  { key: 'last_30', label: 'Last 30 days' }, { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' }, { key: 'this_year', label: 'This year' },
];

export default function Transactions() {
  const { masters, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [txns, setTxns] = useState([]);
  const [meta, setMeta] = useState({ count: 0, total_expense: 0, total_income: 0 });
  const [tenders, setTenders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState(null);

  const filter = {
    stage: params.get('stage') || '',
    category: params.get('category') || '',
    tender_id: params.get('tender_id') || '',
    payment_status: params.get('payment_status') || '',
    account: params.get('account') || '',
    paid_by: params.get('paid_by') || '',
    period: params.get('period') || '',
    missing_proof: params.get('missing_proof') === 'true',
    q: params.get('q') || '',
  };

  const load = useCallback(() => {
    const q = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v) q.append(k, v); });
    api.get(`/transactions?${q.toString()}`).then((r) => {
      setTxns(r.data.items); setMeta({ count: r.data.count, total_expense: r.data.total_expense, total_income: r.data.total_income });
    });
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/tenders').then((r) => setTenders(r.data)); }, []);

  // Auto-open txn from URL
  useEffect(() => {
    const txnId = params.get('txn');
    if (txnId) {
      api.get(`/transactions/${txnId}/details`).then((r) => setSelectedTxn(r.data));
    }
  }, [params.get('txn')]);

  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v === '' || v === false || v == null) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };
  const clearAll = () => setParams({}, { replace: true });

  const tenderCode = (id) => id === 'COMPANY' ? 'COMPANY' : (tenders.find((t) => t.id === id)?.code || '—');
  const activeFilterCount = Object.values(filter).filter((v) => v && v !== '').length;

  const allCategories = useMemo(() => {
    const set = new Set();
    Object.values(masters.categories || {}).forEach((cats) => cats.forEach((c) => set.add(c)));
    return [...set];
  }, [masters]);

  const openTxn = async (id) => {
    const { data } = await api.get(`/transactions/${id}/details`);
    setSelectedTxn(data);
  };

  return (
    <div className="p-8 max-w-[1600px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="section-label mb-1">Transaction Ledger</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">All Transactions</h1>
          <p className="text-sm text-slate-500 mt-1">Enter every event once. Reports build themselves.</p>
        </div>
        {user?.role !== 'viewer' && (
          <button data-testid="new-txn-btn" onClick={() => setShowForm(true)}
            className="bg-[#1E1B4B] hover:bg-[#312e81] text-white text-sm px-4 py-2.5 rounded-sm flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Transaction
          </button>
        )}
      </div>

      <div className="data-card p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-500" />
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">Filters</div>
          {activeFilterCount > 0 && (
            <>
              <span className="pill pill-primary">{activeFilterCount} active</span>
              <button onClick={clearAll} className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 ml-auto">
                <RotateCcw className="w-3 h-3" /> Clear all
              </button>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 items-end">
          <FSelect label="Stage" value={filter.stage} onChange={(v) => setFilter('stage', v)} testid="f-stage"
            opts={[{ v: '', l: 'All Stages' }, { v: 'pre_tender', l: 'Pre-Tender' },
              { v: 'post_tender', l: 'Post-Tender' }, { v: 'administration', l: 'Administration' },
              { v: 'income', l: 'Income (from receipts)' }]} />
          <FSelect label="Category" value={filter.category} onChange={(v) => setFilter('category', v)} testid="f-category"
            opts={[{ v: '', l: 'All Categories' }, ...allCategories.map((c) => ({ v: c, l: c }))]} />
          <FSelect label="Tender" value={filter.tender_id} onChange={(v) => setFilter('tender_id', v)} testid="f-tender"
            opts={[{ v: '', l: 'All Tenders' }, { v: 'COMPANY', l: 'Company Overhead' },
              ...tenders.map((t) => ({ v: t.id, l: `${t.code} · ${t.name.slice(0, 20)}` }))]} />
          <FSelect label="Status" value={filter.payment_status} onChange={(v) => setFilter('payment_status', v)} testid="f-status"
            opts={[{ v: '', l: 'All' }, { v: 'requested', l: 'Requested' }, { v: 'approved', l: 'Approved' },
              { v: 'paid', l: 'Paid' }, { v: 'payable', l: 'Payable' }, { v: 'rejected', l: 'Rejected' }]} />
          <FSelect label="Paid By" value={filter.paid_by} onChange={(v) => setFilter('paid_by', v)} testid="f-paidby"
            opts={[{ v: '', l: 'Anyone' }, ...(masters.paid_by || []).map((p) => ({ v: p, l: p }))]} />
          <FSelect label="Account" value={filter.account} onChange={(v) => setFilter('account', v)} testid="f-account"
            opts={[{ v: '', l: 'All Accounts' }, ...(masters.accounts || []).map((a) => ({ v: a, l: a }))]} />
          <FSelect label="Date Range" value={filter.period} onChange={(v) => setFilter('period', v)} testid="f-period"
            opts={DATE_PRESETS.map((d) => ({ v: d.key, l: d.label }))} />
          <label className="flex items-center gap-1.5 text-xs pb-2 cursor-pointer">
            <input type="checkbox" checked={filter.missing_proof} onChange={(e) => setFilter('missing_proof', e.target.checked)} data-testid="f-noproof" />
            <span className="text-slate-700 font-medium">Missing proof only</span>
          </label>
        </div>
      </div>

      <div className="data-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
          <div className="text-sm text-slate-700">
            <span className="font-mono font-semibold text-slate-900" data-testid="filter-count">{meta.count}</span> transactions
          </div>
          <div className="flex items-center gap-6 text-sm">
            {meta.total_income > 0 && <div><span className="text-slate-500">Income </span><span className="num text-emerald-700 font-semibold" data-testid="total-income">+{formatINR(meta.total_income)}</span></div>}
            <div><span className="text-slate-500">Total </span><span className="num font-semibold text-slate-900" data-testid="total-expense">{formatINR(meta.total_expense)}</span></div>
          </div>
        </div>
        <table className="w-full data-table">
          <thead><tr>
            <th>TXN</th><th>Date</th><th>Tender</th><th>Category</th>
            <th>Vendor</th><th>Paid By</th><th className="text-right">Amount</th><th>Status</th><th>Proof</th>
          </tr></thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} onClick={() => openTxn(t.id)} className="cursor-pointer" data-testid={`txn-row-${t.code}`}>
                <td className="font-mono text-[12px] text-indigo-900 font-semibold">{t.code}</td>
                <td>{formatDate(t.date)}</td>
                <td className="font-mono text-[12px] text-indigo-900">{tenderCode(t.tender_id)}</td>
                <td>{t.category}</td>
                <td className="text-slate-600 max-w-[160px] truncate">{t.vendor || '—'}</td>
                <td className="text-slate-600 text-xs">{t.paid_by || '—'}</td>
                <td className={`num-cell ${t.txn_type === 'income' ? 'text-emerald-700 font-semibold' : ''} ${t.is_reversed ? 'line-through text-slate-400' : ''}`}>
                  {t.txn_type === 'income' ? '+' : ''}{formatINR(t.amount)}
                </td>
                <td>
                  <span className={`pill ${statusPill(t.payment_status)}`}>{t.payment_status}</span>
                  {t.reconciled && <span className="pill pill-success ml-1">✓ matched</span>}
                  {t.is_reversed && <span className="pill pill-danger ml-1">reversed</span>}
                </td>
                <td>{t.document_id ? <FileIcon className="w-3.5 h-3.5 text-emerald-600" /> : <span className="text-slate-300 text-xs">—</span>}</td>
              </tr>
            ))}
            {txns.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-slate-400 text-sm">No transactions match your filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <TxnForm masters={masters} tenders={tenders} isAdmin={user?.role === 'admin'}
        onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
      {selectedTxn && <TxnDetail data={selectedTxn} isAdmin={user?.role === 'admin'}
        onClose={() => { setSelectedTxn(null); const p = new URLSearchParams(params); p.delete('txn'); setParams(p, { replace: true }); }}
        onChange={() => { openTxn(selectedTxn.transaction.id); load(); }} />}
    </div>
  );
}

function FSelect({ label, value, onChange, opts, testid }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>
      <select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
        {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

// ---------- New Transaction (2-step simple entry) ----------
function TxnForm({ masters, tenders, isAdmin, onClose, onSaved }) {
  const [step, setStep] = useState('what'); // what → details
  const [stage, setStage] = useState('');
  const [form, setForm] = useState({
    date: todayISO(), txn_type: 'expense', tender_id: '', item_id: '',
    stage: '', category: '', description: '', vendor: '',
    amount: 0, payment_status: 'requested', paid_by: '', account: '',
    remarks: '', document_id: null,
  });
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState('');

  useEffect(() => { api.get('/vendors').then((r) => setVendors(r.data)); }, []);
  useEffect(() => {
    if (form.tender_id && form.tender_id !== 'COMPANY') {
      api.get(`/items?tender_id=${form.tender_id}`).then((r) => setItems(r.data));
    } else setItems([]);
  }, [form.tender_id]);

  const pickStage = (s) => {
    setStage(s);
    setForm({ ...form, stage: s, category: '', txn_type: s === 'income' ? 'income' : 'expense', tender_id: s === 'administration' ? 'COMPANY' : form.tender_id });
    setStep('details');
  };

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const categoryList = masters.categories[form.stage] || [];

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const { data } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      upd('document_id', data.id); setUploadedName(file.name); toast.success('Proof attached');
    } catch { toast.error('Upload failed'); }
    finally { setUploading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.category) { toast.error('Choose a category'); return; }
    if (!form.amount) { toast.error('Enter an amount'); return; }
    setBusy(true);
    try {
      const payload = { ...form, tender_id: form.tender_id || null, item_id: form.item_id || null };
      const { data } = await api.post('/transactions', payload);
      toast.success(`Saved ${data.code}`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-10 px-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-sm border border-slate-200 shadow-lg mb-10" data-testid="txn-form">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="font-display text-lg font-semibold">
            {step === 'what' ? 'New Transaction — What is it about?' : `New ${stage.replace('_', ' ')} transaction`}
          </h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        {step === 'what' && (
          <div className="p-8">
            <p className="text-sm text-slate-600 mb-5">What did you spend or receive money for?</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: 'pre_tender', title: 'Pre-Tender', desc: 'EMD, stamp, courier, sample, filing…', color: 'text-red-700' },
                { k: 'post_tender', title: 'Post-Tender', desc: 'Purchase, job work, transport, packing…', color: 'text-amber-700' },
                { k: 'administration', title: 'Administration', desc: 'Salary, software, office, one-time…', color: 'text-indigo-700' },
              ].map((o) => (
                <button key={o.k} data-testid={`stage-${o.k}`} onClick={() => pickStage(o.k)}
                  className="text-left border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/40 rounded-sm p-4 transition-colors">
                  <div className={`font-display font-semibold ${o.color}`}>{o.title}</div>
                  <div className="text-xs text-slate-500 mt-1">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'details' && (
          <form onSubmit={submit}>
            <div className="p-6 grid grid-cols-3 gap-4">
              <L label="Category *">
                <select required value={form.category} onChange={(e) => upd('category', e.target.value)} className={inp} data-testid="tx-category">
                  <option value="">Select category…</option>
                  {categoryList.map((c) => <option key={c}>{c}</option>)}
                </select>
              </L>
              <L label="Amount (₹) *">
                <input required type="number" step="0.01" value={form.amount} onChange={(e) => upd('amount', parseFloat(e.target.value) || 0)} className={inp} data-testid="tx-amount" />
              </L>
              <L label="Date *"><input required type="date" value={form.date} onChange={(e) => upd('date', e.target.value)} className={inp} /></L>

              {form.stage !== 'administration' && (
                <>
                  <L label="Tender *">
                    <select required value={form.tender_id} onChange={(e) => upd('tender_id', e.target.value)} className={inp} data-testid="tx-tender">
                      <option value="">Select tender…</option>
                      {tenders.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name.slice(0, 30)}</option>)}
                    </select>
                  </L>
                  <L label="Item (optional — otherwise Shared)">
                    <select value={form.item_id} onChange={(e) => upd('item_id', e.target.value)} className={inp} disabled={!items.length}>
                      <option value="">— Tender-level / Shared —</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}</option>)}
                    </select>
                  </L>
                </>
              )}

              <L label="Vendor / Party">
                <input list="vendor-list" value={form.vendor} onChange={(e) => upd('vendor', e.target.value)} className={inp} placeholder="Start typing…" />
                <datalist id="vendor-list">
                  {vendors.map((v) => <option key={v.name} value={v.name} />)}
                </datalist>
              </L>
              <L label="Paid By">
                <select value={form.paid_by} onChange={(e) => upd('paid_by', e.target.value)} className={inp}>
                  <option value="">—</option>
                  {(masters.paid_by || []).map((p) => <option key={p}>{p}</option>)}
                </select>
              </L>
              <L label="Account">
                <select value={form.account} onChange={(e) => upd('account', e.target.value)} className={inp}>
                  <option value="">—</option>
                  {masters.accounts.map((a) => <option key={a}>{a}</option>)}
                </select>
              </L>
              <L label="Payment Status">
                <select value={form.payment_status} onChange={(e) => upd('payment_status', e.target.value)} className={inp} data-testid="tx-status">
                  <option value="requested">Requested (needs approval)</option>
                  <option value="payable">Payable (invoice received)</option>
                  {isAdmin && <option value="approved">Approved</option>}
                  {isAdmin && <option value="paid">Paid</option>}
                </select>
              </L>
              <L label="Bill / Receipt">
                <label className="cursor-pointer flex items-center gap-1.5 px-3 py-2 border border-dashed border-slate-300 rounded-sm text-xs text-slate-600 hover:bg-slate-50">
                  <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : (uploadedName || 'Upload proof')}
                  <input type="file" hidden onChange={handleUpload} data-testid="tx-file" />
                </label>
              </L>
              <label className="col-span-3 block">
                <span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Description</span>
                <input value={form.description} onChange={(e) => upd('description', e.target.value)} className={inp} />
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center bg-slate-50">
              <button type="button" onClick={() => setStep('what')} className="text-xs text-slate-500 hover:text-slate-800">← Change type</button>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
                <button type="submit" disabled={busy} data-testid="tx-submit" className="px-4 py-2 text-sm bg-[#1E1B4B] hover:bg-[#312e81] text-white rounded-sm">{busy ? 'Saving…' : 'Save Transaction'}</button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------- Transaction Detail Modal with Tabs ----------
function TxnDetail({ data, isAdmin, onClose, onChange }) {
  const t = data.transaction;
  const [tab, setTab] = useState('basic');
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');

  const reverse = async () => {
    if (!reason.trim()) { toast.error('Enter a reason'); return; }
    try {
      await api.post(`/transactions/${t.id}/reverse`, { reason });
      toast.success('Transaction reversed');
      onChange();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center pt-6 px-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-sm border border-slate-200 shadow-xl mb-10">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="font-mono text-indigo-900 font-semibold">{t.code}</div>
              <span className={`pill ${statusPill(t.payment_status)}`}>{t.payment_status}</span>
              {t.reconciled && <span className="pill pill-success">✓ reconciled</span>}
              {t.is_reversed && <span className="pill pill-danger">reversed by {t.reversed_by_txn}</span>}
            </div>
            <div className="font-display text-2xl font-semibold text-slate-900 mt-1">
              {t.txn_type === 'income' ? '+' : ''}{formatINR(t.amount)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{t.category} · {formatDate(t.date)}</div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="border-b border-slate-200 flex gap-4 px-6">
          {[
            { k: 'basic', l: 'Details' },
            { k: 'approval', l: 'Approval' },
            { k: 'payment', l: 'Payment' },
            { k: 'proof', l: `Proof (${data.documents.length})` },
            { k: 'history', l: `History (${data.history.length})` },
          ].map((x) => (
            <button key={x.k} data-testid={`tab-${x.k}`} onClick={() => setTab(x.k)}
              className={`py-3 text-sm border-b-2 -mb-px ${tab === x.k ? 'border-indigo-600 text-slate-900 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {x.l}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'basic' && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <KV label="Transaction ID" v={t.code} mono />
              <KV label="Date" v={formatDate(t.date)} />
              <KV label="Tender" v={data.tender ? `${data.tender.code} · ${data.tender.name}` : (t.tender_id || 'Company')} mono={!data.tender} />
              <KV label="Item" v={data.item ? `${data.item.code} · ${data.item.name}` : 'Shared / Tender-level'} />
              <KV label="Stage" v={t.stage?.replace('_', ' ')} />
              <KV label="Category" v={t.category} />
              <KV label="Vendor / Party" v={t.vendor || '—'} />
              <KV label="Paid By" v={t.paid_by || '—'} />
              <KV label="Amount" v={formatINR(t.amount)} num />
              <KV label="Description" v={t.description || '—'} full />
              <KV label="Created By" v={t.created_by} />
              <KV label="Created At" v={formatDate(t.created_at)} />
            </div>
          )}

          {tab === 'approval' && (
            <div className="space-y-3 text-sm">
              <KV label="Approval Status" v={<span className={`pill ${statusPill(t.approval_status === 'approved' ? 'approved' : t.approval_status === 'rejected' ? 'rejected' : 'requested')}`}>{t.approval_status}</span>} />
              <KV label="Requested By" v={t.created_by} />
              <KV label="Approved / Rejected By" v={t.approved_by || 'Pending'} />
              <KV label="Decision At" v={t.approved_at ? formatDate(t.approved_at) : '—'} />
              <KV label="Remarks" v={t.approval_remarks || '—'} />
            </div>
          )}

          {tab === 'payment' && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <KV label="Payment Status" v={t.payment_status} />
              <KV label="Payment Date" v={t.payment_date ? formatDate(t.payment_date) : 'Not paid'} />
              <KV label="Account" v={t.account || '—'} />
              <KV label="Bank Reference" v={t.bank_reference || '—'} mono />
              <KV label="Reconciled" v={t.reconciled ? 'Yes ✓' : 'No'} />
              {data.bank && (
                <>
                  <KV label="Matched Bank Line" v={`${formatDate(data.bank.date)} · ${data.bank.description}`} full />
                  <KV label="Bank Amount" v={formatINR(Math.abs(data.bank.amount))} />
                  <KV label="Bank Ref" v={data.bank.reference || '—'} mono />
                </>
              )}
            </div>
          )}

          {tab === 'proof' && (
            <div>
              {data.documents.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-6">No proof attached to this transaction.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {data.documents.map((d, i) => {
                    const token = localStorage.getItem('bit_token');
                    const url = `${process.env.REACT_APP_BACKEND_URL}/api/files/${d.file.id}/download?auth=${token}`;
                    return (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="border border-slate-200 rounded-sm p-3 hover:bg-slate-50 flex items-center gap-2">
                        <FileIcon className="w-4 h-4 text-slate-400" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{d.file.original_filename}</div>
                          <div className="text-[10px] text-slate-500">{d.document_type}</div>
                        </div>
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-2">
              {data.history.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-6">No history yet.</div>
              ) : data.history.map((h) => (
                <div key={h.id} className="flex items-start gap-3 border-l-2 border-indigo-200 pl-3 py-1.5">
                  <div className="w-32 flex-shrink-0">
                    <div className="text-xs font-semibold text-slate-700">{h.action}</div>
                    <div className="text-[10px] text-slate-500">{formatDate(h.at)}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-slate-600">by {h.user_email}</div>
                    {h.note && <div className="text-xs text-slate-500 italic mt-0.5">"{h.note}"</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          {isAdmin && !t.is_reversed && !reversing && (
            <button onClick={() => setReversing(true)} className="text-xs text-red-600 hover:text-red-800">Reverse Transaction…</button>
          )}
          {isAdmin && reversing && (
            <div className="flex items-center gap-2 flex-1 max-w-lg">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reversal *"
                className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded-sm" />
              <button onClick={reverse} className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm">Confirm</button>
              <button onClick={() => setReversing(false)} className="px-2 py-1 text-xs text-slate-500">Cancel</button>
            </div>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm ml-auto">Close</button>
        </div>
      </div>
    </div>
  );
}

function KV({ label, v, mono, num, full }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">{label}</div>
      <div className={`${mono ? 'font-mono text-xs' : ''} ${num ? 'num font-semibold' : ''} text-slate-900`}>{v}</div>
    </div>
  );
}

function L({ label, children }) {
  return <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>{children}</label>;
}
