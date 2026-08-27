import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate } from '@/lib/format';
import { Download, Printer, FileSpreadsheet } from 'lucide-react';

const DATE_PRESETS = [
  { key: '', label: 'All time' }, { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' }, { key: 'last_7', label: 'Last 7 days' },
  { key: 'last_30', label: 'Last 30 days' }, { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' }, { key: 'this_year', label: 'This year' },
];

export default function Reports() {
  const { masters } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tenders, setTenders] = useState([]);
  const [data, setData] = useState({ items: [], count: 0, total_expense: 0, total_income: 0 });

  const f = {
    stage: params.get('stage') || '',
    category: params.get('category') || '',
    tender_id: params.get('tender_id') || '',
    payment_status: params.get('payment_status') || '',
    paid_by: params.get('paid_by') || '',
    account: params.get('account') || '',
    period: params.get('period') || '',
    date_from: params.get('date_from') || '',
    date_to: params.get('date_to') || '',
  };
  const setF = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const buildQuery = () => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.append(k, v); });
    return p.toString();
  };

  useEffect(() => {
    api.get(`/transactions?${buildQuery()}`).then((r) => setData(r.data));
    api.get('/tenders').then((r) => setTenders(r.data));
  }, [params]);

  const allCategories = [...new Set(Object.values(masters.categories || {}).flat())];

  const downloadCSV = () => {
    const token = localStorage.getItem('bit_token');
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/reports/transactions.csv?${buildQuery()}&auth=${token}`;
    window.open(url, '_blank');
  };
  const printPDF = () => window.print();

  // Category summary
  const byCategory = {};
  data.items.forEach((t) => {
    const c = t.category || 'Uncategorised';
    byCategory[c] = byCategory[c] || { count: 0, total: 0 };
    byCategory[c].count += 1;
    byCategory[c].total += t.amount || 0;
  });
  const catRows = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="p-8 max-w-[1500px]">
      <div className="flex items-center justify-between mb-6 no-print">
        <div>
          <div className="section-label mb-1">Reporting</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Expense Reports</h1>
          <p className="text-sm text-slate-500 mt-1">Filter, view totals by category, export or print.</p>
        </div>
        <div className="flex gap-2">
          <button data-testid="export-csv" onClick={downloadCSV} className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2.5 rounded-sm flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" /> Download CSV (opens in Excel)
          </button>
          <button data-testid="print-pdf" onClick={printPDF} className="bg-[#1E1B4B] hover:bg-[#312e81] text-white text-sm px-4 py-2.5 rounded-sm flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="data-card p-4 mb-6 no-print">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <FS label="Stage" v={f.stage} onC={(v) => setF('stage', v)}
            opts={[{ v: '', l: 'All Stages' }, { v: 'pre_tender', l: 'Pre-Tender' }, { v: 'post_tender', l: 'Post-Tender' }, { v: 'administration', l: 'Administration' }]} />
          <FS label="Category" v={f.category} onC={(v) => setF('category', v)}
            opts={[{ v: '', l: 'All Categories' }, ...allCategories.map((c) => ({ v: c, l: c }))]} />
          <FS label="Tender" v={f.tender_id} onC={(v) => setF('tender_id', v)}
            opts={[{ v: '', l: 'All' }, ...tenders.map((t) => ({ v: t.id, l: t.code }))]} />
          <FS label="Status" v={f.payment_status} onC={(v) => setF('payment_status', v)}
            opts={[{ v: '', l: 'All' }, ...['requested', 'approved', 'paid', 'payable', 'rejected'].map((s) => ({ v: s, l: s }))]} />
          <FS label="Paid By" v={f.paid_by} onC={(v) => setF('paid_by', v)}
            opts={[{ v: '', l: 'Anyone' }, ...(masters.paid_by || []).map((p) => ({ v: p, l: p }))]} />
          <FS label="Account" v={f.account} onC={(v) => setF('account', v)}
            opts={[{ v: '', l: 'All' }, ...(masters.accounts || []).map((a) => ({ v: a, l: a }))]} />
          <FS label="Date Range" v={f.period} onC={(v) => setF('period', v)}
            opts={DATE_PRESETS.map((d) => ({ v: d.key, l: d.label }))} />
        </div>
      </div>

      <div className="print-header hidden print:block mb-4">
        <h2 className="font-display text-xl">Bright India Traders — Expense Report</h2>
        <div className="text-xs text-slate-600">Generated {new Date().toLocaleString('en-IN')}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="kpi"><div className="kpi-label">Transactions</div><div className="kpi-value">{data.count}</div></div>
        <div className="kpi"><div className="kpi-label">Total Expense</div><div className="kpi-value text-red-700">{formatINR(data.total_expense)}</div></div>
        <div className="kpi"><div className="kpi-label">Total Income</div><div className="kpi-value text-emerald-700">{formatINR(data.total_income)}</div></div>
      </div>

      <div className="data-card mb-6 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60"><h3 className="font-display font-semibold text-slate-900 text-sm">By Category</h3></div>
        <table className="w-full data-table">
          <thead><tr><th>Category</th><th className="text-right">Transactions</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {catRows.map(([cat, s]) => (
              <tr key={cat}>
                <td>{cat}</td>
                <td className="num-cell">{s.count}</td>
                <td className="num-cell font-semibold">{formatINR(s.total)}</td>
              </tr>
            ))}
            {catRows.length === 0 && <tr><td colSpan={3} className="text-center py-6 text-slate-400 text-sm">No data for this filter.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="data-card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60"><h3 className="font-display font-semibold text-slate-900 text-sm">Transactions</h3></div>
        <table className="w-full data-table">
          <thead><tr><th>TXN</th><th>Date</th><th>Category</th><th>Vendor</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {data.items.map((t) => (
              <tr key={t.id}>
                <td className="font-mono text-[12px]">{t.code}</td>
                <td>{formatDate(t.date)}</td>
                <td>{t.category}</td>
                <td className="text-slate-600">{t.vendor || '—'}</td>
                <td className="text-slate-600 max-w-md truncate">{t.description || '—'}</td>
                <td className={`num-cell ${t.txn_type === 'income' ? 'text-emerald-700' : ''} font-semibold`}>{formatINR(t.amount)}</td>
              </tr>
            ))}
            {data.items.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">No transactions match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FS({ label, v, onC, opts }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>
      <select value={v} onChange={(e) => onC(e.target.value)}
        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
        {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
