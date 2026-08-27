import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { ArrowLeft, Plus } from 'lucide-react';

export default function TenderDetail() {
  const { id } = useParams();
  const { masters, user } = useAuth();
  const [tender, setTender] = useState(null);
  const [items, setItems] = useState([]);
  const [pnl, setPnl] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [showItem, setShowItem] = useState(false);
  const [showInv, setShowInv] = useState(false);

  const load = async () => {
    const [t, i, p, inv] = await Promise.all([
      api.get(`/tenders/${id}`),
      api.get(`/items?tender_id=${id}`),
      api.get(`/reports/tender-pnl/${id}`),
      api.get('/invoices'),
    ]);
    setTender(t.data); setItems(i.data); setPnl(p.data);
    setInvoices(inv.data.filter((v) => v.tender_id === id));
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
          <div className="text-sm text-slate-500 mt-1">{tender.department} · Closes {formatDate(tender.closing_date)}</div>
        </div>
        <div className="text-right">
          <div className="section-label">Status</div>
          <select value={tender.status} onChange={(e) => changeStatus(e.target.value)} data-testid="tender-status" className="mt-1 px-3 py-1.5 border border-slate-300 rounded-sm text-sm">
            {masters.statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Card label="Contract Value" value={formatINR(tender.tender_value)} />
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
              {items.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-slate-400 text-sm">No items yet.</td></tr>}
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

      {showItem && <ItemModal tenderId={id} onClose={() => setShowItem(false)} onSaved={() => { setShowItem(false); load(); }} />}
      {showInv && <InvoiceModal tenderId={id} department={tender.department} onClose={() => setShowInv(false)} onSaved={() => { setShowInv(false); load(); }} />}
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
  const [form, setForm] = useState({ invoice_no: '', invoice_date: new Date().toISOString().slice(0, 10), due_date: '', amount: 0, department, remarks: '' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/invoices', { tender_id: tenderId, ...form });
      toast.success('Invoice created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
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

function Modal({ title, onClose, onSubmit, children }) {
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-16 px-4">
      <form onSubmit={onSubmit} className="bg-white w-full max-w-lg rounded-sm border border-slate-200 shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400">✕</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">{children}</div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
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
