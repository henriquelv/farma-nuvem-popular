export const normalizeSearchText = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9\s]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const editDistance = (left: string, right: string) => {
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
};

const tokenTolerance = (token: string) => {
  if (token.length <= 4) return 0;
  if (token.length <= 8) return 1;
  return 2;
};

export const searchMatchScore = (value: unknown, query: unknown) => {
  const target = normalizeSearchText(value);
  const term = normalizeSearchText(query);
  if (!term) return 0;
  if (!target) return Number.POSITIVE_INFINITY;
  if (target === term) return 0;
  if (target.startsWith(term)) return 1;
  if (term.length < 2) return Number.POSITIVE_INFINITY;
  if (target.includes(term)) return 2;

  const targetTokens = target.split(' ');
  const queryTokens = term.split(' ');
  let totalDistance = 0;
  const tokenMatch = queryTokens.every((queryToken) => {
    const nearest = Math.min(...targetTokens.map((targetToken) => editDistance(targetToken, queryToken)));
    totalDistance += nearest;
    return nearest <= tokenTolerance(queryToken);
  });
  if (tokenMatch) return 3 + totalDistance;

  const fullDistance = editDistance(target, term);
  const fullTolerance = Math.max(1, Math.floor(term.length * 0.08));
  return fullDistance <= fullTolerance ? 20 + fullDistance : Number.POSITIVE_INFINITY;
};

export const matchesSearchText = (value: unknown, query: unknown) => Number.isFinite(searchMatchScore(value, query));
