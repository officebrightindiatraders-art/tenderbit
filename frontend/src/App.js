import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Tenders from '@/pages/Tenders';
import TenderDetail from '@/pages/TenderDetail';
import Transactions from '@/pages/Transactions';
import Approvals from '@/pages/Approvals';
import BankRecon from '@/pages/BankRecon';
import EBG from '@/pages/EBG';
import Receivables from '@/pages/Receivables';
import Payables from '@/pages/Payables';
import PersonalPayments from '@/pages/PersonalPayments';
import Reports from '@/pages/Reports';
import '@/App.css';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Layout /></Protected>}>
              <Route index element={<Dashboard />} />
              <Route path="tenders" element={<Tenders />} />
              <Route path="tenders/:id" element={<TenderDetail />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="bank" element={<BankRecon />} />
              <Route path="ebg" element={<EBG />} />
              <Route path="receivables" element={<Receivables />} />
              <Route path="payables" element={<Payables />} />
              <Route path="personal" element={<PersonalPayments />} />
              <Route path="reports" element={<Reports />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
