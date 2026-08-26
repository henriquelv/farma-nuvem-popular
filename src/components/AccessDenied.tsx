import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export default function AccessDenied() {
  const { profileError, signOut } = useAuth();
  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-5">
      <section className="max-w-md rounded-lg border border-slate-200 bg-white p-7 text-center shadow-sm">
        <LockKeyhole size={34} className="mx-auto text-slate-400" />
        <h1 className="mt-4 text-xl font-black text-slate-900">Acesso não autorizado</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">{profileError || 'Seu perfil não possui permissão para esta área.'}</p>
        <button type="button" onClick={() => void signOut()} className="mt-6 rounded-lg bg-slate-900 px-5 py-3 text-sm font-black text-white">Sair</button>
      </section>
    </main>
  );
}
