import { createContext, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [masters, setMasters] = useState({ statuses: [], categories: {}, accounts: [] });

  useEffect(() => {
    const token = localStorage.getItem('bit_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(async (r) => {
        setUser(r.data);
        const m = await api.get('/masters');
        setMasters(m.data);
      })
      .catch(() => localStorage.removeItem('bit_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('bit_token', data.token);
    setUser(data.user);
    const m = await api.get('/masters');
    setMasters(m.data);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('bit_token');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, masters, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
