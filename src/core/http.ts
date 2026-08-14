import { CONFIG } from '../config.ts';
import { browserEnabled, fetchHtmlWithBrowser } from './browser.ts';
import { FetchError } from './errors.ts';

export { FetchError };

/**
 * Descarga HTML siendo educado: una peticion cada vez por dominio, con espera
 * aleatoria entre ellas, User-Agent rotado y reintentos con backoff.
 * Ir despacio es lo que evita que nos bloqueen, asi que no bajes REQUEST_DELAY_MS.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

const CAPTCHA_MARKERS = [
  'validatecaptcha',
  'to discuss automated access',
  'api-services-support@amazon.com',
  'introduce los caracteres',
  'enter the characters you see below',
  'cf-browser-verification',
  'just a moment...',
  'attention required! | cloudflare',
  'px-captcha',
  'are you a robot',
  'akamai reference number',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Cola serie por dominio: nunca dos peticiones simultaneas a la misma tienda. */
const hostChains = new Map<string, Promise<void>>();

function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostChains.get(host) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  hostChains.set(host, prev.then(() => gate));
  return prev.then(fn).finally(release);
}

function looksBlocked(status: number, body: string): boolean {
  const head = body.slice(0, 6000).toLowerCase();
  if (CAPTCHA_MARKERS.some((m) => head.includes(m))) return true;
  // Paginas de bloqueo suelen ser diminutas
  return (status === 403 || status === 503) && body.length < 4000;
}

export interface FetchHtmlOptions {
  headers?: Record<string, string>;
  /** Salta la espera educada (usado en la re-comprobacion de un candidato). */
  noDelay?: boolean;
  /** La tienda exige navegador real (Cloudflare, DataDome...). */
  useBrowser?: boolean;
}

export async function fetchHtml(url: string, opts: FetchHtmlOptions = {}): Promise<string> {
  const host = new URL(url).host;

  if (opts.useBrowser) {
    if (!browserEnabled()) {
      throw new FetchError('blocked', 'esta tienda requiere navegador y BROWSER=0 lo desactiva');
    }
    return withHostLock(host, async () => {
      if (!opts.noDelay) await sleep(CONFIG.requestDelayMs + Math.random() * CONFIG.requestDelayMs);
      return fetchHtmlWithBrowser(url, opts.headers);
    });
  }

  return withHostLock(host, async () => {
    let lastError: FetchError = new FetchError('network', 'sin intentos');

    for (let attempt = 0; attempt < CONFIG.maxRetries; attempt++) {
      if (!opts.noDelay || attempt > 0) {
        const base = CONFIG.requestDelayMs * (attempt === 0 ? 1 : 3 * attempt);
        await sleep(base + Math.random() * CONFIG.requestDelayMs);
      }

      let res: Response;
      let body: string;
      try {
        res = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(CONFIG.timeoutMs),
          headers: {
            'User-Agent': pick(USER_AGENTS),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.6',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            ...opts.headers,
          },
        });
        body = await res.text();
      } catch (err) {
        lastError = new FetchError('network', err instanceof Error ? err.message : String(err));
        continue;
      }

      if (looksBlocked(res.status, body)) {
        lastError = new FetchError('blocked', `anti-bot (HTTP ${res.status})`);
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        // No tiene sentido reintentar: el producto ya no existe.
        throw new FetchError('http', `HTTP ${res.status} (producto retirado?)`);
      }
      if (!res.ok) {
        lastError = new FetchError('http', `HTTP ${res.status}`);
        continue;
      }
      return body;
    }

    throw lastError;
  });
}
