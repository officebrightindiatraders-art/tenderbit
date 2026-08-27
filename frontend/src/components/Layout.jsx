import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard, FileText, Receipt, CheckSquare, Landmark, ShieldCheck,
  ArrowDownToLine, ArrowUpFromLine, LogOut, Building2,
} from 'lucide-react';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tenders', label: 'Tenders', icon: FileText },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/bank', label: 'Bank Reconciliation', icon: Landmark },
  { to: '/ebg', label: 'EBG / EMD Register', icon: ShieldCheck },
  { to: '/receivables', label: 'Receivables', icon: ArrowDownToLine },
  { to: '/payables', label: 'Payables', icon: ArrowUpFromLine },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-sm bg-[#1E1B4B] flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" strokeWidth={1.75} />
            </div>
            <div>
              <div className="font-display font-semibold text-[15px] text-slate-900 leading-tight">Bright India</div>
              <div className="text-[11px] text-slate-500 tracking-wide uppercase">Traders · Finance</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="section-label px-2 pt-1 pb-2">Workspace</div>
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="px-2 py-1.5 mb-2">
            <div className="text-[13px] font-medium text-slate-900 truncate" data-testid="current-user-name">{user?.name}</div>
            <div className="text-[11px] text-slate-500 truncate">{user?.email}</div>
            <div className="mt-1"><span className="pill pill-primary">{user?.role}</span></div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={logout}
            className="w-full sidebar-link text-slate-600 hover:text-red-600"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
