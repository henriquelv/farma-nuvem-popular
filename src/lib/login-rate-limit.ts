import { normalizePharmacyLogin } from './pharmacy-login';

const STORAGE_PREFIX = 'farma-login-attempts:';
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FULL_LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type AttemptState = {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
};

const emptyState = (): AttemptState => ({ failures: 0, firstFailureAt: 0, lockedUntil: 0 });

function keyFor(login: string) {
  return `${STORAGE_PREFIX}${normalizePharmacyLogin(login) || 'unknown'}`;
}

function readState(login: string): AttemptState {
  try {
    const raw = window.localStorage.getItem(keyFor(login));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<AttemptState>;
    const state = {
      failures: Number(parsed.failures) || 0,
      firstFailureAt: Number(parsed.firstFailureAt) || 0,
      lockedUntil: Number(parsed.lockedUntil) || 0,
    };
    if (state.firstFailureAt && Date.now() - state.firstFailureAt > FAILURE_WINDOW_MS) {
      window.localStorage.removeItem(keyFor(login));
      return emptyState();
    }
    return state;
  } catch {
    return emptyState();
  }
}

function writeState(login: string, state: AttemptState) {
  try {
    window.localStorage.setItem(keyFor(login), JSON.stringify(state));
  } catch {
    // O rate limit do Supabase continua ativo mesmo quando o armazenamento local não está disponível.
  }
}

export function getLoginLock(login: string) {
  const state = readState(login);
  return {
    failures: state.failures,
    retryAfterMs: Math.max(0, state.lockedUntil - Date.now()),
  };
}

export function recordLoginFailure(login: string, serverRetryAfterMs = 0) {
  const previous = readState(login);
  const failures = previous.failures + 1;
  const progressiveDelay = failures >= MAX_FAILURES
    ? FULL_LOCK_MS
    : failures >= 3
      ? 5_000 * 2 ** (failures - 3)
      : 0;
  const state: AttemptState = {
    failures,
    firstFailureAt: previous.firstFailureAt || Date.now(),
    lockedUntil: Date.now() + Math.max(progressiveDelay, serverRetryAfterMs),
  };
  writeState(login, state);
  return getLoginLock(login);
}

export function clearLoginFailures(login: string) {
  try {
    window.localStorage.removeItem(keyFor(login));
  } catch {
    // Sem ação necessária.
  }
}

export function formatRetryTime(milliseconds: number) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

