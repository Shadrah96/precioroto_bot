import { CONFIG, eur } from '../config.ts';
import type { StoreId, Verdict } from '../types.ts';
import { adapterFor } from '../stores/index.ts';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const telegramConfigured = (): boolean =>
  Boolean(CONFIG.telegram.token && CONFIG.telegram.chatId);

export async function sendTelegram(html: string): Promise<void> {
  if (!telegramConfigured()) {
    throw new Error(
      'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID (ponlos en .env o en los secrets de GitHub)',
    );
  }
  const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      chat_id: CONFIG.telegram.chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram respondio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** Cambia la foto de perfil del bot. Equivale al /setuserpic de BotFather. */
export async function setBotAvatar(file: Blob, filename: string): Promise<void> {
  if (!CONFIG.telegram.token) throw new Error('Falta TELEGRAM_BOT_TOKEN');

  const form = new FormData();
  form.append('photo', file, filename);

  const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/setMyProfilePhoto`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { ok: boolean; description?: string };
  if (!body.ok) throw new Error(body.description ?? `HTTP ${res.status}`);
}

export interface AlertPayload {
  title: string;
  url: string;
  store: StoreId;
  price: number;
  verdict: Extract<Verdict, { alert: true }>;
}

export function formatAlert(a: AlertPayload): string {
  const { verdict: v } = a;
  const discount = Math.round((1 - v.ratio) * 100);
  const saving = v.reference - a.price;

  const header =
    v.tier === 'error'
      ? '🚨 <b>POSIBLE ERROR DE PRECIO</b>'
      : '🔥 <b>Chollo serio</b>';

  const basis =
    v.rule === 'desplome'
      ? `desplome desde ${eur(v.reference)} en la ultima lectura`
      : `precio normal ${eur(v.reference)} (mediana de ${v.samples} lecturas)`;

  return [
    header,
    '',
    `<b>${escapeHtml(a.title)}</b>`,
    `<b>${eur(a.price)}</b>  ·  −${discount}%  ·  ahorras ${eur(saving)}`,
    `<i>${adapterFor(a.store).label} — ${basis}</i>`,
    '',
    `<a href="${escapeHtml(a.url)}">Abrir producto</a>`,
  ].join('\n');
}

export function formatConsole(a: AlertPayload): string {
  const tag = a.verdict.tier === 'error' ? '[ERROR DE PRECIO]' : '[CHOLLO]';
  const discount = Math.round((1 - a.verdict.ratio) * 100);
  return `${tag} ${a.title}\n  ${eur(a.price)} (normal ${eur(a.verdict.reference)}, −${discount}%, regla: ${a.verdict.rule})\n  ${a.url}`;
}
