import { RUNNER, eur } from '../config.ts';
import type { AlertState, StoreHistory, StoreId, WatchItem } from '../types.ts';
import { fetchPrice } from '../stores/index.ts';
import { evaluate, stats } from './detect.ts';
import {
  type RunSummary,
  appendPoint,
  loadAlertState,
  loadHistory,
  loadWatchlist,
  saveAlertState,
  saveHistory,
  saveRunSummary,
  toCents,
} from './storage.ts';
import { type AlertPayload, formatAlert, formatConsole, sendTelegram, telegramConfigured } from './notify.ts';

export interface ScanOptions {
  dry?: boolean;
  /** Tiendas a revisar. Vacio o ausente = todas. */
  only?: StoreId[];
  limit?: number;
  verbose?: boolean;
}

export async function scan(opts: ScanOptions = {}): Promise<RunSummary> {
  const wanted = opts.only?.length ? new Set(opts.only) : null;
  const all = await loadWatchlist();
  let items = all.filter((i) => !i.paused && (!wanted || wanted.has(i.store)));
  if (opts.limit) items = items.slice(0, opts.limit);

  if (items.length === 0) {
    console.log(
      'La lista de vigilancia esta vacia. Anade productos con:\n  npm run add -- <url del producto>',
    );
    return { at: new Date().toISOString(), checked: 0, ok: 0, alerts: 0, failures: {} };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const stores = [...new Set(items.map((i) => i.store))];
  const histories = new Map<StoreId, StoreHistory>(
    await Promise.all(stores.map(async (s) => [s, await loadHistory(s)] as const)),
  );
  const alertStates = new Map<StoreId, AlertState>(
    await Promise.all(stores.map(async (s) => [s, await loadAlertState(s)] as const)),
  );

  const summary: RunSummary = {
    at: new Date().toISOString(),
    checked: items.length,
    ok: 0,
    alerts: 0,
    failures: {},
  };
  const pending: AlertPayload[] = [];

  console.log(
    `[${RUNNER}] Revisando ${items.length} productos en ${stores.length} tienda(s): ${stores.join(', ')}\n`,
  );

  // Las tiendas van en paralelo; dentro de cada tienda, de una en una (lo impone
  // el candado por dominio de http.ts, pero lo hacemos explicito aqui).
  await Promise.all(
    stores.map(async (store) => {
      const history = histories.get(store)!;
      for (const item of items.filter((i) => i.store === store)) {
        await checkOne(item, history);
      }
    }),
  );

  async function checkOne(item: WatchItem, history: StoreHistory): Promise<void> {
    const outcome = await fetchPrice(item);

    if (!outcome.ok) {
      summary.failures[outcome.reason] = (summary.failures[outcome.reason] ?? 0) + 1;
      console.log(`  ✗ ${label(item)} — ${outcome.reason}: ${outcome.detail}`);
      return;
    }

    const { price, inStock, title } = outcome.sample;

    if (price == null) {
      console.log(`  · ${label(item)} — sin precio (agotado o retirado)`);
      return;
    }
    summary.ok++;

    const alerts = alertStates.get(item.store)!;
    const points = history.items[item.id]?.points ?? [];
    const verdict = evaluate({ id: item.id, priceEur: price, inStock, points, nowSec, alerts });

    if (verdict.alert) {
      // Segunda lectura antes de avisar: mata los falsos positivos por parseo raro
      // o por precio momentaneo de una pagina servida a medias.
      const confirm = await fetchPrice(item);
      const confirmed =
        confirm.ok && confirm.sample.price != null && Math.abs(confirm.sample.price - price) < 0.02;

      if (!confirmed) {
        console.log(
          `  ? ${label(item)} — ${eur(price)} no se confirmo en la segunda lectura, lo ignoro`,
        );
        appendPoint(history, item.id, title ?? item.title, price, nowSec);
        return;
      }

      const payload: AlertPayload = {
        title: title ?? item.title,
        url: item.url,
        store: item.store,
        price,
        verdict,
      };
      pending.push(payload);
      alerts[item.id] = { price: toCents(price), at: nowSec };
      summary.alerts++;
      console.log(`\n${formatConsole(payload)}\n`);
    } else if (opts.verbose) {
      const st = stats(points, nowSec);
      const ref = st ? ` (normal ${eur(st.reference)})` : '';
      console.log(`  ✓ ${label(item)} — ${eur(price)}${ref} · ${verdict.reason}`);
    }

    appendPoint(history, item.id, title ?? item.title, price, nowSec);
  }

  if (!opts.dry) {
    // Solo se escriben ficheros por tienda (y el resumen, que lleva el nombre del
    // runner). watchlist.json no se toca nunca aqui: es lo que permite que dos
    // runners compartan repositorio sin pisarse.
    await Promise.all([...histories].map(([store, h]) => saveHistory(store, h)));
    await Promise.all([...alertStates].map(([store, s]) => saveAlertState(store, s)));
    await saveRunSummary(summary);
  }

  if (pending.length > 0 && !opts.dry) {
    if (telegramConfigured()) {
      for (const a of pending) {
        try {
          await sendTelegram(formatAlert(a));
        } catch (err) {
          console.error(`  ! No se pudo enviar el aviso a Telegram: ${(err as Error).message}`);
        }
      }
    } else {
      console.log('  ! Telegram sin configurar: los avisos solo salen por consola.');
    }
  }

  const failed = Object.entries(summary.failures);
  console.log(
    `\nResumen: ${summary.ok}/${summary.checked} leidos · ${summary.alerts} aviso(s)` +
      (failed.length ? ` · fallos: ${failed.map(([k, v]) => `${k}=${v}`).join(', ')}` : ''),
  );
  if ((summary.failures.blocked ?? 0) > 0) {
    console.log(
      'Bloqueos anti-bot detectados. Sube REQUEST_DELAY_MS o ejecuta esa tienda desde casa (ver README).',
    );
  }

  return summary;
}

const label = (i: WatchItem): string => `${i.store}/${(i.title || i.sku).slice(0, 58)}`;
