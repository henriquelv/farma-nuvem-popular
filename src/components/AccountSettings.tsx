import React, { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Mail, Save, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSupabase } from '../lib/supabase';
import { PASSWORD_MAX_LENGTH, validatePassword } from '../lib/password-security';
import PasswordRequirements from './PasswordRequirements';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AccountSettings() {
  const recoveryEnabled = import.meta.env.VITE_PASSWORD_RECOVERY_ENABLED === 'true';
  const navigate = useNavigate();
  const { profile, changePassword, signOut } = useAuth();
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    const loadEmail = async () => {
      const supabase = getSupabase();
      if (!supabase || !profile) return setLoadingEmail(false);
      const { data, error } = await supabase
        .from('farmacias')
        .select('recovery_email')
        .eq('id', profile.farmacia_id)
        .single();
      if (!error) setRecoveryEmail(data?.recovery_email || '');
      else setEmailError('Não foi possível carregar o e-mail cadastrado.');
      setLoadingEmail(false);
    };
    void loadEmail();
  }, [profile]);

  const saveEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = recoveryEmail.trim().toLowerCase();
    setEmailMessage('');
    setEmailError('');
    if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
      setEmailError('Informe um endereço de e-mail válido.');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    setSavingEmail(true);
    const { data, error } = await supabase.rpc('update_own_recovery_email', { new_email: normalized });
    setSavingEmail(false);
    if (error) return setEmailError('Não foi possível salvar o e-mail. Tente novamente.');
    setRecoveryEmail(String(data || normalized));
    setEmailMessage('E-mail de recuperação salvo com segurança.');
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    const validationError = validatePassword(newPassword);
    if (validationError) return setPasswordError(validationError);
    if (newPassword !== passwordConfirmation) return setPasswordError('As duas senhas novas precisam ser iguais.');
    if (newPassword === currentPassword) return setPasswordError('A nova senha deve ser diferente da senha atual.');
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      await signOut();
      navigate('/login', { replace: true, state: { passwordUpdated: true } });
    } catch {
      setPasswordError('Senha atual incorreta ou alteração não autorizada. Confira e tente novamente.');
      setSavingPassword(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={saveEmail} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Mail size={20} /></div>
          <div>
            <h2 className="text-lg font-black text-slate-950">E-mail de recuperação</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Endereço que receberá os links seguros de recuperação da conta.</p>
          </div>
        </div>
        {emailError && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"><AlertTriangle size={17} />{emailError}</div>}
        {emailMessage && <div role="status" className="mt-5 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800"><ShieldCheck size={17} />{emailMessage}</div>}
        {recoveryEnabled ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Depois de salvo, este e-mail fica disponível automaticamente para recuperação de senha.</div>
        ) : (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">Envio automático aguardando a configuração segura do provedor de e-mail.</div>
        )}
        <label className="mt-5 block space-y-2">
          <span className="text-sm font-black text-slate-700">E-mail</span>
          <input type="email" required maxLength={254} disabled={loadingEmail} autoComplete="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 px-3 font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100" />
        </label>
        <button type="submit" disabled={loadingEmail || savingEmail} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-black text-white hover:bg-blue-700 disabled:opacity-50"><Save size={17} />{savingEmail ? 'Salvando...' : 'Salvar e-mail'}</button>
      </form>

      <form onSubmit={savePassword} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-800"><KeyRound size={20} /></div>
          <div>
            <h2 className="text-lg font-black text-slate-950">Alterar senha</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">A senha atual é obrigatória para confirmar a alteração.</p>
          </div>
        </div>
        {passwordError && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"><AlertTriangle size={17} />{passwordError}</div>}
        <div className="mt-5 space-y-4">
          <label className="block space-y-2"><span className="text-sm font-black text-slate-700">Senha atual</span><input type={showPasswords ? 'text' : 'password'} required maxLength={PASSWORD_MAX_LENGTH} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 px-3 font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
          <label className="block space-y-2"><span className="text-sm font-black text-slate-700">Nova senha</span><input type={showPasswords ? 'text' : 'password'} required maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 px-3 font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
          <PasswordRequirements password={newPassword} />
          <label className="block space-y-2"><span className="text-sm font-black text-slate-700">Confirmar nova senha</span><input type={showPasswords ? 'text' : 'password'} required maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-200 px-3 font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} className="h-4 w-4 accent-blue-600" />{showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}Mostrar senhas</label>
        </div>
        <button type="submit" disabled={savingPassword} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 font-black text-white hover:bg-slate-800 disabled:opacity-50"><KeyRound size={17} />{savingPassword ? 'Alterando...' : 'Alterar senha'}</button>
      </form>
    </div>
  );
}
