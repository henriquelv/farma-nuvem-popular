import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Tenta pegar as variáveis de ambiente, se existirem
const supabaseUrlEnv = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKeyEnv = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseClient: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient | null => {
  if (supabaseClient) return supabaseClient;

  // Se não tiver no .env, tenta pegar do localStorage (para facilitar o teste no MVP)
  const url = supabaseUrlEnv || localStorage.getItem('supabaseUrl');
  const key = supabaseAnonKeyEnv || localStorage.getItem('supabaseAnonKey');

  if (url && key) {
    supabaseClient = createClient(url, key);
    return supabaseClient;
  }

  return null;
};

export const setSupabaseCredentials = (url: string, key: string) => {
  localStorage.setItem('supabaseUrl', url);
  localStorage.setItem('supabaseAnonKey', key);
  supabaseClient = createClient(url, key);
};

export const clearSupabaseCredentials = () => {
  localStorage.removeItem('supabaseUrl');
  localStorage.removeItem('supabaseAnonKey');
  supabaseClient = null;
};

export const explainSupabaseError = (err: any): string => {
  const msg = String(err?.message || err || '').toLowerCase();
  const raw = String(err?.message || err || '');

  if (msg.includes('project paused') || msg.includes('projeto pausado')) {
    return 'O banco de dados está pausado. Abra o painel do Supabase e clique em "Restore project" para reativar.';
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) {
    return 'Sem conexão com o servidor. Verifique sua internet e se o banco de dados está ativo no Supabase.';
  }
  if (err?.code === '23505' || msg.includes('duplicate key')) {
    return 'Este CPF já está cadastrado para outro paciente.';
  }
  if (msg.includes('bucket not found')) {
    return 'Bucket "documentos" não existe no Supabase. Crie-o no painel de Storage.';
  }
  if (msg.includes('row-level security') || msg.includes('rls')) {
    return 'Permissão negada pelo banco (RLS). Confira as políticas no Supabase.';
  }
  return raw || 'Erro desconhecido. Tente novamente.';
};
