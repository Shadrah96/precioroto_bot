import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG, PATHS } from '../config.ts';
import type { AlertState, Point, StoreHistory, StoreId, WatchItem } from '../types.ts';

/** Todo el estado vive en ficheros JSON dentro de data/ para que GitHub Actions
 *  pueda commitearlo. Los precios se guardan en centimos para que el diff sea corto. */

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`No se pudo leer ${file}: ${(err as Error).message}`);
  }
}

async function writeJson(file: string, data: unknown, pretty = true): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data));
  await fs.rename(tmp, file);
}

// ---------------------------------------------------------------- watchlist

export const loadWatchlist = (): Promise<WatchItem[]> => readJson<WatchItem[]>(PATHS.watchlist, []);

export const saveWatchlist = (items: WatchItem[]): Promise<void> =>
  writeJson(
    PATHS.watchlist,
    [...items].sort((a, b) => a.id.localeCompare(b.id)),
  );

// ---------------------------------------------------------------- historico

const historyFile = (store: StoreId) => path.join(PATHS.history, `${store}.json`);

export const loadHistory = (store: StoreId): Promise<StoreHistory> =>
  readJson<StoreHistory>(historyFile(store), { version: 1, items: {} });

export async function saveHistory(store: StoreId, history: StoreHistory): Promise<void> {
  // Escribimos con los puntos en una linea por producto: legible y con diffs limpios.
  const body = Object.keys(history.items)
    .sort()
    .map((id) => {
      const entry = history.items[id];
      return `    ${JSON.stringify(id)}: { "title": ${JSON.stringify(entry.title)}, "points": ${JSON.stringify(entry.points)} }`;
    })
    .join(',\n');
  const text = `{\n  "version": 1,\n  "items": {\n${body}\n  }\n}\n`;
  await fs.mkdir(PATHS.history, { recursive: true });
  const file = historyFile(store);
  await fs.writeFile(`${file}.tmp`, text);
  await fs.rename(`${file}.tmp`, file);
}

export const toCents = (eur: number): number => Math.round(eur * 100);
export const toEur = (cents: number): number => cents / 100;

/** Anade un punto y poda lo que se salga de HISTORY_DAYS. */
export function appendPoint(
  history: StoreHistory,
  id: string,
  title: string,
  priceEur: number,
  nowSec: number,
): void {
  const entry = (history.items[id] ??= { title, points: [] });
  if (title) entry.title = title;

  const last = entry.points.at(-1);
  const cents = toCents(priceEur);

  // Un cambio de precio se anota siempre. Si el precio sigue igual basta con
  // dejar constancia cada 6h: asi el fichero no crece con 48 puntos identicos
  // al dia, pero el historico sigue ganando lecturas y ganando antiguedad.
  //
  // Ojo: la comparacion tiene que ser contra el punto guardado, no contra una
  // marca de tiempo que se refresque, o el umbral de 6h no se alcanza nunca.
  const priceChanged = !last || last[1] !== cents;
  if (priceChanged || nowSec - last[0] >= 6 * 3600) {
    entry.points.push([nowSec, cents]);
  }

  const cutoff = nowSec - CONFIG.historyDays * 86_400;
  if (entry.points.length > 4 && entry.points[0][0] < cutoff) {
    entry.points = entry.points.filter((p, i) => p[0] >= cutoff || i >= entry.points.length - 4);
  }
}

export const pointsInWindow = (points: Point[], nowSec: number, days: number): Point[] =>
  points.filter(([t]) => t >= nowSec - days * 86_400);

// ---------------------------------------------------------------- avisos

// Un fichero de avisos por tienda, igual que el historico: asi dos runners que
// se reparten las tiendas nunca tocan el mismo fichero.
const alertFile = (store: StoreId) => path.join(PATHS.alerts, `${store}.json`);

export const loadAlertState = (store: StoreId): Promise<AlertState> =>
  readJson<AlertState>(alertFile(store), {});

export const saveAlertState = (store: StoreId, s: AlertState): Promise<void> =>
  writeJson(alertFile(store), s);

export interface RunSummary {
  at: string;
  checked: number;
  ok: number;
  alerts: number;
  failures: Record<string, number>;
}
export const saveRunSummary = (s: RunSummary): Promise<void> => writeJson(PATHS.lastRun, s);
