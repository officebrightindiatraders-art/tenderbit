import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { Building2, ArrowRight } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('office.brightindiatraders@gmail.com');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      toast.success('Signed in');
      nav('/');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-5">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:col-span-3 relative overflow-hidden bg-[#0F172A] flex-col justify-between p-14">
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-sm bg-white/10 backdrop-blur flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" strokeWidth={1.75} />
          </div>
          <div>
            <div className="font-display text-white text-lg font-semibold tracking-tight">Bright India Traders</div>
            <div className="text-slate-400 text-xs uppercase tracking-widest">Tender · Finance · Operations</div>
          </div>
        </div>

        <div className="relative z-10">
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: `url("https://images.pexels.com/photos/13368318/pexels-photo-13368318.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940")`,
              backgroundSize: 'cover', backgroundPosition: 'center',
            }}
          />
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.2em] text-indigo-300 mb-4">The single ledger</div>
            <h1 className="font-display text-white text-4xl lg:text-5xl font-semibold leading-[1.05] tracking-tight max-w-lg">
              Every rupee entered once. <span className="text-indigo-300">Reported everywhere.</span>
            </h1>
            <p className="text-slate-400 text-[15px] mt-5 max-w-md leading-relaxed">
              From ₹500 stamp paper to ₹10 lakh contract receipt — tag it, approve it, pay it,
              reconcile it. Tender P&amp;L, item costing, working capital and EBG registry all
              built on the same clean transaction database.
            </p>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-3 gap-6 text-slate-300 text-xs">
          <div><div className="text-white font-mono text-lg">01</div><div className="mt-1">Tender Master</div></div>
          <div><div className="text-white font-mono text-lg">02</div><div className="mt-1">Approval Workflow</div></div>
          <div><div className="text-white font-mono text-lg">03</div><div className="mt-1">Bank Reconciliation</div></div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="lg:col-span-2 flex items-center justify-center bg-white p-8 lg:p-14">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="mb-8">
            <div className="section-label mb-2">Portal Access</div>
            <h2 className="font-display text-3xl font-semibold text-slate-900 tracking-tight">Sign in</h2>
            <p className="text-slate-500 text-sm mt-1.5">Use your Bright India Traders workspace credentials.</p>
          </div>

          <label className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Email</label>
          <input
            data-testid="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />

          <label className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5 mt-5">Password</label>
          <input
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />

          <button
            data-testid="login-submit"
            type="submit"
            disabled={busy}
            className="mt-8 w-full bg-[#1E1B4B] hover:bg-[#312e81] text-white font-medium text-sm py-3 rounded-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {busy ? 'Signing in…' : (<>Enter workspace <ArrowRight className="w-4 h-4" /></>)}
          </button>

          <div className="mt-8 pt-5 border-t border-slate-200 text-xs text-slate-500">
            <div className="font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Demo credentials</div>
            <div>Owner: <span className="font-mono text-slate-800">office.brightindiatraders@gmail.com</span> / <span className="font-mono">Admin@1234</span></div>
            <div>Staff: <span className="font-mono text-slate-800">bharath@brightindiatraders.in</span> / <span className="font-mono">Staff@1234</span></div>
          </div>
        </form>
      </div>
    </div>
  );
}
