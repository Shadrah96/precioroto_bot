import { FetchError } from '../core/errors.ts';
import { fetchHtml } from '../core/http.ts';
import type { StoreId } from '../types.ts';
import { adapterFor } from './index.ts';

/**
 * Rastrea los buscadores de cada tienda para sacar URLs de producto en bloque,
 * y asi no tener que ir pegandolas a mano de una en una.
 *
 * Ojo: no todas las tiendas se dejan. Carrefour devuelve 503 en su buscador de
 * tecnologia y Fnac bloquea con DataDome, asi que aqui solo estan las cuatro
 * que responden.
 */

export const TECH_TERMS = [
  'portatil gaming',
  'movil libre',
  'tablet',
  'auriculares bluetooth',
  'monitor gaming',
  'tarjeta grafica',
  'ssd nvme',
  'smartwatch',
  'televisor 55',
  'teclado mecanico',
  'robot aspirador',
  'altavoz bluetooth',
];

interface Source {
  search: (term: string) => string;
  extract: (html: string) => string[];
}

const matches = (html: string, re: RegExp): string[] =>
  [...html.matchAll(re)].map((m) => m[1]);

const uniq = (xs: string[]): string[] => [...new Set(xs)];

const absolute = (base: string) => (path: string) => new URL(path, base).toString();

/** Secciones de PcComponentes que parecen producto por la URL pero no lo son. */
const PCC_NOT_A_PRODUCT =
  /^\/(buscar|ofertas|outlet|categorias|marcas|blog|ayuda|cuenta|carrito|comparar|listas|black-friday|financiacion|empresas|servicios|tiendas|montaje|garantia|politica|aviso|cookies)/;

const SOURCES: Partial<Record<StoreId, Source>> = {
  mediamarkt: {
    search: (q) => `https://www.mediamarkt.es/es/search.html?query=${encodeURIComponent(q)}`,
    extract: (html) =>
      uniq(matches(html, /href="(\/es\/product\/[^"?#]+\.html)"/g)).map(
        absolute('https://www.mediamarkt.es'),
      ),
  },

  elcorteingles: {
    search: (q) => `https://www.elcorteingles.es/search/?s=${encodeURIComponent(q)}`,
    extract: (html) =>
      uniq(matches(html, /href="(\/[a-z-]+\/A\d{6,12}-[^"?#]{5,150}\/)"/g)).map(
        absolute('https://www.elcorteingles.es'),
      ),
  },

  amazon: {
    search: (q) => `https://www.amazon.es/s?k=${encodeURIComponent(q)}`,
    extract: (html) =>
      uniq(matches(html, /\/dp\/([A-Z0-9]{10})/g)).map((asin) => `https://www.amazon.es/dp/${asin}`),
  },

  pccomponentes: {
    search: (q) => `https://www.pccomponentes.com/buscar/?query=${encodeURIComponent(q)}`,
    extract: (html) =>
      uniq(matches(html, /href="(\/[a-z0-9][a-z0-9-]{24,140})"/g))
        // Las fichas llevan slug largo y con varios guiones; las categorias, no.
        .filter((p) => (p.match(/-/g)?.length ?? 0) >= 4 && !PCC_NOT_A_PRODUCT.test(p))
        .map(absolute('https://www.pccomponentes.com')),
  },
};

export const DISCOVERABLE = Object.keys(SOURCES) as StoreId[];

async function listingHtml(store: StoreId, url: string): Promise<string> {
  const adapter = adapterFor(store);
  try {
    return await fetchHtml(url, {
      headers: adapter.headers,
      useBrowser: adapter.needsBrowser === true,
    });
  } catch (err) {
    // Si nos bloquean con una peticion normal, probamos con navegador.
    if (err instanceof FetchError && err.reason === 'blocked' && !adapter.needsBrowser) {
      return fetchHtml(url, { headers: adapter.headers, useBrowser: true });
    }
    throw err;
  }
}

/** Devuelve hasta `max` URLs de producto de una tienda, repartidas entre los terminos. */
export async function discoverUrls(
  store: StoreId,
  terms: string[],
  max: number,
): Promise<string[]> {
  const source = SOURCES[store];
  if (!source) return [];

  // Repartimos el cupo entre los terminos para no acabar con 30 portatiles.
  const perTerm = Math.max(3, Math.ceil(max / terms.length));
  const found: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    if (found.length >= max) break;
    try {
      const html = await listingHtml(store, source.search(term));
      const urls = source.extract(html);
      let taken = 0;
      for (const url of urls) {
        if (taken >= perTerm || found.length >= max) break;
        if (seen.has(url)) continue;
        seen.add(url);
        found.push(url);
        taken++;
      }
      console.log(`  [${store}] "${term}": ${taken} producto(s) (${urls.length} en la pagina)`);
    } catch (err) {
      const detail = err instanceof FetchError ? `${err.reason}: ${err.message}` : String(err);
      console.log(`  [${store}] "${term}": fallo — ${detail}`);
    }
  }

  return found;
}
