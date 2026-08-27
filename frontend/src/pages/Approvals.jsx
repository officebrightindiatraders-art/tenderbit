import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatINR, formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { Check, X, MessageSquareWarning } from 'lucide-react';

export default function Approvals() {
  const { isAdmin } = useAuth();
  const [txns, setTxns] = useState([]);
  const [tenders, setTenders] = useState([]);

  const load = async () => {
    const [t, td] = await Promise.all([
      api.get('/transactions?payment_status=requested'),
      api.get('/tenders'),
    ]);
    setTxns(t.data); setTenders(td.data);
  };
  useEffect(() => { load(); }, []);

  const act = async (id, action) => {
    try {
      await api.post(`/transactions/${id}/approve`, { action });
      toast.success(`Marked ${action}`);
      load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed'); }
  };

  const tenderCode = (id) => id === 'COMPANY' ? 'COMPANY' : (tenders.find((t) => t.id === id)?.code || '—');

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="section-label mb-1">Workflow</div>
      <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Pending Approvals</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">No unapproved payment enters the system as paid.</p>

      <div className="data-card overflow-hidden">
        <table className="w-full data-table">
          <thead><tr>
            <th>TXN</th><th>Date</th><th>Requested By</th><th>Tender</th><th>Category</th>
            <th>Description</th><th className="text-right">Amount</th><th className="text-right w-56">Action</th>
          </tr></thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id} data-testid={`approve-row-${t.code}`}>
                <td className="font-mono text-[12px] text-slate-600">{t.code}</td>
                <td>{formatDate(t.date)}</td>
                <td className="text-slate-600 text-xs">{t.created_by}</td>
                <td className="font-mono text-[12px] text-indigo-900">{tenderCode(t.tender_id)}</td>
                <td>{t.category}</td>
                <td className="max-w-xs truncate text-slate-600">{t.description || t.vendor || '—'}</td>
                <td className="num-cell font-semibold">{formatINR(t.amount)}</td>
                <td className="text-right">
                  {isAdmin ? (
                    <div className="flex justify-end gap-1.5">
                      <button data-testid={`approve-${t.code}`} onClick={() => act(t.id, 'approve')} className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm flex items-center gap-1"><Check className="w-3 h-3" />Approve</button>
                      <button data-testid={`reject-${t.code}`} onClick={() => act(t.id, 'reject')} className="px-2.5 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm flex items-center gap-1"><X className="w-3 h-3" />Reject</button>
                      <button onClick={() => act(t.id, 'send_back')} className="px-2.5 py-1 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-sm flex items-center gap-1"><MessageSquareWarning className="w-3 h-3" />Query</button>
                    </div>
                  ) : (<span className="text-xs text-slate-400">Admin only</span>)}
                </td>
              </tr>
            ))}
            {txns.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">Nothing awaiting approval. Clean queue.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
