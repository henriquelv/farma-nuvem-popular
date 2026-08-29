import { createClient } from 'npm:@supabase/supabase-js@2';

const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,49}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_MESSAGE = 'Se os dados estiverem cadastrados, o link sera enviado em alguns minutos.';

function response(body: Record<string, unknown>, status: number, origin: string) {
  return Response.json(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    },
  });
}

function normalizeLogin(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] || character));
}

Deno.serve(async (request) => {
  const appOrigin = (Deno.env.get('APP_ORIGIN') || 'https://farma-nuvem-popular.vercel.app').replace(/\/$/, '');
  const requestOrigin = request.headers.get('origin') || '';
  const allowedOrigin = requestOrigin === appOrigin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(requestOrigin)
    ? requestOrigin
    : appOrigin;

  if (request.method === 'OPTIONS') return response({}, 200, allowedOrigin);
  if (request.method !== 'POST' || (requestOrigin && requestOrigin !== allowedOrigin)) {
    return response({ error: 'Requisicao nao permitida.' }, 405, allowedOrigin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const brevoApiKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('EMAIL_FROM_ADDRESS');
  const senderName = Deno.env.get('EMAIL_FROM_NAME') || 'Farma Nuvem';
  const rateLimitSecret = Deno.env.get('RECOVERY_RATE_LIMIT_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !brevoApiKey || !senderEmail || !rateLimitSecret) {
    return response({ error: 'Recuperacao temporariamente indisponivel.' }, 503, allowedOrigin);
  }

  let input: { login?: unknown; email?: unknown };
  try {
    input = await request.json();
  } catch {
    return response({ error: 'Dados invalidos.' }, 400, allowedOrigin);
  }

  const login = normalizeLogin(input.login);
  const recoveryEmail = normalizeEmail(input.email);
  if (!LOGIN_PATTERN.test(login) || recoveryEmail.length > 254 || !EMAIL_PATTERN.test(recoveryEmail)) {
    return response({ message: GENERIC_MESSAGE }, 200, allowedOrigin);
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const [identityHash, sourceHash] = await Promise.all([
    sha256(`${rateLimitSecret}:identity:${login}:${recoveryEmail}`),
    sha256(`${rateLimitSecret}:source:${forwardedFor}`),
  ]);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: allowed, error: limitError } = await admin.rpc('consume_password_recovery_attempt', {
    requested_identity_hash: identityHash,
    requested_source_hash: sourceHash,
  });
  if (limitError) return response({ error: 'Nao foi possivel processar a solicitacao.' }, 503, allowedOrigin);
  if (!allowed) return response({ error: 'Muitas solicitacoes. Aguarde 15 minutos.' }, 429, allowedOrigin);

  const startedAt = Date.now();
  const { data: pharmacy } = await admin
    .from('farmacias')
    .select('id, nome, recovery_email')
    .eq('slug', login)
    .eq('active', true)
    .maybeSingle();

  const storedRecoveryEmail = normalizeEmail(pharmacy?.recovery_email);
  if (!pharmacy || storedRecoveryEmail !== recoveryEmail) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 450 - (Date.now() - startedAt))));
    return response({ message: GENERIC_MESSAGE }, 200, allowedOrigin);
  }

  const { data: profile } = await admin
    .from('user_profiles')
    .select('id')
    .eq('farmacia_id', pharmacy.id)
    .eq('role', 'admin')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (!profile) return response({ message: GENERIC_MESSAGE }, 200, allowedOrigin);

  const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
  if (!authUser.user?.email) return response({ message: GENERIC_MESSAGE }, 200, allowedOrigin);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: authUser.user.email,
    options: { redirectTo: `${appOrigin}/nova-senha` },
  });
  const actionLink = linkData.properties?.action_link;
  if (linkError || !actionLink) return response({ error: 'Nao foi possivel gerar o link seguro.' }, 503, allowedOrigin);

  const safePharmacyName = escapeHtml(pharmacy.nome || 'Farmacia');
  const sendResult = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: storedRecoveryEmail }],
      subject: 'Recuperacao de senha - Farma Nuvem',
      htmlContent: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:28px"><h1 style="font-size:22px;margin:0 0 16px">Crie uma nova senha</h1><p style="line-height:1.6">Recebemos uma solicitacao de recuperacao para <strong>${safePharmacyName}</strong>.</p><p style="margin:24px 0"><a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold;padding:13px 18px;border-radius:7px">Alterar minha senha</a></p><p style="font-size:13px;line-height:1.6;color:#64748b">Se voce nao solicitou esta alteracao, ignore esta mensagem. O link e temporario e pode ser usado uma unica vez.</p></div></div></body></html>`,
      textContent: `Recuperacao de senha - ${pharmacy.nome}\n\nAbra o link temporario para criar uma nova senha:\n${actionLink}\n\nSe voce nao solicitou esta alteracao, ignore esta mensagem.`,
      tags: ['password-recovery'],
    }),
  });

  if (!sendResult.ok) {
    console.error('Email provider rejected password recovery request', sendResult.status);
    return response({ error: 'Nao foi possivel enviar o e-mail agora.' }, 503, allowedOrigin);
  }

  return response({ message: GENERIC_MESSAGE }, 200, allowedOrigin);
});
