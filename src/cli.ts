import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG, eur } from './config.ts';
import type { StoreId, WatchItem } from './types.ts';
import { ADAPTERS, adapterFor, fetchPrice, resolveItem } from './stores/index.ts';
import { DISCOVERABLE, TECH_TERMS, discoverUrls } from './stores/discover.ts';
import { closeBrowser } from './core/browser.ts';
import { stats } from './core/detect.ts';
import { type EnrollReport, addUrls } from './core/enroll.ts';
import { scan } from './core/scan.ts';
import { sendTelegram, setBotAvatar, telegramConfigured } from './core/notify.ts';
import { loadHistory, loadWatchlist, saveWatchlist } from './core/storage.ts';

const USAGE = `
chollos — cazador de errores de precio

  npm run add -- <url> [<url>...]   Anade productos a la lista de vigilancia
  npm run discover                  Rastrea las tiendas y anade tecnologia en bloque
  npm run list                      Muestra la lista de vigilancia
  npm run rm -- <id|url>            Quita un producto
  npm run check -- <url>            Lee el precio de una URL sin guardar nada
  npm run scan [-- --dry -v]        Revisa todo y avisa (esto es lo que corre el cron)
  npm run report                    Precio actual vs precio normal de cada producto
  npm run test-telegram             Comprueba que los avisos llegan al movil
  npm run avatar -- <imagen>        Cambia la foto de perfil del bot

Opciones de scan:
  --dry            No escribe historico ni envia avisos
  --only <t1,t2>   Solo estas tiendas: ${ADAPTERS.map((a) => a.id).join(', ')}
                   (tambien por variable de entorno STORES)
  --limit <n>      Solo los n primeros productos
  -v, --verbose    Imprime tambien los productos sin novedad

Opciones de discover:
  --limit <n>      Productos por tienda (por defecto 30)
  --min-price <n>  Descarta lo que cueste menos de N euros (por defecto 60)
  --only <tienda>  Solo una tienda: ${DISCOVERABLE.join(', ')}
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dry: { type: 'boolean', default: false },
      only: { type: 'string' },
      limit: { type: 'string' },
      'min-price': { type: 'string' },
      verbose: { type: 'boolean', short: 'v', default: false },
      title: { type: 'string' },
    },
  });

  const [command, ...args] = positionals;

  switch (command) {
    case 'scan': {
      // --only admite varias tiendas separadas por comas, para poder repartirlas
      // entre el runner de casa y el de GitHub Actions.
      const only = parseStores(values.only ?? process.env.STORES);
      if (only === null) return 1;

      const summary = await scan({
        dry: values.dry,
        only,
        limit: values.limit ? Number(values.limit) : undefined,
        verbose: values.verbose,
      });
      // Si TODO fallo, salimos con error para que el cron lo marque en rojo.
      return summary.checked > 0 && summary.ok === 0 ? 1 : 0;
    }

    case 'add':
      return add(args, values.title);

    case 'discover': {
      const only = values.only as StoreId | undefined;
      return discover({
        only,
        limit: values.limit ? Number(values.limit) : 30,
        minPrice: values['min-price'] ? Number(values['min-price']) : 60,
      });
    }

    case 'list':
      return list();

    case 'rm':
      return remove(args);

    case 'check':
      return check(args);

    case 'report':
      return report();

    case 'avatar': {
      const file = args[0];
      if (!file) {
        console.error('Uso: npm run avatar -- <ruta de la imagen>');
        console.error('Cuadrada, mejor 512x512 o mas. Formatos: png, jpg.');
        return 1;
      }
      const bytes = await readFile(file);
      await setBotAvatar(new Blob([bytes]), basename(file));
      console.log(`Foto de perfil actualizada (${Math.round(bytes.length / 1024)} KB).`);
      console.log('En Telegram puede tardar un minuto en refrescarse.');
      return 0;
    }

    case 'test-telegram': {
      if (!telegramConfigured()) {
        console.error(
          'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.\nCopia .env.example a .env y rellenalos (el README explica como sacarlos).',
        );
        return 1;
      }
      await sendTelegram(
        '✅ <b>Precio Roto</b> conectado.\nA partir de ahora te aviso aqui cuando detecte un error de precio.',
      );
      console.log('Enviado. Miralo en Telegram.');
      return 0;
    }

    default:
      console.log(USAGE.trim());
      return command ? 1 : 0;
  }
}

/** "amazon,mediamarkt" -> ['amazon','mediamarkt']. undefined = todas. null = error. */
function parseStores(raw: string | undefined): StoreId[] | undefined | null {
  if (!raw || !raw.trim()) return undefined;
  const wanted = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const unknown = wanted.filter((s) => !ADAPTERS.some((a) => a.id === s));
  if (unknown.length > 0) {
    console.error(`Tienda desconocida: ${unknown.join(', ')}`);
    console.error(`Disponibles: ${ADAPTERS.map((a) => a.id).join(', ')}`);
    return null;
  }
  return wanted as StoreId[];
}

// ---------------------------------------------------------------- comandos

async function add(urls: string[], titleOverride?: string): Promise<number> {
  if (urls.length === 0) {
    console.error('Uso: npm run add -- <url del producto>');
    console.error(`Tiendas soportadas: ${ADAPTERS.map((a) => a.label).join(', ')}`);
    return 1;
  }
  const report = await addUrls(urls, { title: titleOverride });
  console.log(`\n${summarize(report)}`);
  console.log(`Total vigilado: ${(await loadWatchlist()).length}`);
  return report.added > 0 ? 0 : 1;
}

/** Rastrea los buscadores de las tiendas y da de alta lo que encuentre. */
async function discover(opts: {
  only?: StoreId;
  limit: number;
  minPrice: number;
}): Promise<number> {
  const stores = opts.only ? [opts.only] : DISCOVERABLE;
  const unsupported = opts.only && !DISCOVERABLE.includes(opts.only);

  if (unsupported) {
    console.error(
      `De ${opts.only} no se puede rastrear el buscador. Disponibles: ${DISCOVERABLE.join(', ')}`,
    );
    return 1;
  }

  console.log(
    `Buscando tecnologia en ${stores.length} tienda(s): ${TECH_TERMS.length} busquedas por tienda, hasta ${opts.limit} productos de cada una.\n`,
  );

  const found = await Promise.all(stores.map((s) => discoverUrls(s, TECH_TERMS, opts.limit)));
  const urls = found.flat();

  if (urls.length === 0) {
    console.error('\nNo se encontro ninguna URL. ¿Te han bloqueado? Prueba con --only <tienda>.');
    return 1;
  }

  console.log(`\n${urls.length} candidatos. Leyendo precios y descartando lo de menos de ${eur(opts.minPrice)}...\n`);
  const report = await addUrls(urls, { minPrice: opts.minPrice });

  console.log(`\n${summarize(report)}`);
  console.log(`Total vigilado: ${(await loadWatchlist()).length}`);
  return report.added > 0 ? 0 : 1;
}

function summarize(r: EnrollReport): string {
  const parts = [`${r.added} anadido(s) de ${r.total} candidato(s)`];
  if (r.duplicated) parts.push(`${r.duplicated} ya estaban`);
  if (r.tooCheap) parts.push(`${r.tooCheap} demasiado baratos`);
  if (r.failed) parts.push(`${r.failed} ilegibles`);
  if (r.unsupported) parts.push(`${r.unsupported} de tiendas no soportadas`);
  return parts.join(' · ');
}

async function list(): Promise<number> {
  const watchlist = await loadWatchlist();
  if (watchlist.length === 0) {
    console.log('Lista vacia. Anade con: npm run add -- <url>');
    return 0;
  }
  const byStore = new Map<StoreId, WatchItem[]>();
  for (const i of watchlist) byStore.set(i.store, [...(byStore.get(i.store) ?? []), i]);

  for (const [store, xs] of byStore) {
    console.log(`\n${adapterFor(store).label} (${xs.length})`);
    for (const i of xs) {
      console.log(`  ${i.paused ? '[pausado] ' : ''}${i.id}  ${i.title.slice(0, 70)}`);
    }
  }
  console.log(`\nTotal: ${watchlist.length}`);
  return 0;
}

async function remove(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error('Uso: npm run rm -- <id o url>');
    return 1;
  }
  const targets = new Set(args.map((a) => resolveItem(a)?.id ?? a));
  const watchlist = await loadWatchlist();
  const kept = watchlist.filter((i) => !targets.has(i.id));
  const removed = watchlist.length - kept.length;

  if (removed === 0) {
    console.error('Nada que quitar (¿id correcto? mira `npm run list`)');
    return 1;
  }
  await saveWatchlist(kept);
  console.log(`Quitado(s) ${removed}. El historico se conserva por si lo vuelves a anadir.`);
  return 0;
}

async function check(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error('Uso: npm run check -- <url>');
    return 1;
  }
  let failures = 0;
  for (const url of args) {
    const resolved = resolveItem(url);
    if (!resolved) {
      console.error(`✗ URL no reconocida: ${url}`);
      failures++;
      continue;
    }
    const outcome = await fetchPrice(resolved);
    if (!outcome.ok) {
      console.error(`✗ [${resolved.store}] ${outcome.reason}: ${outcome.detail}`);
      failures++;
      continue;
    }
    const { price, inStock, title } = outcome.sample;
    console.log(
      `✓ [${resolved.store}] ${price != null ? eur(price) : 'sin precio'}${inStock ? '' : ' (agotado)'} — ${title ?? resolved.sku}`,
    );
  }
  return failures > 0 ? 1 : 0;
}

async function report(): Promise<number> {
  const watchlist = await loadWatchlist();
  const nowSec = Math.floor(Date.now() / 1000);
  const stores = [...new Set(watchlist.map((i) => i.store))];
  const histories = new Map(
    await Promise.all(stores.map(async (s) => [s, await loadHistory(s)] as const)),
  );

  const rows = watchlist
    .map((item) => {
      const points = histories.get(item.store)?.items[item.id]?.points ?? [];
      const last = points.at(-1);
      const st = stats(points.slice(0, -1), nowSec);
      const price = last ? last[1] / 100 : null;
      const ratio = price != null && st ? price / st.reference : null;
      return { item, price, st, ratio, samples: points.length };
    })
    .sort((a, b) => (a.ratio ?? 9) - (b.ratio ?? 9));

  console.log('estado  actual      normal      dto   lecturas  producto');
  for (const r of rows) {
    const flag =
      r.ratio == null ? '  ·   ' : r.ratio <= CONFIG.ratioError ? ' 🚨   ' : r.ratio <= CONFIG.ratioDeal ? ' 🔥   ' : '  ·   ';
    const cur = (r.price != null ? eur(r.price) : '—').padStart(10);
    const ref = (r.st ? eur(r.st.reference) : '—').padStart(10);
    const dto = (r.ratio != null ? `${Math.round((1 - r.ratio) * 100)}%` : '—').padStart(6);
    console.log(
      `${flag}${cur}  ${ref}  ${dto}  ${String(r.samples).padStart(8)}  ${r.item.title.slice(0, 60)}`,
    );
  }
  console.log(`\n${rows.length} producto(s). El "normal" es la mediana de los ultimos ${CONFIG.windowDays} dias.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(closeBrowser);
