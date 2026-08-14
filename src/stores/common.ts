import type { PriceSample } from '../types.ts';

/**
 * Utilidades de extraccion compartidas.
 *
 * Regla de oro: ante la duda, devolver null. Un precio mal leido se convierte en
 * una falsa alarma de "error de precio", que es justo lo que arruina un bot de estos.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&euro;': '€',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|euro);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Acepta "1.234,56 €", "1,234.56", "19,99", 19.99... Devuelve euros o null. */
export function parseMoney(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;

  let s = decodeEntities(raw)
    .replace(/[\s ]/g, '')
    .replace(/eur|euros?|€/gi, '');
  if (!/\d/.test(s)) return null;

  const negative = s.startsWith('-');
  s = s.replace(/[^0-9.,]/g, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // El separador que va mas a la derecha es el decimal
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const decimals = s.length - lastComma - 1;
    s = decimals === 1 || decimals === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const decimals = s.length - lastDot - 1;
    // "1.234" es mil doscientos treinta y cuatro en formato espanol, no 1,234
    if (decimals === 3 && /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || negative) return null;
  // Por encima de esto es casi seguro un numero que no era un precio
  return n > 1_000_000 ? null : n;
}

// ---------------------------------------------------------------- JSON-LD

function flatten(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    out.push(obj);
    if (obj['@graph']) flatten(obj['@graph'], out);
  }
}

export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const text = m[1].trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
    try {
      flatten(JSON.parse(text), out);
    } catch {
      /* JSON-LD roto: siguiente */
    }
  }
  return out;
}

const isType = (node: Record<string, unknown>, ...types: string[]): boolean => {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === 'string' && types.includes(x));
};

function offerPrice(offer: Record<string, unknown>): { price: number | null; inStock: boolean } {
  const price =
    parseMoney(offer.price) ??
    parseMoney((offer.priceSpecification as Record<string, unknown> | undefined)?.price) ??
    parseMoney(offer.lowPrice);

  const availability = String(offer.availability ?? '').toLowerCase();
  const inStock =
    availability === '' ||
    availability.includes('instock') ||
    availability.includes('limitedavailability') ||
    availability.includes('preorder') ||
    availability.includes('onlineonly');

  return { price, inStock };
}

/** Lee el bloque Product de JSON-LD. Es la fuente mas fiable cuando existe. */
export function sampleFromJsonLd(html: string): PriceSample | null {
  const nodes = extractJsonLd(html);
  const product = nodes.find((n) => isType(n, 'Product', 'ProductGroup', 'IndividualProduct'));
  if (!product) return null;

  const rawOffers = product.offers ?? product.hasVariant;
  const offers = (Array.isArray(rawOffers) ? rawOffers : [rawOffers]).filter(
    (o): o is Record<string, unknown> => !!o && typeof o === 'object',
  );

  let best: { price: number; inStock: boolean } | null = null;
  let currency = 'EUR';

  for (const offer of offers) {
    if (isType(offer, 'AggregateOffer') && offer.offers) {
      for (const sub of Array.isArray(offer.offers) ? offer.offers : [offer.offers]) {
        if (sub && typeof sub === 'object') offers.push(sub as Record<string, unknown>);
      }
    }
    const { price, inStock } = offerPrice(offer);
    if (price == null) continue;
    if (typeof offer.priceCurrency === 'string') currency = offer.priceCurrency;
    // Nos quedamos con la oferta mas barata que este disponible
    if (!best || (inStock && !best.inStock) || (inStock === best.inStock && price < best.price)) {
      best = { price, inStock };
    }
  }

  const title =
    typeof product.name === 'string' ? cleanTitle(decodeEntities(product.name)) : undefined;
  if (!best) return title ? { price: null, currency, inStock: false, title } : null;

  return { price: best.price, currency, inStock: best.inStock, title };
}

// ---------------------------------------------------------------- meta / regex

export function metaContent(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${esc}["'][^>]*>`,
      'i',
    );
    const tag = html.match(re)?.[0];
    if (!tag) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return null;
}

/** "PC Epical-Q ... | PcComponentes.com" -> "PC Epical-Q ..." */
const SITE_SUFFIX =
  /\s*[|·–—]\s*[^|·–—]{0,45}(?:\.com|\.es|PcComponentes|MediaMarkt|Carrefour|Fnac|Corte Ingl[eé]s|Amazon)[^|·–—]{0,25}\s*$/i;

export function cleanTitle(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(SITE_SUFFIX, '').trim();
  return cleaned.length >= 3 ? cleaned : raw.trim();
}

export function pageTitle(html: string): string | undefined {
  const og = metaContent(html, 'og:title');
  if (og) return cleanTitle(og);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return t ? cleanTitle(stripTags(t)) : undefined;
}

/** Ultimo recurso comun a casi todas las tiendas: og:price / itemprop price. */
export function sampleFromMeta(html: string): PriceSample | null {
  const price = parseMoney(
    metaContent(html, 'product:price:amount', 'og:price:amount', 'price', 'twitter:data1'),
  );
  if (price == null) return null;
  const currency =
    metaContent(html, 'product:price:currency', 'og:price:currency', 'priceCurrency') ?? 'EUR';
  const availability = (
    metaContent(html, 'product:availability', 'og:availability', 'availability') ?? ''
  ).toLowerCase();
  return {
    price,
    currency,
    inStock: availability === '' || /instock|in stock|en stock|disponible/.test(availability),
    title: pageTitle(html),
  };
}

/** Cadena por defecto: JSON-LD primero, metaetiquetas despues. */
export function genericSample(html: string): PriceSample | null {
  const ld = sampleFromJsonLd(html);
  if (ld?.price != null) return ld;
  const meta = sampleFromMeta(html);
  if (meta?.price != null) return meta;
  return ld ?? meta;
}

/** Busca `"clave": 12.34` dentro de los JSON embebidos de la pagina. */
export function scanEmbeddedNumber(html: string, keys: string[]): number | null {
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"?([0-9]+(?:[.,][0-9]+)?)"?`, 'g');
    const values = [...html.matchAll(re)]
      .map((m) => parseMoney(m[1]))
      .filter((v): v is number => v != null);
    if (values.length === 0) continue;
    // Si la pagina repite el mismo valor, casi seguro es el precio principal.
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    return top[0];
  }
  return null;
}
