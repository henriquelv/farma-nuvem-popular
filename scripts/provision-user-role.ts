#!/usr/bin/env tsx
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import * as process from 'node:process';

const args = process.argv.slice(2);
const readValue = (name: string) => {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
};

const email = readValue('--email')?.trim().toLowerCase();
const role = readValue('--role');
const fullName = readValue('--name')?.trim();
const pharmacyId = readValue('--pharmacy-id') || '00000000-0000-4000-8000-000000000001';
const apply = args.includes('--apply');
const confirmation = readValue('--confirm');

if (!email || !['admin', 'atendente'].includes(role || '')) {
  console.error('Use --email usuario@dominio --role admin|atendente [--name "Nome completo"]');
  process.exit(1);
}
if (apply && confirmation !== 'PROVISION_USER_ROLE') {
  console.error('A aplicacao exige --apply --confirm PROVISION_USER_ROLE');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUser() {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  const user = await findUser();
  if (!user) throw new Error('Usuário não encontrado no Supabase Auth. Crie-o primeiro no Dashboard, com e-mail confirmado.');
  const profile = {
    id: user.id,
    farmacia_id: pharmacyId,
    full_name: fullName || String(user.user_metadata?.full_name || email!.split('@')[0]).toUpperCase(),
    role,
    active: true,
  };

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', email, pharmacyId, profile }, null, 2));
  if (!apply) return;
  const { error } = await supabase.from('user_profiles').upsert(profile, { onConflict: 'id' });
  if (error) throw error;
  console.log('Perfil provisionado com sucesso.');
}

main().catch((error) => {
  console.error(`Falha: ${error.message}`);
  process.exit(1);
});
