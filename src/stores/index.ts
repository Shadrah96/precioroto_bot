import type { FetchOutcome, StoreAdapter, StoreId, WatchItem } from '../types.ts';
import { FetchError, fetchHtml } from '../core/http.ts';
import { amazon } from './amazon.ts';
import { carrefour, elcorteingles, fnac, mediamarkt, pccomponentes } from './retail.ts';

export const ADAPTERS: StoreAdapter[] = [
  amazon,
  pccomponentes,
  mediamarkt,
  carrefour,
  elcorteingles,
  fnac,
];

const byId = new Map<StoreId, StoreAdapter>(ADAPTERS.map((a) => [a.id, a]));

export function adapterFor(store: StoreId): StoreAdapter {
  const a = byId.get(store);
  if (!a) throw new Error(`Tienda desconocida: ${store}`);
  return a;
}

export function adapterForUrl(rawUrl: string): { adapter: StoreAdapter; url: URL } | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const adapter = ADAPTERS.find((a) => a.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  return adapter ? { adapter, url } : null;
}

/** Construye un WatchItem a partir de una URL pegada por el usuario. */
export function resolveItem(rawUrl: string): Omit<WatchItem, 'title' | 'addedAt'> | null {
  const found = adapterForUrl(rawUrl);
  if (!found) return null;
  const { adapter, url } = found;
  const sku = adapter.sku(url);
  if (!sku) return null;
  return {
    id: `${adapter.id}:${sku}`,
    store: adapter.id,
    sku,
    url: adapter.canonical ? adapter.canonical(url) : url.toString(),
  };
}

export async function fetchPrice(
  item: Pick<WatchItem, 'store' | 'url'>,
  opts: { noDelay?: boolean } = {},
): Promise<FetchOutcome> {
  const adapter = adapterFor(item.store);

  // Las tiendas con anti-bot van directas a navegador. Las demas prueban primero
  // con una peticion normal (mucho mas barata) y solo caen al navegador si las bloquean.
  const first = await attempt(adapter.needsBrowser === true);
  if (first.ok || first.reason !== 'blocked' || adapter.needsBrowser) return first;

  const viaBrowser = await attempt(true);
  return viaBrowser.ok ? viaBrowser : first;

  async function attempt(useBrowser: boolean): Promise<FetchOutcome> {
    try {
      const html = await fetchHtml(item.url, {
        headers: adapter.headers,
        noDelay: opts.noDelay,
        useBrowser,
      });
      const sample = adapter.parse(html, item.url);
      if (!sample) {
        return { ok: false, reason: 'parse', detail: 'no se encontro precio en el HTML' };
      }
      return { ok: true, sample };
    } catch (err) {
      if (err instanceof FetchError) return { ok: false, reason: err.reason, detail: err.message };
      return {
        ok: false,
        reason: 'network',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
