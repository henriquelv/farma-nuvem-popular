import process from 'node:process';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const raw = Buffer.concat(chunks).toString('utf8');
const jsonStart = raw.indexOf('{');
if (jsonStart < 0) throw new Error('Supabase query output did not contain JSON.');

const payload = JSON.parse(raw.slice(jsonStart));
const rows = Array.isArray(payload.rows) ? payload.rows : [];

const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/META::\{.*?"NAME":"/g, '')
  .replace(/\.[A-Z0-9]{2,5}$/g, '')
  .replace(/[^A-Z ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const distance = (left, right) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

const fileNameFromMetadata = (value) => {
  const text = String(value || '');
  if (!text.startsWith('META::')) return text;
  try {
    return JSON.parse(text.slice(6)).name || text;
  } catch {
    return text;
  }
};

const findings = [];
for (const row of rows) {
  const registered = normalize(row.nome_completo);
  const registeredTokens = registered.split(' ');
  const originalFile = fileNameFromMetadata(row.nome_arquivo);
  const fileTokens = normalize(originalFile).split(' ').filter(Boolean);
  if (registeredTokens.length < 2 || fileTokens.length < 2) continue;

  let best = null;
  const minLength = Math.max(2, registeredTokens.length - 1);
  const maxLength = Math.min(fileTokens.length, registeredTokens.length + 1);
  for (let size = minLength; size <= maxLength; size += 1) {
    for (let start = 0; start + size <= fileTokens.length; start += 1) {
      const candidate = fileTokens.slice(start, start + size).join(' ');
      const edits = distance(registered, candidate);
      if (!best || edits < best.edits) best = { candidate, edits };
    }
  }

  const sharedTokens = registeredTokens.filter((token) => fileTokens.includes(token)).length;
  const threshold = Math.max(2, Math.ceil(registered.length * 0.12));
  if (best && best.edits > 0 && best.edits <= threshold && sharedTokens >= 1) {
    findings.push({
      id: row.id,
      cpf: row.cpf,
      cadastrado: row.nome_completo,
      arquivo: originalFile,
      trechoArquivo: best.candidate,
      diferenca: best.edits,
    });
  }
}

const unique = [...new Map(findings.map((item) => [
  `${item.id}|${item.trechoArquivo}`,
  item,
])).values()].sort((a, b) => a.cadastrado.localeCompare(b.cadastrado, 'pt-BR'));

process.stdout.write(`${JSON.stringify(unique, null, 2)}\n`);
