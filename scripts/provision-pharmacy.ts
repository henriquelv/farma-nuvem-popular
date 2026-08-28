#!/usr/bin/env tsx
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import * as process from 'node:process';
import { normalizePharmacyLogin, pharmacyLoginToEmail } from '../src/lib/pharmacy-login';
import { validatePassword } from '../src/lib/password-security';

const args = process.argv.slice(2);
const CONFIRMATION = 'CREATE_PHARMACY_LOGIN';
const LEGACY_PHARMACY_ID = '00000000-0000-4000-8000-000000000001';

function readValue(name: string) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
}

const login = normalizePharmacyLogin(readValue('--login') || '');
const password = readValue('--password') || '';
const pharmacyName = (readValue('--pharmacy-name') || '').trim().replace(/\s+/g, ' ');
const apply = args.includes('--apply');
const legacy = args.includes('--legacy');
const confirmation = readValue('--confirm');

if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(login)) {
  console.error('Use --login com 3 a 50 caracteres: letras, numeros, ponto, hifen ou underline.');
  process.exit(1);
}
if (pharmacyName.length < 3) {
  console.error('Informe --pharmacy-name "NOME DA FARMACIA".');
  process.exit(1);
}
const passwordError = validatePassword(password);
if (passwordError) {
  console.error(passwordError);
  process.exit(1);
}
if (apply && confirmation !== CONFIRMATION) {
  console.error(`A criacao real exige --apply --confirm ${CONFIRMATION}`);
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.');
  process.exit(1);
}

const email = pharmacyLoginToEmail(login);
const pharmacyId = legacy ? LEGACY_PHARMACY_ID : randomUUID();
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findAuthUser() {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    login,
    authEmail: email,
    pharmacyName,
    pharmacyId,
    legacy,
    password: '[NAO EXIBIDA]',
  }, null, 2));
  if (!apply) return;

  if (await findAuthUser()) throw new Error('Este login ja existe. Nenhuma senha foi alterada.');

  const { data: existingPharmacy, error: lookupError } = await supabase
    .from('farmacias')
    .select('id, slug')
    .eq('slug', login)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existingPharmacy && existingPharmacy.id !== pharmacyId) {
    throw new Error('Ja existe uma farmacia com este login.');
  }

  let pharmacyCreated = false;
  let authUserId: string | null = null;
  try {
    const { error: pharmacyError } = await supabase.from('farmacias').upsert({
      id: pharmacyId,
      nome: pharmacyName.toUpperCase(),
      slug: login,
      active: true,
    }, { onConflict: 'id' });
    if (pharmacyError) throw pharmacyError;
    pharmacyCreated = !existingPharmacy && !legacy;

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { pharmacy_id: pharmacyId, pharmacy_login: login },
    });
    if (authError || !authData.user) throw authError || new Error('Supabase nao retornou o usuario criado.');
    authUserId = authData.user.id;

    const { error: profileError } = await supabase.from('user_profiles').insert({
      id: authUserId,
      farmacia_id: pharmacyId,
      full_name: pharmacyName.toUpperCase(),
      role: 'admin',
      active: true,
    });
    if (profileError) throw profileError;

    console.log(`Farmacia criada com sucesso. Login: ${login}`);
  } catch (error) {
    if (authUserId) await supabase.auth.admin.deleteUser(authUserId);
    if (pharmacyCreated) await supabase.from('farmacias').delete().eq('id', pharmacyId);
    throw error;
  }
}

main().catch((error) => {
  console.error(`Falha: ${error.message}`);
  process.exit(1);
});
