import { CONFIG } from '../config.ts';
import { FetchError } from './errors.ts';

/**
 * Modo navegador, para las tiendas que no se pueden leer con una peticion HTTP
 * normal (Cloudflare en PcComponentes/Carrefour, DataDome en Fnac, el anti-bot
 * de Amazon). Playwright es opcional: si no esta instalado, esas tiendas se
 * reportan como "blocked" con una pista, y las demas siguen funcionando.
 *
 *   npm install playwright && npx playwright install chromium
 */

type AnyBrowser = {
  newContext(opts: unknown): Promise<AnyContext>;
  close(): Promise<void>;
};
type AnyContext = {
  addInitScript(fn: () => void): Promise<void>;
  newPage(): Promise<AnyPage>;
  close(): Promise<void>;
};
type AnyPage = {
  route(pattern: string, handler: (route: AnyRoute) => unknown): Promise<void>;
  goto(url: string, opts: unknown): Promise<unknown>;
  title(): Promise<string>;
  content(): Promise<string>;
  waitForTimeout(ms: number): Promise<void>;
};
type AnyRoute = {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
};

const HEAVY = new Set(['image', 'media', 'font']);
const CHALLENGE_TITLES = /just a moment|un momento|attention required|checking your browser|please wait/i;

let browserPromise: Promise<AnyBrowser> | null = null;

export const browserEnabled = (): boolean => process.env.BROWSER !== '0';

async function launch(): Promise<AnyBrowser> {
  let chromium: { launch(opts: unknown): Promise<AnyBrowser> };
  try {
    ({ chromium } = (await import('playwright')) as never);
  } catch {
    throw new FetchError(
      'blocked',
      'esta tienda necesita navegador real; instala con `npm install playwright && npx playwright install chromium`',
    );
  }

  return chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--lang=es-ES',
    ],
  });
}

async function getBrowser(): Promise<AnyBrowser> {
  browserPromise ??= launch().catch((err) => {
    browserPromise = null;
    throw err;
  });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

export async function fetchHtmlWithBrowser(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const browser = await getBrowser();

  const context = await browser.newContext({
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.7', ...headers },
  });

  // Chromium controlado por Playwright se delata con navigator.webdriver.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en'] });
  });

  try {
    const page = await context.newPage();

    // Sin imagenes ni fuentes: la ficha carga en la mitad de tiempo.
    await page.route('**/*', async (route) => {
      if (HEAVY.has(route.request().resourceType())) await route.abort();
      else await route.continue();
    });

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.timeoutMs * 2,
    });

    // Los retos de Cloudflare se resuelven solos en unos segundos; hay que esperarlos.
    for (let i = 0; i < 12; i++) {
      if (!CHALLENGE_TITLES.test(await page.title())) break;
      await page.waitForTimeout(1500);
    }

    const html = await page.content();
    const title = await page.title();

    if (CHALLENGE_TITLES.test(title)) {
      throw new FetchError('blocked', 'el reto anti-bot no se resolvio a tiempo');
    }
    const status = (response as { status?: () => number } | null)?.status?.() ?? 200;
    if (status === 403 || status === 429) {
      throw new FetchError('blocked', `anti-bot en navegador (HTTP ${status})`);
    }
    if (status === 404 || status === 410) {
      throw new FetchError('http', `HTTP ${status} (producto retirado?)`);
    }
    return html;
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw new FetchError('network', err instanceof Error ? err.message : String(err));
  } finally {
    await context.close().catch(() => {});
  }
}
