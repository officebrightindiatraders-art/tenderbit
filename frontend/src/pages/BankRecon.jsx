import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { Upload, Link as LinkIcon } from 'lucide-react';

export default function BankRecon() {
  const { masters } = useAuth();
  const [bankTxns, setBankTxns] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [selectedBank, setSelectedBank] = useState(null);
  const [account, setAccount] = useState('ICICI');
  const [uploading, setUploading] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const load = async () => {
    const [b, l, td] = await Promise.all([
      api.get('/bank?reconciled=false'),
      api.get('/transactions'),
      api.get('/tenders'),
    ]);
    setBankTxns(b.data); setLedger(l.data.filter((t) => !t.reconciled && t.payment_status === 'paid')); setTenders(td.data);
  };
  useEffect(() => { load(); }, []);

  const uploadCSV = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/bank/upload?account=${encodeURIComponent(account)}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Imported ${data.inserted} bank transactions`);
      load();
    } catch (err) { toast.error('Upload failed. Expect columns: Date, Description/Narration, Debit/Credit'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const match = async (ledgerId) => {
    try {
      await api.post('/bank/match', { bank_txn_id: selectedBank.id, ledger_txn_id: ledgerId });
      toast.success('Reconciled ✓');
      setSelectedBank(null);
      load();
    } catch (err) { toast.error('Failed'); }
  };

  const tenderCode = (id) => id === 'COMPANY' ? 'COMPANY' : (tenders.find((t) => t.id === id)?.code || '—');

  return (
    <div className="p-8 max-w-[1500px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="section-label mb-1">Reconciliation</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Bank Matching</h1>
          <p className="text-sm text-slate-500 mt-1">Every bank line eventually has an explanation.</p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-sm text-sm bg-white">
            {masters.accounts.map((a) => <option key={a}>{a}</option>)}
          </select>
          <label className="cursor-pointer bg-[#1E1B4B] hover:bg-[#312e81] text-white text-sm px-4 py-2 rounded-sm flex items-center gap-2">
            <Upload className="w-4 h-4" /> {uploading ? 'Importing…' : 'Import CSV'}
            <input type="file" accept=".csv" hidden onChange={uploadCSV} data-testid="bank-csv-upload" />
          </label>
          <button onClick={() => setShowManual(true)} className="text-sm px-3 py-2 border border-slate-300 rounded-sm hover:bg-slate-50">+ Manual entry</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="data-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <h3 className="font-display font-semibold text-slate-900 text-sm">Unmatched Bank Transactions</h3>
            <span className="text-xs text-slate-500">{bankTxns.length} items</span>
          </div>
          <table className="w-full data-table">
            <thead><tr><th>Date</th><th>Account</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {bankTxns.map((b) => (
                <tr key={b.id} onClick={() => setSelectedBank(b)} className={`cursor-pointer ${selectedBank?.id === b.id ? 'bg-indigo-50' : ''}`} data-testid={`bank-row-${b.id}`}>
                  <td>{formatDate(b.date)}</td>
                  <td className="text-slate-600">{b.account}</td>
                  <td className="max-w-xs truncate text-slate-600 text-xs">{b.description}</td>
                  <td className={`num-cell ${b.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatINR(b.amount)}</td>
                </tr>
              ))}
              {bankTxns.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-slate-400 text-sm">All bank transactions reconciled.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="data-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <h3 className="font-display font-semibold text-slate-900 text-sm">
              {selectedBank ? `Match to ledger — ${formatINR(selectedBank.amount)}` : 'Unreconciled Ledger'}
            </h3>
            <span className="text-xs text-slate-500">{ledger.length} paid txns</span>
          </div>
          <table className="w-full data-table">
            <thead><tr><th>TXN</th><th>Date</th><th>Tender</th><th>Category</th><th className="text-right">Amount</th><th></th></tr></thead>
            <tbody>
              {ledger.map((t) => (
                <tr key={t.id}>
                  <td className="font-mono text-[12px]">{t.code}</td>
                  <td>{formatDate(t.date)}</td>
                  <td className="font-mono text-[12px] text-indigo-900">{tenderCode(t.tender_id)}</td>
                  <td>{t.category}</td>
                  <td className="num-cell">{formatINR(t.amount)}</td>
                  <td className="text-right">
                    {selectedBank && (
                      <button data-testid={`match-${t.code}`} onClick={() => match(t.id)} className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm flex items-center gap-1 ml-auto"><LinkIcon className="w-3 h-3" />Match</button>
                    )}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">No unreconciled paid transactions.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showManual && <ManualBankModal masters={masters} onClose={() => setShowManual(false)} onSaved={() => { setShowManual(false); load(); }} />}
    </div>
  );
}

function ManualBankModal({ masters, onClose, onSaved }) {
  const [form, setForm] = useState({ account: 'ICICI', date: todayISO(), description: '', amount: 0, reference: '' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/bank/manual', form);
      toast.success('Bank entry added');
      onSaved();
    } catch (err) { toast.error('Failed'); }
  };
  const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-16 px-4">
      <form onSubmit={submit} className="bg-white w-full max-w-md rounded-sm border border-slate-200 shadow-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center"><h3 className="font-display text-lg font-semibold">Manual Bank Entry</h3><button type="button" onClick={onClose}>✕</button></div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Account</span><select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} className={inp}>{masters.accounts.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Date</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inp} /></label>
          <label className="col-span-2 block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Description</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inp} /></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Amount (±)</span><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className={inp} /></label>
          <label className="block"><span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Reference</span><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={inp} /></label>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-[#1E1B4B] text-white rounded-sm">Save</button>
        </div>
      </form>
    </div>
  );
}
