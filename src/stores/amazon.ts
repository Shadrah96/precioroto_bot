import type { PriceSample, StoreAdapter } from '../types.ts';
import { decodeEntities, parseMoney, stripTags } from './common.ts';

/**
 * Amazon no publica JSON-LD, hay que leer el HTML. Es la tienda con mas errores
 * de precio y tambien la que mas agresivamente bloquea. Ver README: desde los
 * runners de GitHub Actions es normal recibir captcha.
 */

const ASIN = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|[?&]asin=)([A-Z0-9]{10})(?:[/?]|$)/i;

/** Bloques donde vive el precio principal, en orden de preferencia. */
const PRICE_BLOCKS = [
  /<div[^>]+id=["']corePriceDisplay_desktop_feature_div["'][\s\S]{0,4000}?<\/div>\s*<\/div>/i,
  /<div[^>]+id=["']corePrice_desktop["'][\s\S]{0,4000}?<\/table>/i,
  /<div[^>]+id=["']corePriceDisplay_mobile_feature_div["'][\s\S]{0,4000}?<\/div>\s*<\/div>/i,
  /<div[^>]+id=["']apex_desktop["'][\s\S]{0,6000}?<\/div>\s*<\/div>/i,
];

const OUT_OF_STOCK = /no disponible temporalmente|actualmente no disponible|currently unavailable/i;

function priceFromBlock(block: string): number | null {
  // El precio accesible viene completo en .a-offscreen ("19,99 €")
  const offscreen = block.match(/<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]{1,40})</i);
  const fromOffscreen = parseMoney(offscreen?.[1]);
  if (fromOffscreen != null) return fromOffscreen;

  // Fallback: entero + decimales partidos en dos spans
  const whole = block.match(/class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\s\S]{0,20}?)</i)?.[1];
  const frac = block.match(/class=["'][^"']*a-price-fraction[^"']*["'][^>]*>([\s\S]{0,10}?)</i)?.[1];
  if (whole) {
    const cleanWhole = decodeEntities(whole).replace(/[^\d.,]/g, '').replace(/[.,]$/, '');
    return parseMoney(`${cleanWhole},${(frac ?? '00').replace(/\D/g, '') || '00'}`);
  }
  return null;
}

function parse(html: string): PriceSample | null {
  const title = stripTags(
    html.match(/<span[^>]+id=["']productTitle["'][^>]*>([\s\S]{0,400}?)<\/span>/i)?.[1] ?? '',
  );

  let price: number | null = null;
  for (const re of PRICE_BLOCKS) {
    const block = html.match(re)?.[0];
    if (!block) continue;
    price = priceFromBlock(block);
    if (price != null) break;
  }

  if (price == null) {
    // Payload JS que Amazon inyecta para el widget de compra
    price = parseMoney(html.match(/"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1]);
  }
  if (price == null) {
    for (const id of ['priceblock_ourprice', 'priceblock_dealprice', 'priceblock_saleprice']) {
      const v = html.match(new RegExp(`id=["']${id}["'][^>]*>([^<]{1,40})<`, 'i'))?.[1];
      price = parseMoney(v);
      if (price != null) break;
    }
  }

  if (price == null) {
    return title ? { price: null, currency: 'EUR', inStock: false, title } : null;
  }

  const buyBox = html.match(/id=["']availability["'][\s\S]{0,600}?<\/div>/i)?.[0] ?? '';
  return {
    price,
    currency: 'EUR',
    inStock: !OUT_OF_STOCK.test(buyBox) && !OUT_OF_STOCK.test(html.slice(0, 200_000)),
    title: title || undefined,
  };
}

export const amazon: StoreAdapter = {
  id: 'amazon',
  label: 'Amazon ES',
  hosts: ['amazon.es', 'amzn.to', 'amzn.eu'],
  sku: (url) => url.pathname.match(ASIN)?.[1]?.toUpperCase() ?? url.search.match(ASIN)?.[1] ?? null,
  canonical: (url) => {
    const asin = url.pathname.match(ASIN)?.[1]?.toUpperCase();
    return asin ? `https://www.amazon.es/dp/${asin}` : url.toString();
  },
  headers: {
    'Sec-Fetch-Site': 'same-origin',
    Referer: 'https://www.amazon.es/',
  },
  // Amazon sirve captcha a casi cualquier peticion que no venga de un navegador.
  needsBrowser: true,
  parse,
};
