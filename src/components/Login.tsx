import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { KeyRound, LockKeyhole, Pill } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { user, profile, loading: authLoading, profileError, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!authLoading && user && profile) {
    const requested = (location.state as { from?: string } | null)?.from;
    return <Navigate to={requested || (profile.role === 'admin' ? '/admin' : '/clientes')} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(email, password);
    } catch {
      setError('E-mail ou senha inválidos. Confira os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-5">
      <section className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <header className="border-b border-slate-100 px-7 py-6">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-white"><Pill size={23} /></div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-600">Farmácia Popular</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Acesso ao sistema</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">Entre com seu usuário autorizado.</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-7 py-6">
          {(error || profileError) && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error || profileError}</div>}
          <label className="block space-y-2">
            <span className="text-sm font-black text-slate-700">E-mail</span>
            <div className="relative"><KeyRound size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 py-3 pl-10 pr-3 font-semibold text-slate-900 outline-none focus:border-blue-500" /></div>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-black text-slate-700">Senha</span>
            <div className="relative"><LockKeyhole size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-slate-200 py-3 pl-10 pr-3 font-semibold text-slate-900 outline-none focus:border-blue-500" /></div>
          </label>
          <button type="submit" disabled={loading} className="flex min-h-12 w-full items-center justify-center rounded-lg bg-slate-900 px-4 font-black text-white hover:bg-slate-800 disabled:opacity-60">
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
