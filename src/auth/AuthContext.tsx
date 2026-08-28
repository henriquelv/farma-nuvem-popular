import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { clearDocumentUrlCache } from '../lib/storage';
import { pharmacyLoginToEmail } from '../lib/pharmacy-login';

export type AppRole = 'admin' | 'atendente';

export type AppProfile = {
  id: string;
  full_name: string;
  role: AppRole;
  active: boolean;
  farmacia_id: string;
  pharmacy_name: string;
  pharmacy_slug: string;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: AppProfile | null;
  loading: boolean;
  profileError: string;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');

  const loadProfile = async (user: User | null) => {
    if (!user) {
      setProfile(null);
      setProfileError('');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase não configurado.');
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, full_name, role, active, farmacia_id')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data || !data.active) {
      setProfile(null);
      setProfileError('Usuário sem perfil ativo. Peça acesso ao administrador.');
      return;
    }
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('farmacias')
      .select('nome, slug, active')
      .eq('id', data.farmacia_id)
      .maybeSingle();
    if (pharmacyError) throw pharmacyError;
    if (!pharmacy?.active) {
      setProfile(null);
      setProfileError('Acesso desta farmácia está inativo. Fale com o suporte.');
      return;
    }
    setProfile({
      ...data,
      pharmacy_name: pharmacy.nome,
      pharmacy_slug: pharmacy.slug,
    } as AppProfile);
    setProfileError('');
  };

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      try {
        await loadProfile(data.session?.user || null);
      } catch {
        setProfile(null);
        setProfileError('Não foi possível validar seu perfil de acesso.');
      } finally {
        if (mounted) setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) clearDocumentUrlCache();
      setLoading(true);
      window.setTimeout(() => {
        void loadProfile(nextSession?.user || null)
          .catch(() => {
            setProfile(null);
            setProfileError('Não foi possível validar seu perfil de acesso.');
          })
          .finally(() => setLoading(false));
      }, 0);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user || null,
    profile,
    loading,
    profileError,
    signIn: async (login, password) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase não configurado.');
      const email = pharmacyLoginToEmail(login);
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },
    signOut: async () => {
      const supabase = getSupabase();
      if (supabase) await supabase.auth.signOut();
      clearDocumentUrlCache();
      setSession(null);
      setProfile(null);
    },
  }), [session, profile, loading, profileError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}
