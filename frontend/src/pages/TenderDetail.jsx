import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Sparkles, Upload, FileText, Trash2, ExternalLink, X } from 'lucide-react';

const DOC_TYPES = [
  { key: 'tender_document', label: 'Tender Document' },
  { key: 'aoc_contract', label: 'AOC / Contract / PO' },
  { key: 'bill_invoice', label: 'Bill / Invoice' },
  { key: 'payment_proof', label: 'Payment Proof' },
  { key: 'emd_proof', label: 'EMD Proof' },
  { key: 'ebg', label: 'EBG / Bank Guarantee' },
  { key: 'courier_proof', label: 'Courier Proof' },
  { key: 'sample_proof', label: 'Sample Proof' },
  { key: 'other', label: 'Other' },
];

export default function TenderDetail() {
  const { id } = useParams();
  const { masters, user } = useAuth();
  const [tender, setTender] = useState(null);
  const [items, setItems] = useState([]);
  const [pnl, setPnl] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [docs, setDocs] = useState([]);
  const [showItem, setShowItem] = useState(false);
  const [showInv, setShowInv] = useState(false);
  const [showAOC, setShowAOC] = useState(false);
  const [showDocUpload, setShowDocUpload] = useState(false);

  const load = async () => {
    const [t, i, p, inv, d] = await Promise.all([
      api.get(`/tenders/${id}`),
      api.get(`/items?tender_id=${id}`),
      api.get(`/reports/tender-pnl/${id}`),
      api.get('/invoices'),
      api.get(`/documents?tender_id=${id}`),
    ]);
    setTender(t.data); setItems(i.data); setPnl(p.data);
    setInvoices(inv.data.filter((v) => v.tender_id === id));
    setDocs(d.data);
  };
  useEffect(() => { load(); }, [id]);

  if (!tender || !pnl) return <div className="p-8 text-slate-500">Loading…</div>;

  const changeStatus = async (status) => {
    await api.post(`/tenders/${id}/status`, { status });
    toast.success('Status updated');
    load();
  };

  return (
    <div className="p-8 max-w-[1400px]">
      <Link to="/tenders" className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Back to Tenders</Link>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="font-mono text-indigo-900 text-sm font-semibold mb-1">{tender.code}</div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">{tender.name}</h1>
          <div className="text-sm text-slate-500 mt-1">
            {tender.department} · {tender.tender_no ? `Ref ${tender.tender_no} · ` : ''}Closes {formatDate(tender.closing_date)}
            {tender.contract_no && (<span className="ml-3 pill pill-primary">Contract {tender.contract_no}</span>)}
          </div>
        </div>
        <div className="flex items-start gap-3">
          {user?.role !== 'viewer' && !tender.contract_no && (
            <button onClick={() => setShowAOC(true)} data-testid="upload-aoc-btn" className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded-sm flex items-center gap-2"><Sparkles className="w-4 h-4" />Upload AOC</button>
          )}
          <div className="text-right">
            <div className="section-label">Status</div>
            <select value={tender.status} onChange={(e) => changeStatus(e.target.value)} data-testid="tender-status" className="mt-1 px-3 py-1.5 border border-slate-300 rounded-sm text-sm">
              {masters.statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Card label="Tender Value" value={formatINR(tender.contract_value || tender.tender_value)} />
        <Card label="Revenue Received" value={formatINR(pnl.revenue)} tone="text-emerald-700" />
        <Card label="Pre-Tender Cost" value={formatINR(pnl.pre_total)} tone="text-red-700" />
        <Card label="Post-Tender Cost" value={formatINR(pnl.post_total)} tone="text-amber-700" />
        <Card label="Contribution" value={formatINR(pnl.contribution)} tone={pnl.contribution >= 0 ? 'text-emerald-700' : 'text-red-700'} sub={`Margin ${pnl.margin.toFixed(1)}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="data-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-slate-900">Contract Items</h3>
            {user?.role !== 'viewer' && (
              <button onClick={() => setShowItem(true)} data-testid="new-item-btn" className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-sm flex items-center gap-1"><Plus className="w-3 h-3" />Item</button>
            )}
          </div>
          <table className="w-full data-table">
            <thead><tr><th>Item ID</th><th>Name</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="font-mono text-[12px] text-indigo-900">{it.code}</td>
                  <td>{it.name}</td>
                  <td className="num-cell">{it.quantity} {it.unit}</td>
                  <td className="num-cell">{formatINR(it.rate)}</td>
                  <td className="num-cell">{formatINR(it.quantity * it.rate)}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-slate-400 text-sm">No items yet. Upload an AOC to auto-populate.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="data-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-slate-900">Department Invoices</h3>
            {user?.role !== 'viewer' && (
              <button onClick={() => setShowInv(true)} data-testid="new-invoice-btn" className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-sm flex items-center gap-1"><Plus className="w-3 h-3" />Invoice</button>
            )}
          </div>
          <table className="w-full data-table">
            <thead><tr><th>Invoice</th><th>Date</th><th className="text-right">Amount</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>
              {invoices.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono text-[12px]">{v.invoice_no}</td>
                  <td>{formatDate(v.invoice_date)}</td>
                  <td className="num-cell">{formatINR(v.amount)}</td>
                  <td className={`num-cell ${v.outstanding > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatINR(v.outstanding)}</td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-slate-400 text-sm">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="data-card p-5 mt-6">
        <h3 className="font-display font-semibold text-slate-900 mb-3">Item-level Profit &amp; Loss</h3>
        <table className="w-full data-table">
          <thead><tr>
            <th>Item</th><th className="text-right">Revenue</th><th className="text-right">Actual Cost</th>
            <th className="text-right">Estimate</th><th className="text-right">Variance</th><th className="text-right">Profit</th><th className="text-right">Margin</th>
          </tr></thead>
          <tbody>
            {pnl.items.map((it) => (
              <tr key={it.item_id}>
                <td>{it.code} · {it.name}</td>
                <td className="num-cell">{formatINR(it.revenue)}</td>
                <td className="num-cell text-red-700">{formatINR(it.cost)}</td>
                <td className="num-cell text-slate-500">{formatINR(it.estimated_cost)}</td>
                <td className={`num-cell ${it.variance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatINR(it.variance)}</td>
                <td className={`num-cell font-semibold ${it.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatINR(it.profit)}</td>
                <td className="num-cell">{it.margin.toFixed(1)}%</td>
              </tr>
            ))}
            {pnl.items.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-slate-400 text-sm">Add items to see per-item P&amp;L.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="data-card p-5 mt-6" data-testid="documents-section">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-display font-semibold text-slate-900">Documents</h3>
            <p className="text-xs text-slate-500">Tender doc, AOC, bills, payment proofs, EMD, EBG — all linked to {tender.code}.</p>
          </div>
          {user?.role !== 'viewer' && (
            <button onClick={() => setShowDocUpload(true)} data-testid="upload-doc-btn" className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-sm flex items-center gap-1"><Upload className="w-3 h-3" />Upload Document</button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map((d) => (
            <DocCard key={d.id} doc={d} onDelete={() => api.delete(`/documents/${d.id}`).then(() => { toast.success('Removed'); load(); })} />
          ))}
          {docs.length === 0 && <div className="col-span-3 text-center py-6 text-slate-400 text-sm">No documents yet.</div>}
        </div>
      </div>

      {showItem && <ItemModal tenderId={id} onClose={() => setShowItem(false)} onSaved={() => { setShowItem(false); load(); }} />}
      {showInv && <InvoiceModal tenderId={id} department={tender.department} onClose={() => setShowInv(false)} onSaved={() => { setShowInv(false); load(); }} />}
      {showAOC && <AOCModal tenderId={id} onClose={() => setShowAOC(false)} onSaved={() => { setShowAOC(false); load(); }} />}
      {showDocUpload && <DocUploadModal tenderId={id} onClose={() => setShowDocUpload(false)} onSaved={() => { setShowDocUpload(false); load(); }} />}
    </div>
  );
}

function DocCard({ doc, onDelete }) {
  const token = localStorage.getItem('bit_token');
  const url = `${process.env.REACT_APP_BACKEND_URL}/api/files/${doc.file.id}/download?auth=${token}`;
  const label = DOC_TYPES.find((t) => t.key === doc.document_type)?.label || doc.document_type;
  return (
    <div className="border border-slate-200 rounded-sm p-3 bg-slate-50/50 hover:bg-slate-100/60 transition-colors">
      <div className="flex items-start justify-between mb-1.5">
        <span className="pill pill-primary">{label}</span>
        <button onClick={onDelete} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-slate-400" />
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-700 hover:underline truncate flex-1">
          {doc.file.original_filename}
        </a>
        <ExternalLink className="w-3 h-3 text-slate-400" />
      </div>
      <div className="text-[10px] text-slate-500 mt-1">{formatDate(doc.linked_at)}</div>
    </div>
  );
}

function Card({ label, value, sub, tone }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone || ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function ItemModal({ tenderId, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', quantity: 0, unit: 'pcs', rate: 0, estimated_cost: 0 });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/items', { tender_id: tenderId, ...form });
      toast.success(`Item ${data.code} added`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };
  return (
    <Modal title="New Item" onClose={onClose} onSubmit={submit}>
      <L label="Name *"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} data-testid="item-name" /></L>
      <L label="Quantity"><input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} className={inp} data-testid="item-qty" /></L>
      <L label="Unit"><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inp} /></L>
      <L label="Rate (₹)"><input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })} className={inp} data-testid="item-rate" /></L>
      <L label="Estimated Cost (₹)"><input type="number" value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: parseFloat(e.target.value) || 0 })} className={inp} /></L>
    </Modal>
  );
}

function InvoiceModal({ tenderId, department, onClose, onSaved }) {
  const [form, setForm] = useState({ invoice_no: '', invoice_date: todayISO(), due_date: '', amount: 0, department, remarks: '' });
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/invoices', { tender_id: tenderId, ...form }); toast.success('Invoice created'); onSaved(); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };
  return (
    <Modal title="New Invoice" onClose={onClose} onSubmit={submit}>
      <L label="Invoice No *"><input required value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} className={inp} data-testid="inv-no" /></L>
      <L label="Invoice Date"><input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} className={inp} /></L>
      <L label="Due Date"><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className={inp} /></L>
      <L label="Amount (₹) *"><input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className={inp} data-testid="inv-amount" /></L>
      <L label="Department"><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inp} /></L>
    </Modal>
  );
}

function AOCModal({ tenderId, onClose, onSaved }) {
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const doExtract = async () => {
    if (!file) return;
    setStep('extracting');
    const fd = new FormData(); fd.append('file', file);
    try {
      const { data } = await api.post('/extract/aoc', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm({
        contract_no: data.contract_no || '',
        contract_date: data.contract_date || '',
        contract_value: Number(data.contract_value) || 0,
        delivery_date: data.delivery_date || '',
        items: (data.items || []).map((it) => ({
          name: it.name || '',
          quantity: Number(it.quantity) || 0,
          unit: it.unit || 'pcs',
          rate: Number(it.rate) || 0,
          value: Number(it.value) || 0,
        })),
      });
      setStep('review');
      toast.success(`Extracted ${(data.items || []).length} items`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Extraction failed');
      setStep('upload');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: res } = await api.post(`/tenders/${tenderId}/apply-aoc`, form);
      const fd = new FormData(); fd.append('file', file);
      const { data: uploaded } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await api.post('/documents', { file_id: uploaded.id, tender_id: tenderId, document_type: 'aoc_contract' });
      toast.success(`Applied AOC — ${res.items_added} items created`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  const updateItem = (idx, k, v) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [k]: k === 'name' || k === 'unit' ? v : (parseFloat(v) || 0) };
    setForm({ ...form, items });
  };
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const addItem = () => setForm({ ...form, items: [...form.items, { name: '', quantity: 0, unit: 'pcs', rate: 0, value: 0 }] });

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-6 px-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-sm border border-slate-200 shadow-lg mb-10">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="font-display text-lg font-semibold">Upload AOC / Contract / PO</h3>
            <p className="text-xs text-slate-500 mt-0.5">AI extracts contract number, value, delivery date and every line item.</p>
          </div>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        {step === 'upload' && (
          <div className="p-8">
            <label className="block border-2 border-dashed border-slate-300 rounded-sm p-8 text-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/40 transition-colors">
              <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
              <div className="text-sm text-slate-700 font-medium">{file ? file.name : 'Click to choose AOC PDF'}</div>
              <div className="text-xs text-slate-500 mt-1">PDF only</div>
              <input type="file" accept="application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0])} data-testid="aoc-file-input" />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
              <button onClick={doExtract} disabled={!file} data-testid="aoc-extract-btn" className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-sm flex items-center gap-2"><Sparkles className="w-4 h-4" />Extract fields</button>
            </div>
          </div>
        )}

        {step === 'extracting' && (
          <div className="p-12 text-center">
            <Sparkles className="w-8 h-8 mx-auto text-emerald-600 animate-pulse mb-3" />
            <div className="text-sm text-slate-700 font-medium">Reading contract…</div>
            <div className="text-xs text-slate-500 mt-1">Extracting items and totals. This can take 15–30 seconds.</div>
          </div>
        )}

        {step === 'review' && form && (
          <form onSubmit={submit}>
            <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-800 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" /> Review extracted contract details. Edit anything before applying.
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <L label="Contract / AOC / PO No *"><input required value={form.contract_no} onChange={(e) => setForm({ ...form, contract_no: e.target.value })} className={inp} data-testid="aoc-no" /></L>
              <L label="Contract Date"><input type="date" value={form.contract_date || ''} onChange={(e) => setForm({ ...form, contract_date: e.target.value })} className={inp} /></L>
              <L label="Contract Value (₹)"><input type="number" value={form.contract_value} onChange={(e) => setForm({ ...form, contract_value: parseFloat(e.target.value) || 0 })} className={inp} data-testid="aoc-value" /></L>
              <L label="Delivery Date"><input type="date" value={form.delivery_date || ''} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} className={inp} /></L>
            </div>
            <div className="px-6 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="section-label">Items ({form.items.length})</div>
                <button type="button" onClick={addItem} className="text-xs text-indigo-600 hover:text-indigo-800">+ Add row</button>
              </div>
              <div className="border border-slate-200 rounded-sm overflow-hidden">
                <table className="w-full data-table">
                  <thead><tr><th>Name</th><th className="text-right">Qty</th><th>Unit</th><th className="text-right">Rate</th><th className="text-right">Value</th><th></th></tr></thead>
                  <tbody>
                    {form.items.map((it, idx) => (
                      <tr key={idx}>
                        <td><input value={it.name} onChange={(e) => updateItem(idx, 'name', e.target.value)} className="w-full px-2 py-1 text-sm border border-slate-200 rounded-sm" /></td>
                        <td><input type="number" value={it.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className="w-20 px-2 py-1 text-sm text-right border border-slate-200 rounded-sm num" /></td>
                        <td><input value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} className="w-16 px-2 py-1 text-sm border border-slate-200 rounded-sm" /></td>
                        <td><input type="number" value={it.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} className="w-24 px-2 py-1 text-sm text-right border border-slate-200 rounded-sm num" /></td>
                        <td><input type="number" value={it.value} onChange={(e) => updateItem(idx, 'value', e.target.value)} className="w-28 px-2 py-1 text-sm text-right border border-slate-200 rounded-sm num" /></td>
                        <td><button type="button" onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    ))}
                    {form.items.length === 0 && <tr><td colSpan={6} className="text-center py-4 text-slate-400 text-xs">No items extracted. Add manually.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center gap-2 bg-slate-50">
              <button type="button" onClick={() => setStep('upload')} className="text-xs text-slate-500 hover:text-slate-800">← Re-upload PDF</button>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
                <button type="submit" disabled={busy} data-testid="aoc-confirm-btn" className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm">{busy ? 'Applying…' : `Confirm & Apply (${form.items.length} items)`}</button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function DocUploadModal({ tenderId, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState('other');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { toast.error('Choose a file'); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data: uploaded } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await api.post('/documents', { file_id: uploaded.id, tender_id: tenderId, document_type: docType, notes });
      toast.success('Document attached');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Attach Document" onClose={onClose} onSubmit={submit}>
      <L label="Document Type *">
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inp} data-testid="doc-type">
          {DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </L>
      <L label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} placeholder="Optional description" /></L>
      <label className="col-span-2 block cursor-pointer border-2 border-dashed border-slate-300 rounded-sm p-6 text-center hover:border-indigo-500">
        <Upload className="w-6 h-6 mx-auto text-slate-400 mb-2" />
        <div className="text-sm text-slate-700 font-medium">{file ? file.name : 'Click to choose file'}</div>
        <div className="text-xs text-slate-500 mt-1">PDF, PNG, JPG accepted</div>
        <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0])} data-testid="doc-file-input" />
      </label>
    </Modal>
  );
}

function Modal({ title, onClose, onSubmit, children }) {
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-16 px-4">
      <form onSubmit={onSubmit} className="bg-white w-full max-w-lg rounded-sm border border-slate-200 shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400">✕</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">{children}</div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
          <button type="submit" data-testid="modal-submit" className="px-4 py-2 text-sm bg-[#1E1B4B] hover:bg-[#312e81] text-white rounded-sm">Save</button>
        </div>
      </form>
    </div>
  );
}
function L({ label, children }) {
  return <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>{children}</label>;
}
