import type { PriceSample, StoreAdapter } from '../types.ts';
import { genericSample, pageTitle, parseMoney, scanEmbeddedNumber } from './common.ts';

/**
 * Tiendas que publican schema.org JSON-LD en la ficha de producto. Para todas
 * ellas la cadena generica (JSON-LD -> metaetiquetas) resuelve el precio; aqui
 * solo anadimos el patron de SKU y un ultimo recurso especifico.
 */

const lastPathSegment = (url: URL): string | null => {
  const parts = url.pathname.split('/').filter(Boolean);
  return parts.at(-1)?.replace(/\.html?$/i, '') ?? null;
};

export const pccomponentes: StoreAdapter = {
  id: 'pccomponentes',
  label: 'PcComponentes',
  hosts: ['pccomponentes.com'],
  sku: (url) => lastPathSegment(url),
  canonical: (url) => `${url.origin}${url.pathname}`,
  needsBrowser: true, // Cloudflare
  parse: (html) =>
    genericSample(html) ??
    fromEmbedded(html, ['salesPrice', 'currentPrice', 'finalPrice', 'price']),
};

export const mediamarkt: StoreAdapter = {
  id: 'mediamarkt',
  label: 'MediaMarkt',
  hosts: ['mediamarkt.es'],
  // .../product/_apple-iphone-15-1234567.html  -> 1234567
  sku: (url) => url.pathname.match(/-(\d{5,9})\.html/)?.[1] ?? lastPathSegment(url),
  canonical: (url) => `${url.origin}${url.pathname}`,
  parse: (html) =>
    genericSample(html) ?? fromEmbedded(html, ['price', 'currentPrice', 'endPrice']),
};

export const carrefour: StoreAdapter = {
  id: 'carrefour',
  label: 'Carrefour',
  hosts: ['carrefour.es'],
  // .../nombre-producto/R-VC4AECOM123456/p
  sku: (url) => url.pathname.match(/\/(R-[A-Za-z0-9_]+)/)?.[1] ?? lastPathSegment(url),
  canonical: (url) => `${url.origin}${url.pathname}`,
  needsBrowser: true, // Cloudflare
  parse: (html) =>
    genericSample(html) ?? fromEmbedded(html, ['activePrice', 'price', 'currentPrice']),
};

export const elcorteingles: StoreAdapter = {
  id: 'elcorteingles',
  label: 'El Corte Ingles',
  hosts: ['elcorteingles.es'],
  // .../electronica/A12345678-nombre-del-producto/
  sku: (url) => url.pathname.match(/\/(A\d{5,12})[-/]/i)?.[1] ?? lastPathSegment(url),
  canonical: (url) => `${url.origin}${url.pathname}`,
  parse: (html) =>
    genericSample(html) ?? fromEmbedded(html, ['final_price', 'price', 'current_price']),
};

export const fnac: StoreAdapter = {
  id: 'fnac',
  label: 'Fnac',
  hosts: ['fnac.es'],
  sku: (url) => url.pathname.match(/\/a(\d{4,10})/i)?.[1] ?? lastPathSegment(url),
  canonical: (url) => `${url.origin}${url.pathname}`,
  needsBrowser: true, // DataDome
  parse: (html) => genericSample(html) ?? fromEmbedded(html, ['price', 'sellingPrice']),
};

/** Ultimo recurso: rebuscar en los JSON que la SPA deja incrustados. */
function fromEmbedded(html: string, keys: string[]): PriceSample | null {
  const price = scanEmbeddedNumber(html, keys) ?? parseMoney(html.match(/>\s*([\d.]+,\d{2})\s*€/)?.[1]);
  if (price == null) return null;
  return { price, currency: 'EUR', inStock: true, title: pageTitle(html) };
}
