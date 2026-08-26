/**
 * @security O bucket "documentos" está público (acesso anônimo).
 * Os arquivos de farmácia contêm CPF, identidade, receitas e dados pessoais.
 * TODO: Migrar para bucket privado + signed URLs em produção.
 * O app atual depende de acesso público para leitura no frontend.
 */
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
  if (msg.includes('patient_has_audit_history')) {
    return 'Este paciente possui histórico fiscal e não pode ser excluído.';
  }
  if (msg.includes('audit_records_are_immutable')) {
    return 'Este registro faz parte do histórico fiscal e não pode ser alterado ou excluído.';
  }
  if (err?.code === '23514' || msg.includes('check constraint')) {
    if (msg.includes('clientes_cpf_valid_check')) return 'CPF inválido. Confira os 11 dígitos informados.';
    if (msg.includes('clientes_nascimento_valid_check')) return 'Data de nascimento inválida ou futura.';
    if (msg.includes('clientes_nome_not_blank_check')) return 'Informe o nome completo do paciente.';
    if (msg.includes('vendas_medicamento_not_blank_check')) return 'Informe o medicamento da compra.';
    if (msg.includes('vendas_documentos_tipo_check')) return 'Tipo de documento inválido. Atualize a página e tente novamente.';
    return 'Os dados informados são inválidos. Confira os campos e tente novamente.';
  }
  if (msg.includes('bucket not found')) {
    return 'Bucket "documentos" não existe no Supabase. Crie-o no painel de Storage.';
  }
  if (msg.includes('row-level security') || msg.includes('rls')) {
    return 'Permissão negada pelo banco (RLS). Confira as políticas no Supabase.';
  }
  return raw || 'Erro desconhecido. Tente novamente.';
};
