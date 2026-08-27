import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate, todayISO } from '@/lib/format';
import { toast } from 'sonner';
import { Plus, X, Upload, Sparkles, FileText, Edit3 } from 'lucide-react';

const statusPill = (s) => {
  if (['L1', 'AOC Received', 'Execution'].includes(s)) return 'pill-success';
  if (['Not L1', 'Cancelled', 'Technically Disqualified'].includes(s)) return 'pill-danger';
  if (['Completed'].includes(s)) return 'pill-primary';
  return 'pill-warning';
};

export default function Tenders() {
  const { masters, user } = useAuth();
  const [tenders, setTenders] = useState([]);
  const [showManual, setShowManual] = useState(false);
  const [showAI, setShowAI] = useState(false);
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
          <div className="flex gap-2">
            <button
              data-testid="upload-tender-btn"
              onClick={() => setShowAI(true)}
              className="bg-[#1E1B4B] hover:bg-[#312e81] text-white text-sm px-4 py-2.5 rounded-sm flex items-center gap-2 transition-colors"
            >
              <Sparkles className="w-4 h-4" /> Upload Tender PDF
            </button>
            <button
              data-testid="new-tender-btn"
              onClick={() => setShowManual(true)}
              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm px-4 py-2.5 rounded-sm flex items-center gap-2 transition-colors"
            >
              <Edit3 className="w-4 h-4" /> Manual Entry
            </button>
          </div>
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
              <tr key={t.id} onClick={() => nav(`/tenders/${t.id}`)} className="cursor-pointer" data-testid={`tender-row-${t.code}`}>
                <td className="font-mono text-[13px] text-indigo-900 font-semibold">{t.code}</td>
                <td className="text-slate-600">{t.tender_no || '—'}</td>
                <td>{t.department}</td>
                <td className="max-w-xs truncate">{t.name}</td>
                <td className="text-slate-600">{formatDate(t.closing_date)}</td>
                <td className="num-cell">{formatINR(t.contract_value || t.tender_value)}</td>
                <td className="num-cell">{formatINR(t.emd_amount)}</td>
                <td><span className={`pill ${statusPill(t.status)}`}>{t.status}</span></td>
              </tr>
            ))}
            {tenders.length === 0 && (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">
                No tenders yet. Click <b>Upload Tender PDF</b> to have AI extract fields, or <b>Manual Entry</b>.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showManual && <ManualForm statuses={masters.statuses} onClose={() => setShowManual(false)} onSaved={() => { setShowManual(false); load(); }} />}
      {showAI && <AIForm statuses={masters.statuses} onClose={() => setShowAI(false)} onSaved={() => { setShowAI(false); load(); }} />}
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function ManualForm({ statuses, onClose, onSaved }) {
  const [form, setForm] = useState({
    tender_no: '', department: '', name: '',
    tender_date: todayISO(), closing_date: '',
    tender_value: 0, emd_amount: 0, status: 'Identified',
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/tenders', form);
      toast.success(`Created ${data.code}`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <ModalShell title="New Tender (Manual)" onClose={onClose}>
      <form onSubmit={submit} data-testid="tender-form">
        <div className="p-6 grid grid-cols-2 gap-4">
          <F label="Government Tender No."><input value={form.tender_no} onChange={(e) => upd('tender_no', e.target.value)} className={inp} data-testid="tf-tenderno" /></F>
          <F label="Department *"><input required value={form.department} onChange={(e) => upd('department', e.target.value)} className={inp} data-testid="tf-department" /></F>
          <F label="Tender Name *" wide><input required value={form.name} onChange={(e) => upd('name', e.target.value)} className={inp} data-testid="tf-name" /></F>
          <F label="Tender Date (Published)"><input type="date" value={form.tender_date || ''} onChange={(e) => upd('tender_date', e.target.value)} className={inp} /></F>
          <F label="Closing Date"><input type="date" value={form.closing_date || ''} onChange={(e) => upd('closing_date', e.target.value)} className={inp} /></F>
          <F label="Tender Value (₹)"><input type="number" value={form.tender_value} onChange={(e) => upd('tender_value', parseFloat(e.target.value) || 0)} className={inp} data-testid="tf-value" /></F>
          <F label="EMD Amount (₹)"><input type="number" value={form.emd_amount} onChange={(e) => upd('emd_amount', parseFloat(e.target.value) || 0)} className={inp} /></F>
          <F label="Status"><select value={form.status} onChange={(e) => upd('status', e.target.value)} className={inp}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></F>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
          <button type="submit" disabled={busy} data-testid="tf-submit" className="px-4 py-2 text-sm bg-[#1E1B4B] hover:bg-[#312e81] text-white rounded-sm">{busy ? 'Saving…' : 'Create Tender'}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function AIForm({ statuses, onClose, onSaved }) {
  const [step, setStep] = useState('upload'); // upload | extracting | review
  const [file, setFile] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const doExtract = async () => {
    if (!file) return;
    setStep('extracting');
    const fd = new FormData(); fd.append('file', file);
    try {
      const { data } = await api.post('/extract/tender', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm({
        tender_no: data.tender_no || '',
        name: data.name || '',
        department: data.department || '',
        tender_date: data.tender_date || '',
        closing_date: data.closing_date || '',
        tender_value: Number(data.tender_value) || 0,
        emd_amount: Number(data.emd_amount) || 0,
        status: 'Participating',
      });
      setStep('review');
      toast.success('Fields extracted — please review');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Extraction failed');
      setStep('upload');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: tender } = await api.post('/tenders', form);
      // Upload the PDF as tender_document
      const fd = new FormData(); fd.append('file', file);
      const { data: uploaded } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await api.post('/documents', { file_id: uploaded.id, tender_id: tender.id, document_type: 'tender_document' });
      toast.success(`Created ${tender.code} + tender document attached`);
      onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Upload Tender PDF" subtitle="AI extracts basic finance fields. You confirm and save." onClose={onClose}>
      {step === 'upload' && (
        <div className="p-8">
          <label className="block border-2 border-dashed border-slate-300 rounded-sm p-8 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50/40 transition-colors">
            <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
            <div className="text-sm text-slate-700 font-medium">{file ? file.name : 'Click to choose a Tender PDF'}</div>
            <div className="text-xs text-slate-500 mt-1">Only PDF · fields will be extracted automatically</div>
            <input type="file" accept="application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0])} data-testid="ai-file-input" />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
            <button onClick={doExtract} disabled={!file} data-testid="ai-extract-btn" className="px-4 py-2 text-sm bg-[#1E1B4B] hover:bg-[#312e81] disabled:opacity-50 text-white rounded-sm flex items-center gap-2"><Sparkles className="w-4 h-4" />Extract fields</button>
          </div>
        </div>
      )}

      {step === 'extracting' && (
        <div className="p-12 text-center">
          <Sparkles className="w-8 h-8 mx-auto text-indigo-600 animate-pulse mb-3" />
          <div className="text-sm text-slate-700 font-medium">Reading document…</div>
          <div className="text-xs text-slate-500 mt-1">Extracting tender fields. This can take 10–20 seconds.</div>
        </div>
      )}

      {step === 'review' && form && (
        <form onSubmit={submit} data-testid="ai-review-form">
          <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-800 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" /> Review AI-extracted fields below. Edit anything that looks wrong before saving.
          </div>
          <div className="p-6 grid grid-cols-2 gap-4">
            <F label="Government Tender No."><input value={form.tender_no} onChange={(e) => setForm({ ...form, tender_no: e.target.value })} className={inp} /></F>
            <F label="Department *"><input required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inp} /></F>
            <F label="Tender Name *" wide><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} /></F>
            <F label="Published Date"><input type="date" value={form.tender_date || ''} onChange={(e) => setForm({ ...form, tender_date: e.target.value })} className={inp} /></F>
            <F label="Closing Date"><input type="date" value={form.closing_date || ''} onChange={(e) => setForm({ ...form, closing_date: e.target.value })} className={inp} /></F>
            <F label="Tender Value (₹)"><input type="number" value={form.tender_value} onChange={(e) => setForm({ ...form, tender_value: parseFloat(e.target.value) || 0 })} className={inp} /></F>
            <F label="EMD Amount (₹)"><input type="number" value={form.emd_amount} onChange={(e) => setForm({ ...form, emd_amount: parseFloat(e.target.value) || 0 })} className={inp} /></F>
            <F label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inp}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></F>
          </div>
          <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center gap-2 bg-slate-50">
            <button type="button" onClick={() => setStep('upload')} className="text-xs text-slate-500 hover:text-slate-800">← Re-upload PDF</button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-sm">Cancel</button>
              <button type="submit" disabled={busy} data-testid="ai-confirm-btn" className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm">{busy ? 'Creating…' : 'Confirm & Create Tender'}</button>
            </div>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-start justify-center pt-10 px-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-sm border border-slate-200 shadow-lg mb-10">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="font-display text-lg font-semibold">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function F({ label, wide, children }) {
  return <label className={`block ${wide ? 'col-span-2' : ''}`}>
    <span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">{label}</span>
    {children}
  </label>;
}
