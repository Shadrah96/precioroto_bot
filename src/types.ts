export type StoreId =
  | 'amazon'
  | 'pccomponentes'
  | 'mediamarkt'
  | 'carrefour'
  | 'elcorteingles'
  | 'fnac';

/** Un producto vigilado. Vive en data/watchlist.json */
export interface WatchItem {
  /** `${store}:${sku}` — estable aunque la URL cambie de slug */
  id: string;
  store: StoreId;
  url: string;
  sku: string;
  title: string;
  addedAt: string;
  paused?: boolean;
}

/** Lectura puntual del precio de un producto. */
export interface PriceSample {
  /** Euros. null = producto sin precio visible (agotado, retirado...) */
  price: number | null;
  currency: string;
  inStock: boolean;
  title?: string;
}

export type FetchFailure =
  | 'blocked' // captcha / anti-bot
  | 'http' // 4xx / 5xx
  | 'network' // DNS, timeout, reset
  | 'parse'; // la pagina bajo bien pero no supimos leer el precio

export type FetchOutcome =
  | { ok: true; sample: PriceSample }
  | { ok: false; reason: FetchFailure; detail: string };

/** [segundos unix, precio en centimos] — compacto para que el diff en git sea pequeno */
export type Point = [number, number];

export interface StoreHistory {
  version: 1;
  items: Record<string, { title: string; points: Point[] }>;
}

export interface AlertState {
  /** id -> { precio en centimos del ultimo aviso, timestamp unix } */
  [id: string]: { price: number; at: number };
}

export type Tier = 'error' | 'chollo';

export type Verdict =
  | { alert: false; reason: string }
  | {
      alert: true;
      tier: Tier;
      rule: 'historico' | 'desplome';
      /** precio_actual / precio_referencia */
      ratio: number;
      /** precio "normal" con el que comparamos (euros) */
      reference: number;
      samples: number;
    };

export interface StoreAdapter {
  id: StoreId;
  label: string;
  /** hostnames que enruta a este adaptador (sin www.) */
  hosts: string[];
  /** Extrae un identificador estable de producto desde la URL. */
  sku(url: URL): string | null;
  /** Normaliza la URL a su forma canonica y minima. */
  canonical?(url: URL): string;
  /** Cabeceras extra especificas de la tienda. */
  headers?: Record<string, string>;
  /** La tienda tiene anti-bot (Cloudflare, DataDome...) y exige navegador real. */
  needsBrowser?: boolean;
  parse(html: string, url: string): PriceSample | null;
}
