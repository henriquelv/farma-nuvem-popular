import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ArrowRight, Building2, Eye, EyeOff, Pill } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export default function Login() {
  const { user, profile, loading: authLoading, profileError, signIn } = useAuth();
  const location = useLocation();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!authLoading && user && profile) {
    const requested = (location.state as { from?: string } | null)?.from;
    return <Navigate to={requested || '/clientes'} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(login, password);
    } catch {
      setError('Login ou senha inválidos. Confira os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(300px,0.78fr)_1.22fr]">
      <section className="hidden min-h-screen border-r border-slate-800 bg-slate-950 px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600"><Pill size={23} /></div>
          <div><p className="text-lg font-black">Farma Nuvem</p><p className="text-xs font-bold text-slate-400">Auditoria farmacêutica</p></div>
        </div>
        <div className="max-w-sm border-l-2 border-emerald-400 pl-6">
          <p className="text-sm font-bold text-emerald-300">AMBIENTE RESTRITO</p>
          <p className="mt-3 text-3xl font-black leading-tight">Registros organizados para a rotina da farmácia.</p>
        </div>
        <p className="text-xs font-semibold text-slate-500">Acesso exclusivo para estabelecimentos cadastrados.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
        <div className="w-full max-w-md">
          <header className="mb-8">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white"><Pill size={21} /></div>
              <p className="text-lg font-black text-slate-900">Farma Nuvem</p>
            </div>
            <p className="text-xs font-black text-blue-600">ACESSO DA FARMÁCIA</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Entrar no sistema</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">Identifique sua farmácia para continuar.</p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
          {(error || profileError) && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error || profileError}</div>}
          <label className="block space-y-2">
            <span className="text-sm font-black text-slate-700">Login da farmácia</span>
            <div className="relative"><Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" required autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Ex.: farmacia-centro" className="min-h-12 w-full rounded-lg border border-slate-200 py-3 pl-11 pr-3 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></div>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-black text-slate-700">Senha</span>
            <div className="relative"><input type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 px-3 py-3 pr-11 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-700" title={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          </label>
          <button type="submit" disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-black text-white hover:bg-blue-700 disabled:opacity-60">
            {loading ? 'Entrando...' : <><span>Entrar</span><ArrowRight size={18} /></>}
          </button>
        </form>
        </div>
      </section>
    </main>
  );
}
