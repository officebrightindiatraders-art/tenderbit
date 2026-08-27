import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  LayoutDashboard, FileText, Receipt, CheckSquare, Landmark, ShieldCheck,
  ArrowDownToLine, ArrowUpFromLine, LogOut, Building2, Wallet, Search, Bell, X,
} from 'lucide-react';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tenders', label: 'Tenders', icon: FileText },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/bank', label: 'Bank', icon: Landmark },
  { to: '/ebg', label: 'EBG / EMD', icon: ShieldCheck },
  { to: '/receivables', label: 'Money In', icon: ArrowDownToLine },
  { to: '/payables', label: 'Money Out', icon: ArrowUpFromLine },
  { to: '/personal', label: 'Personal Payments', icon: Wallet },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav_ = useNavigate();
  const crumbs = buildCrumbs(loc.pathname);

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
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
            <NavLink key={to} to={to} end={end}
              data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="px-2 py-1.5 mb-2">
            <div className="text-[13px] font-medium text-slate-900 truncate">{user?.name}</div>
            <div className="text-[11px] text-slate-500 truncate">{user?.email}</div>
            <div className="mt-1"><span className="pill pill-primary">{user?.role}</span></div>
          </div>
          <button data-testid="logout-btn" onClick={logout}
            className="w-full sidebar-link text-slate-600 hover:text-red-600">
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <TopBar crumbs={crumbs} />
        <Outlet />
      </main>
    </div>
  );
}

function buildCrumbs(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const map = { tenders: 'Tenders', transactions: 'Transactions', approvals: 'Approvals',
    bank: 'Bank', ebg: 'EBG / EMD', receivables: 'Money In', payables: 'Money Out', personal: 'Personal Payments' };
  const out = [{ to: '/', label: 'Dashboard' }];
  let acc = '';
  for (const p of parts) { acc += '/' + p; out.push({ to: acc, label: map[p] || p }); }
  return out;
}

function TopBar({ crumbs }) {
  return (
    <div className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200 px-8 py-2.5 flex items-center justify-between">
      <nav className="text-xs text-slate-500 flex items-center gap-1.5">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-300">/</span>}
            <NavLink to={c.to} className={i === crumbs.length - 1 ? 'text-slate-900 font-medium' : 'hover:text-slate-800'}>
              {c.label}
            </NavLink>
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <GlobalSearch />
        <NotificationBell />
      </div>
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const nav = useNavigate();
  const boxRef = useRef(null);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { const { data } = await api.get(`/search?q=${encodeURIComponent(q)}`); setResults(data.results); }
      catch { setResults([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center bg-slate-100 border border-transparent focus-within:border-indigo-500 focus-within:bg-white rounded-sm px-2.5 py-1.5 w-80 transition-all">
        <Search className="w-3.5 h-3.5 text-slate-400 mr-2" />
        <input
          data-testid="global-search"
          type="text" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search anything — tender, txn, vendor, invoice…"
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
        />
        {q && <button onClick={() => setQ('')}><X className="w-3.5 h-3.5 text-slate-400" /></button>}
      </div>
      {open && q.length >= 2 && (
        <div className="absolute top-full right-0 mt-1 w-96 max-h-96 overflow-y-auto bg-white border border-slate-200 rounded-sm shadow-lg z-40">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-xs text-slate-400 text-center">No results for "{q}"</div>
          ) : results.map((r, i) => (
            <button key={i} data-testid={`search-result-${i}`}
              onClick={() => { nav(r.link); setOpen(false); setQ(''); }}
              className="w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <span className={`pill ${r.type === 'tender' ? 'pill-primary' : r.type === 'transaction' ? 'pill-muted' : r.type === 'item' ? 'pill-warning' : 'pill-success'}`}>{r.type}</span>
                <span className="font-mono text-xs text-indigo-900">{r.code}</span>
              </div>
              <div className="text-sm text-slate-900 mt-0.5">{r.title}</div>
              {r.sub && <div className="text-xs text-slate-500">{r.sub}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef(null);

  const load = async () => {
    try { const { data } = await api.get('/notifications'); setItems(data); }
    catch {}
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  const handleClick = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`);
    if (n.link) nav(n.link);
    setOpen(false);
    load();
  };
  const markAll = async () => { await api.post('/notifications/read-all'); load(); };

  return (
    <div ref={ref} className="relative">
      <button data-testid="notification-bell" onClick={() => setOpen(!open)}
        className="relative p-2 hover:bg-slate-100 rounded-sm">
        <Bell className="w-4 h-4 text-slate-600" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 text-[10px] bg-red-600 text-white rounded-full px-1 flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-96 max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-sm shadow-lg z-40">
          <div className="px-4 py-2.5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <div className="font-semibold text-sm">Notifications</div>
            {unread > 0 && <button onClick={markAll} className="text-xs text-indigo-600 hover:underline">Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-xs text-slate-400 text-center">You're all caught up.</div>
          ) : items.map((n) => (
            <button key={n.id} onClick={() => handleClick(n)} data-testid={`notif-${n.event}`}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${n.read ? '' : 'bg-indigo-50/40'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{n.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{n.message}</div>
                  <div className="text-[10px] text-slate-400 mt-1">{formatDate(n.created_at)}</div>
                </div>
                {!n.read && <span className="w-2 h-2 bg-indigo-600 rounded-full mt-1.5 ml-2 flex-shrink-0" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
