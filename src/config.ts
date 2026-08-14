import path from 'node:path';
import { fileURLToPath } from 'node:url';

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Quien esta ejecutando el scan. Sirve para que dos runners (tu PC y GitHub
 * Actions) no escriban nunca el mismo fichero y git pueda fusionar sin conflictos.
 */
export const RUNNER = process.env.RUNNER || (process.env.GITHUB_ACTIONS ? 'cloud' : 'local');

/** Tiendas de las que este runner es responsable. null = todas. */
export const OWNED_STORES: string[] | null = process.env.STORES?.trim()
  ? process.env.STORES.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;

/** Si no somos responsables de una tienda, no tocamos sus ficheros. */
export const ownsStore = (store: string): boolean =>
  OWNED_STORES === null || OWNED_STORES.includes(store);

export const PATHS = {
  watchlist: path.join(ROOT, 'data', 'watchlist.json'),
  history: path.join(ROOT, 'data', 'history'),
  alerts: path.join(ROOT, 'data', 'alerts'),
  lastRun: path.join(ROOT, 'data', `last-run.${RUNNER}.json`),
};

export const CONFIG = {
  historyDays: num('HISTORY_DAYS', 90),
  windowDays: num('WINDOW_DAYS', 60),

  minSamples: num('MIN_SAMPLES', 6),
  minSpanHours: num('MIN_SPAN_HOURS', 12),

  ratioError: num('RATIO_ERROR', 0.2),
  ratioDeal: num('RATIO_DEAL', 0.4),
  crashRatio: num('CRASH_RATIO', 0.25),
  minAbsDrop: num('MIN_ABS_DROP', 10),

  cooldownHours: num('COOLDOWN_HOURS', 24),
  reAlertDrop: num('REALERT_DROP', 0.1),

  requestDelayMs: num('REQUEST_DELAY_MS', 2500),
  timeoutMs: num('TIMEOUT_MS', 20_000),
  maxRetries: num('MAX_RETRIES', 3),

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },
};

export const eur = (n: number): string =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
