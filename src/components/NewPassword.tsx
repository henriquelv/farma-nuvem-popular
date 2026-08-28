import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff, KeyRound, Pill } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import PasswordRequirements from './PasswordRequirements';
import { PASSWORD_MAX_LENGTH, validatePassword } from '../lib/password-security';

export default function NewPassword() {
  const { user, loading: authLoading, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validatePassword(password);
    if (validationError) return setError(validationError);
    if (password !== confirmation) return setError('As duas senhas precisam ser iguais.');
    setLoading(true);
    setError('');
    try {
      await updatePassword(password);
      await signOut();
      navigate('/login', { replace: true, state: { passwordUpdated: true } });
    } catch {
      setError('O link expirou ou a senha não pôde ser atualizada. Solicite um novo link.');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white"><Pill size={21} /></div>
          <p className="text-lg font-black text-slate-900">Farma Nuvem</p>
        </div>
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
          <p className="text-xs font-black text-blue-600">PROTEÇÃO DA CONTA</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Criar nova senha</h1>
          {!user ? (
            <div className="mt-6">
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-bold leading-6 text-amber-800">Este link é inválido ou expirou. Solicite uma nova recuperação.</div>
              <Link to="/recuperar-senha" className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 font-black text-white hover:bg-blue-700"><ArrowLeft size={17} />Solicitar novo link</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {error && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
              <label className="block space-y-2">
                <span className="text-sm font-black text-slate-700">Nova senha</span>
                <div className="relative">
                  <KeyRound size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type={showPassword ? 'text' : 'password'} required maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 py-3 pl-11 pr-11 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-700" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
              </label>
              <PasswordRequirements password={password} />
              <label className="block space-y-2">
                <span className="text-sm font-black text-slate-700">Confirmar nova senha</span>
                <input type={showPassword ? 'text' : 'password'} required maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 px-3 py-3 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              </label>
              <button type="submit" disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-black text-white hover:bg-blue-700 disabled:opacity-60">{loading ? 'Atualizando...' : 'Salvar nova senha'}</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

