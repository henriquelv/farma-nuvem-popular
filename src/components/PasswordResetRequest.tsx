import React, { useState } from 'react';
import { ArrowLeft, Mail, Pill, Send, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function PasswordResetRequest() {
  const recoveryEnabled = import.meta.env.VITE_PASSWORD_RECOVERY_ENABLED === 'true';
  const { requestPasswordReset } = useAuth();
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await requestPasswordReset(login, email);
      setSent(true);
    } catch (caughtError) {
      const status = Number(
        (caughtError as { status?: number; context?: { status?: number } })?.status
        || (caughtError as { context?: { status?: number } })?.context?.status
        || 0,
      );
      setError(status === 429
        ? 'Muitas solicitações. Aguarde 15 minutos antes de tentar novamente.'
        : 'Não foi possível enviar agora. Confira sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white"><Pill size={21} /></div>
          <p className="text-lg font-black text-slate-900">Farma Nuvem</p>
        </div>
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
          <p className="text-xs font-black text-blue-600">RECUPERAÇÃO DE ACESSO</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Recuperar senha</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Informe o login da farmácia e o e-mail cadastrado para receber um link temporário.</p>

          {!recoveryEnabled ? (
            <div className="mt-6">
              <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-bold leading-6 text-amber-800">O envio automático ainda está aguardando a configuração do provedor de e-mail. Solicite a troca ao administrador da conta.</div>
              <Link to="/login" className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 font-black text-slate-700 hover:bg-slate-50"><ArrowLeft size={17} />Voltar ao login</Link>
            </div>
          ) : sent ? (
            <div className="mt-6">
              <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-bold leading-6 text-emerald-800">
                Se o endereço estiver cadastrado, o link será enviado. Verifique também a caixa de spam.
              </div>
              <Link to="/login" className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 font-black text-slate-700 hover:bg-slate-50"><ArrowLeft size={17} />Voltar ao login</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {error && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
              <label className="block space-y-2">
                <span className="text-sm font-black text-slate-700">Login da farmácia</span>
                <div className="relative">
                  <UserRound size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" required autoFocus minLength={3} maxLength={50} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 py-3 pl-11 pr-3 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-black text-slate-700">E-mail cadastrado</span>
                <div className="relative">
                  <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="email" required maxLength={254} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 py-3 pl-11 pr-3 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
              </label>
              <button type="submit" disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-black text-white hover:bg-blue-700 disabled:opacity-60">
                <Send size={18} />{loading ? 'Enviando...' : 'Enviar link seguro'}
              </button>
              <Link to="/login" className="flex items-center justify-center gap-2 text-sm font-black text-slate-600 hover:text-slate-900"><ArrowLeft size={16} />Voltar ao login</Link>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
