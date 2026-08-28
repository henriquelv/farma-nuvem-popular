#!/usr/bin/env tsx
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import * as process from 'node:process';
import { normalizePharmacyLogin, pharmacyLoginToEmail } from '../src/lib/pharmacy-login';
import { validatePassword } from '../src/lib/password-security';

const args = process.argv.slice(2);
const CONFIRMATION = 'ROTATE_PHARMACY_LOGIN';
const LEGACY_PHARMACY_ID = '00000000-0000-4000-8000-000000000001';

function readValue(name: string) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

const pharmacyId = readValue('--pharmacy-id') || LEGACY_PHARMACY_ID;
const expectedCurrentLogin = normalizePharmacyLogin(readValue('--current-login') || '');
const newLogin = normalizePharmacyLogin(readValue('--new-login') || '');
const password = readValue('--password') || '';
const apply = args.includes('--apply');
const confirmation = readValue('--confirm');

if (!/^[0-9a-f-]{36}$/i.test(pharmacyId)) {
  console.error('Informe um --pharmacy-id UUID válido.');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(expectedCurrentLogin) || !/^[a-z0-9][a-z0-9._-]{2,49}$/.test(newLogin)) {
  console.error('Informe --current-login e --new-login válidos.');
  process.exit(1);
}
const passwordError = validatePassword(password);
if (passwordError) {
  console.error(passwordError);
  process.exit(1);
}
if (apply && confirmation !== CONFIRMATION) {
  console.error(`A alteração real exige --apply --confirm ${CONFIRMATION}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: pharmacy, error: pharmacyError } = await supabase
    .from('farmacias')
    .select('id, nome, slug')
    .eq('id', pharmacyId)
    .single();
  if (pharmacyError) throw pharmacyError;
  if (pharmacy.slug !== expectedCurrentLogin) {
    throw new Error(`O login atual é "${pharmacy.slug}", diferente da confirmação informada.`);
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, farmacia_id, role, active')
    .eq('farmacia_id', pharmacyId)
    .eq('role', 'admin')
    .eq('active', true)
    .single();
  if (profileError) throw profileError;

  const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(profile.id);
  if (authError || !authUser.user) throw authError || new Error('Conta Auth não encontrada.');

  const newEmail = pharmacyLoginToEmail(newLogin);
  const { data: conflict, error: conflictError } = await supabase
    .from('farmacias')
    .select('id')
    .eq('slug', newLogin)
    .neq('id', pharmacyId)
    .maybeSingle();
  if (conflictError) throw conflictError;
  if (conflict) throw new Error('O novo login já pertence a outra farmácia.');

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    pharmacyId,
    pharmacyName: pharmacy.nome,
    currentLogin: pharmacy.slug,
    newLogin,
    authUserIdPreserved: profile.id,
    password: '[NÃO EXIBIDA]',
  }, null, 2));
  if (!apply) return;

  const { error: slugError } = await supabase.from('farmacias').update({ slug: newLogin }).eq('id', pharmacyId);
  if (slugError) throw slugError;

  const previousMetadata = authUser.user.user_metadata || {};
  const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
    email: newEmail,
    password,
    email_confirm: true,
    user_metadata: { ...previousMetadata, pharmacy_id: pharmacyId, pharmacy_login: newLogin },
  });
  if (updateError) {
    await supabase.from('farmacias').update({ slug: pharmacy.slug }).eq('id', pharmacyId);
    throw updateError;
  }

  console.log(`Login alterado com sucesso para: ${newLogin}`);
}

main().catch((error) => {
  console.error(`Falha: ${error.message}`);
  process.exit(1);
});

