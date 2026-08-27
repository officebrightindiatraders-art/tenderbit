import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { formatCompactINR, formatINR, formatDate } from '@/lib/format';
import { TrendingUp, ShieldCheck, FileText, Wallet, Clock, ArrowUpRight, ArrowDownRight, Landmark, AlertTriangle, Receipt } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function Dashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/reports/dashboard').then((r) => setData(r.data));
  }, []);

  if (!data) return <div className="p-8 text-slate-500">Loading…</div>;

  const chartData = [
    { label: 'Tender Value', value: data.tender_value_total, fill: '#1E1B4B' },
    { label: 'Revenue', value: data.revenue, fill: '#059669' },
    { label: 'Pre-Tender', value: data.pre_tender_cost, fill: '#DC2626' },
    { label: 'Post-Tender', value: data.post_tender_cost, fill: '#F59E0B' },
    { label: 'Contribution', value: data.gross_contribution, fill: '#6366F1' },
  ];

  const kpis = [
    { label: 'Tender Value', value: data.tender_value_total, icon: FileText, tone: 'text-indigo-900' },
    { label: 'Revenue Received', value: data.revenue, icon: TrendingUp, tone: 'text-emerald-700' },
    { label: 'Receivables', value: data.receivables, icon: ArrowDownRight, tone: 'text-indigo-700' },
    { label: 'Payables', value: data.payables, icon: ArrowUpRight, tone: 'text-amber-700' },
    { label: 'Pre-Tender Cost', value: data.pre_tender_cost, icon: Receipt, tone: 'text-red-700' },
    { label: 'Post-Tender Cost', value: data.post_tender_cost, icon: Receipt, tone: 'text-amber-700' },
    { label: 'Total Actual Cost', value: data.total_actual_cost, icon: Wallet, tone: 'text-slate-800' },
    { label: 'Contribution', value: data.gross_contribution, icon: Wallet, tone: data.gross_contribution >= 0 ? 'text-emerald-700' : 'text-red-700' },
    { label: 'EMD Outstanding', value: data.emd_outstanding, icon: FileText, tone: 'text-slate-700' },
    { label: 'EBG Blocked', value: data.ebg_blocked, icon: ShieldCheck, tone: 'text-slate-700' },
  ];

  const critical = (data.ebg_expiring || []).filter((e) => e.severity === 'critical');
  const warning = (data.ebg_expiring || []).filter((e) => e.severity === 'warning');
  const notice = (data.ebg_expiring || []).filter((e) => e.severity === 'notice');

  return (
    <div className="p-8 max-w-[1500px]">
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="section-label mb-1">Command Centre</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Financial Overview</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="pill pill-primary" data-testid="kpi-active-tenders">{data.active_tenders} Active</span>
          <span className="pill pill-muted">{data.total_tenders} Total Tenders</span>
          <Link to="/approvals"><span className="pill pill-warning" data-testid="kpi-pending-approvals"><Clock className="w-3 h-3 mr-1" /> {data.pending_approvals} Pending</span></Link>
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-6">One transaction, entered once — reported across every view.</p>

      {(critical.length > 0 || warning.length > 0) && (
        <div className="mb-6 border border-red-200 bg-red-50/60 rounded-sm p-4" data-testid="ebg-alert-panel">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-700" />
            <div className="font-display font-semibold text-sm text-red-900">EBG Expiry Alerts</div>
            <span className="pill pill-danger">{critical.length} critical</span>
            <span className="pill pill-warning">{warning.length} soon</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {[...critical, ...warning, ...notice].slice(0, 6).map((e) => (
              <div key={e.id} className="text-xs bg-white border border-slate-200 rounded-sm px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="font-mono text-indigo-900 font-semibold">{e.tender_code}</div>
                  <div className="text-slate-500">{e.bank} · expires {formatDate(e.expiry_date)}</div>
                </div>
                <div className="text-right">
                  <div className={`font-mono font-semibold ${e.severity === 'critical' ? 'text-red-700' : e.severity === 'warning' ? 'text-amber-700' : 'text-slate-700'}`}>{e.days_left}d</div>
                  <div className="text-slate-500 num">{formatCompactINR(e.amount)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {kpis.map((k) => (
          <div key={k.label} className="kpi" data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <div className="flex items-center justify-between">
              <div className="kpi-label">{k.label}</div>
              <k.icon className={`w-4 h-4 ${k.tone}`} strokeWidth={1.75} />
            </div>
            <div className={`kpi-value ${k.tone}`} title={formatINR(k.value)}>{formatCompactINR(k.value)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="data-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-base font-semibold text-slate-900">Value vs Costs</h3>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">All Tenders · Cumulative</div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} tickFormatter={(v) => formatCompactINR(v)} />
              <Tooltip formatter={(v) => formatINR(v)} contentStyle={{ borderRadius: 3, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="data-card p-5">
          <h3 className="font-display text-base font-semibold text-slate-900 mb-4">Working Capital Snapshot</h3>
          <div className="space-y-3">
            {[
              { label: 'Money in receivables', v: data.receivables, tone: 'text-indigo-700' },
              { label: 'Owed to suppliers', v: data.payables, tone: 'text-amber-700' },
              { label: 'Locked in EBG', v: data.ebg_blocked, tone: 'text-slate-700' },
              { label: 'EMD outstanding', v: data.emd_outstanding, tone: 'text-slate-700' },
              { label: 'Total actual cost', v: data.total_actual_cost, tone: 'text-red-700' },
              { label: 'Operating contribution', v: data.operating_contribution, tone: data.operating_contribution >= 0 ? 'text-emerald-700' : 'text-red-700' },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
                <div className="text-sm text-slate-600">{r.label}</div>
                <div className={`num font-medium ${r.tone}`}>{formatINR(r.v)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
