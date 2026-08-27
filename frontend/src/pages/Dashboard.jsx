import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { formatCompactINR, formatINR, formatDate } from '@/lib/format';
import {
  TrendingUp, ShieldCheck, FileText, Wallet, Clock, ArrowUpRight, ArrowDownRight,
  Receipt, AlertTriangle, CheckSquare, Landmark, FileWarning,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const nav = useNavigate();

  useEffect(() => { api.get('/reports/dashboard').then((r) => setData(r.data)); }, []);
  if (!data) return <div className="p-8 text-slate-500">Loading…</div>;

  const kpis = [
    { label: 'Tender Value', value: data.tender_value_total, icon: FileText, tone: 'text-indigo-900', link: '/tenders' },
    { label: 'Revenue Received', value: data.revenue, icon: TrendingUp, tone: 'text-emerald-700', link: '/transactions?stage=income' },
    { label: 'Money to Receive', sub: 'Receivables', value: data.receivables, icon: ArrowDownRight, tone: 'text-indigo-700', link: '/receivables' },
    { label: 'Money to Pay', sub: 'Payables', value: data.payables, icon: ArrowUpRight, tone: 'text-amber-700', link: '/payables' },
    { label: 'Pre-Tender Expenses', value: data.pre_tender_cost, icon: Receipt, tone: 'text-red-700', link: '/transactions?stage=pre_tender' },
    { label: 'Administration', value: data.admin_cost, icon: Receipt, tone: 'text-slate-800', link: '/transactions?stage=administration' },
    { label: 'Post-Tender Expenses', value: data.post_tender_cost, icon: Receipt, tone: 'text-amber-700', link: '/transactions?stage=post_tender' },
    { label: 'Total Expenses', value: data.total_actual_cost, icon: Wallet, tone: 'text-slate-800', link: '/transactions?stage=post_tender' },
    { label: 'Profit / Contribution', value: data.gross_contribution, icon: Wallet, tone: data.gross_contribution >= 0 ? 'text-emerald-700' : 'text-red-700', link: '/transactions' },
    { label: 'EMD Outstanding', value: data.emd_outstanding, icon: FileText, tone: 'text-slate-700', link: '/transactions?category=EMD' },
    { label: 'EBG Blocked', value: data.ebg_blocked, icon: ShieldCheck, tone: 'text-slate-700', link: '/ebg' },
  ];

  const ar = data.action_required || {};
  const actions = [
    { key: 'pending_approvals', label: 'Pending approvals', count: ar.pending_approvals, icon: CheckSquare, link: '/approvals', tone: 'text-amber-700' },
    { key: 'missing_proof', label: 'Missing proofs', count: ar.missing_proof, icon: FileWarning, link: '/transactions?missing_proof=true', tone: 'text-red-700' },
    { key: 'unmatched_bank', label: 'Unmatched bank lines', count: ar.unmatched_bank, icon: Landmark, link: '/bank', tone: 'text-indigo-700' },
    { key: 'payables_overdue', label: 'Payables overdue', count: ar.payables_overdue, icon: ArrowUpRight, link: '/payables', tone: 'text-red-700' },
    { key: 'receivables_overdue', label: 'Receivables overdue', count: ar.receivables_overdue, icon: ArrowDownRight, link: '/receivables', tone: 'text-red-700' },
    { key: 'ebg_expiring_soon', label: 'EBG expiring soon', count: ar.ebg_expiring_soon, icon: ShieldCheck, link: '/ebg', tone: 'text-red-700' },
  ];
  const totalAction = actions.reduce((s, a) => s + (a.count || 0), 0);

  const chartData = [
    { label: 'Tender Value', value: data.tender_value_total, fill: '#1E1B4B' },
    { label: 'Revenue', value: data.revenue, fill: '#059669' },
    { label: 'Pre-Tender', value: data.pre_tender_cost, fill: '#DC2626' },
    { label: 'Post-Tender', value: data.post_tender_cost, fill: '#F59E0B' },
    { label: 'Contribution', value: data.gross_contribution, fill: '#6366F1' },
  ];

  const critical = (data.ebg_expiring || []).filter((e) => e.severity === 'critical');
  const warning = (data.ebg_expiring || []).filter((e) => e.severity === 'warning');

  return (
    <div className="p-8 max-w-[1600px]">
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="section-label mb-1">Command Centre</div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Financial Overview</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="pill pill-primary" data-testid="kpi-active-tenders">{data.active_tenders} Active</span>
          <span className="pill pill-muted">{data.total_tenders} Total Tenders</span>
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-6">Click any number to see the transactions behind it.</p>

      {totalAction > 0 && (
        <div className="mb-6 data-card p-5" data-testid="action-required">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <div className="font-display font-semibold text-sm text-slate-900">Action Required</div>
            <span className="pill pill-warning">{totalAction} items</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {actions.filter((a) => a.count > 0).map((a) => (
              <Link key={a.key} to={a.link} data-testid={`ar-${a.key}`}
                className="border border-slate-200 rounded-sm p-3 hover:bg-slate-50 hover:border-indigo-500 transition-colors">
                <div className="flex items-center justify-between mb-1.5">
                  <a.icon className={`w-4 h-4 ${a.tone}`} />
                  <span className="font-mono text-lg font-semibold">{a.count}</span>
                </div>
                <div className="text-xs text-slate-700">{a.label}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {(critical.length > 0 || warning.length > 0) && (
        <div className="mb-6 border border-red-200 bg-red-50/60 rounded-sm p-4" data-testid="ebg-alert-panel">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-700" />
            <div className="font-display font-semibold text-sm text-red-900">EBG Expiry Alerts</div>
            <span className="pill pill-danger">{critical.length} critical</span>
            <span className="pill pill-warning">{warning.length} soon</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {[...critical, ...warning].slice(0, 6).map((e) => (
              <Link key={e.id} to="/ebg" className="text-xs bg-white border border-slate-200 rounded-sm px-3 py-2 flex items-center justify-between hover:border-red-400">
                <div>
                  <div className="font-mono text-indigo-900 font-semibold">{e.tender_code}</div>
                  <div className="text-slate-500">{e.bank} · expires {formatDate(e.expiry_date)}</div>
                </div>
                <div className="text-right">
                  <div className={`font-mono font-semibold ${e.severity === 'critical' ? 'text-red-700' : 'text-amber-700'}`}>{e.days_left}d</div>
                  <div className="text-slate-500 num">{formatCompactINR(e.amount)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {kpis.map((k) => (
          <button key={k.label} onClick={() => nav(k.link)}
            data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '-')}`}
            className="kpi text-left hover:border-indigo-500 hover:shadow-sm transition-all cursor-pointer group">
            <div className="flex items-center justify-between">
              <div className="kpi-label">{k.label}</div>
              <k.icon className={`w-4 h-4 ${k.tone} group-hover:scale-110 transition-transform`} strokeWidth={1.75} />
            </div>
            <div className={`kpi-value ${k.tone}`} title={formatINR(k.value)}>{formatCompactINR(k.value)}</div>
            {k.sub && <div className="kpi-sub">{k.sub}</div>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="data-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-base font-semibold text-slate-900">Value vs Costs</h3>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">Cumulative</div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
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
          <h3 className="font-display text-base font-semibold text-slate-900 mb-4">Personal Payments to Reimburse</h3>
          <div className="space-y-3">
            {Object.entries(data.personal_reimbursement || {}).map(([person, amt]) => (
              <Link key={person} to={`/personal?person=${person}`}
                className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 hover:bg-slate-50 -mx-2 px-2 py-1 rounded-sm">
                <div className="text-sm text-slate-700 font-medium">{person}</div>
                <div className="num font-semibold text-slate-900">{formatINR(amt)}</div>
              </Link>
            ))}
            {Object.keys(data.personal_reimbursement || {}).length === 0 && (
              <div className="text-xs text-slate-400 text-center py-4">No personal payments recorded yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
