import { eur } from '../config.ts';
import type { StoreId, WatchItem } from '../types.ts';
import { fetchPrice, resolveItem } from '../stores/index.ts';
import {
  appendPoint,
  loadHistory,
  loadWatchlist,
  saveHistory,
  saveWatchlist,
} from './storage.ts';

/** Alta de productos en la lista de vigilancia. Lo usan `add` y `discover`. */

export interface EnrollOptions {
  /** Descarta lo que cueste menos de esto. Un chollo de 4 EUR no compensa el aviso. */
  minPrice?: number;
  /** Fuerza el titulo en vez de usar el de la tienda (solo tiene sentido con una URL). */
  title?: string;
}

export interface EnrollReport {
  total: number;
  added: number;
  duplicated: number;
  unsupported: number;
  failed: number;
  tooCheap: number;
}

export async function addUrls(
  rawUrls: string[],
  opts: EnrollOptions = {},
): Promise<EnrollReport> {
  const watchlist = await loadWatchlist();
  const known = new Set(watchlist.map((i) => i.id));

  const report: EnrollReport = {
    total: rawUrls.length,
    added: 0,
    duplicated: 0,
    unsupported: 0,
    failed: 0,
    tooCheap: 0,
  };

  type Pending = NonNullable<ReturnType<typeof resolveItem>>;
  const byStore = new Map<StoreId, Pending[]>();

  for (const raw of rawUrls) {
    const resolved = resolveItem(raw);
    if (!resolved) {
      report.unsupported++;
      console.error(`  ✗ URL no reconocida: ${raw}`);
      continue;
    }
    if (known.has(resolved.id)) {
      report.duplicated++;
      continue;
    }
    known.add(resolved.id); // evita duplicados dentro del propio lote
    byStore.set(resolved.store, [...(byStore.get(resolved.store) ?? []), resolved]);
  }

  const stores = [...byStore.keys()];
  if (stores.length === 0) return report;

  const nowSec = Math.floor(Date.now() / 1000);
  const histories = new Map(
    await Promise.all(stores.map(async (s) => [s, await loadHistory(s)] as const)),
  );
  const fresh: WatchItem[] = [];

  // Las tiendas se recorren en paralelo; dentro de cada una, de una en una.
  await Promise.all(
    stores.map(async (store) => {
      const history = histories.get(store)!;
      for (const resolved of byStore.get(store)!) {
        const outcome = await fetchPrice(resolved);

        if (!outcome.ok) {
          report.failed++;
          console.log(`  ✗ [${store}] ${outcome.reason}: ${outcome.detail}`);
          continue;
        }
        const { price, title } = outcome.sample;
        if (price == null) {
          report.failed++;
          console.log(`  · [${store}] sin precio visible: ${title ?? resolved.url}`);
          continue;
        }
        if (opts.minPrice != null && price < opts.minPrice) {
          report.tooCheap++;
          continue;
        }

        const item: WatchItem = {
          ...resolved,
          title: opts.title ?? title ?? resolved.sku,
          addedAt: new Date().toISOString(),
        };
        fresh.push(item);
        appendPoint(history, item.id, item.title, price, nowSec);
        report.added++;
        console.log(`  ✓ [${store}] ${eur(price).padStart(11)}  ${item.title.slice(0, 68)}`);
      }
    }),
  );

  if (fresh.length > 0) {
    await saveWatchlist([...watchlist, ...fresh]);
    await Promise.all(stores.map((s) => saveHistory(s, histories.get(s)!)));
  }
  return report;
}
