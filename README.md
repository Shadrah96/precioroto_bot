# chollos

Bot que vigila precios en tiendas españolas y te avisa por Telegram cuando algo
se desploma — sobre todo cuando huele a **error de precio** (eso de 199 € puesto
a 1,99 € porque a alguien se le fue una coma).

Funciona solo, es gratis y no necesitas servidor.

```
🚨 POSIBLE ERROR DE PRECIO

Sony WH-1000XM5 Auriculares Bluetooth
19,99 €  ·  −93%  ·  ahorras 280,00 €
MediaMarkt — precio normal 299,99 € (mediana de 47 lecturas)

Abrir producto
```

---

## Cómo detecta un error de precio

No hace falta magia: un error de precio tiene una firma muy clara. El producto
lleva semanas en una horquilla estable y de repente vale una fracción de eso.

El bot guarda el precio de cada producto cada 30 minutos y compara el precio
actual contra la **mediana** de los últimos 60 días. Usa la mediana y no la
media a propósito: unos días de rebajas no la mueven, así que lo que destaca
destaca de verdad.

Salta con dos reglas independientes:

| Regla | Cuándo | Para qué sirve |
|---|---|---|
| **histórico** | precio ≤ 40 % de la mediana, con ≥ 6 lecturas y ≥ 12 h de recorrido | el caso normal |
| **desplome** | precio ≤ 25 % de la última lectura y además barato respecto a la mediana | pillar un error el mismo día, sin esperar a tener histórico |

Y por debajo del **20 %** del precio normal lo etiqueta como `ERROR DE PRECIO`
en vez de `chollo`.

Cuatro salvaguardas contra el spam, que es lo que mata a estos bots:

- **Ahorro mínimo de 10 €.** Un −80 % sobre algo de 3 € no es noticia.
- **Segunda lectura obligatoria.** Antes de avisar vuelve a cargar la página; si
  el precio no se repite, lo descarta como fallo de parseo.
- **Silencio de 24 h** por producto, salvo que el precio baje otro 10 % más.
- **Nada de avisos si está agotado.**

Todo esto se ajusta con variables de entorno (ver [`.env.example`](.env.example)).

---

## Las tiendas, sin adornos

Esto es lo que hay, comprobado contra las webs reales:

| Tienda | Estado | Cómo se lee |
|---|---|---|
| **MediaMarkt** | ✅ funciona siempre | petición HTTP normal |
| **El Corte Inglés** | ✅ funciona siempre | petición HTTP normal |
| **Amazon ES** | ✅ con navegador, desde tu IP | Chromium (Playwright) |
| **PcComponentes** | ✅ con navegador, desde tu IP | Chromium — tienen Cloudflare |
| **Carrefour** | ✅ con navegador, desde tu IP | Chromium — tienen Cloudflare |
| **Fnac** | ❌ bloqueada | DataDome rechaza incluso un navegador real |

Traducción práctica:

- **MediaMarkt y El Corte Inglés** funcionan en cualquier sitio, incluido GitHub Actions.
- **Amazon, PcComponentes y Carrefour** necesitan un navegador de verdad y, además,
  suelen bloquear las IPs de centro de datos. Desde GitHub Actions salen a
  ratos; **desde tu PC de casa van bien**.
- **Fnac** está incluida en el código por si algún día aflojan, pero hoy devuelve
  bloqueo. No cuentes con ella.

Por eso hay dos formas de tenerlo funcionando. Puedes usar una, o las dos.

---

## Opción A — GitHub Actions (0 €, sin tener el PC encendido)

Lo revisa cada 30 minutos en los servidores de GitHub. Gratis e ilimitado en
repositorios públicos.

### 1. Crea el bot de Telegram

1. Abre Telegram y habla con [@BotFather](https://t.me/BotFather).
2. `/newbot`, le pones nombre, y te da un **token** tipo `123456789:AAH...`.
3. Escríbele algo a tu bot recién creado (un simple «hola»). Esto es
   imprescindible: Telegram no deja que un bot escriba primero.
4. Saca tu **chat id** abriendo esta URL en el navegador, con tu token:
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` → busca `"chat":{"id":123456789`.

### 2. Sube el repo a GitHub

```bash
git remote add origin https://github.com/TU_USUARIO/chollos.git
git push -u origin main
```

### 3. Mete los secretos

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Nombre | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | el token de BotFather |
| `TELEGRAM_CHAT_ID` | tu chat id |

En la pestaña **Variables** (al lado de Secrets) puedes ajustar `RATIO_ERROR`,
`MIN_ABS_DROP`, etc. si quieres afinar sin tocar código.

### 4. Ya está

En **Actions → scan → Run workflow** lo lanzas a mano para probar. A partir de
ahí va solo cada media hora y va commiteando el histórico al propio repo.

> Si prefieres que Actions no pierda tiempo con las tiendas que bloquean,
> añade la variable `BROWSER` con valor `0`.

---

## Opción B — Tu PC con Windows (pilla todas las tiendas)

Sale por tu IP doméstica, así que Amazon, PcComponentes y Carrefour te dejan
entrar sin problema. A cambio, necesita el ordenador encendido.

```powershell
npm install
npx playwright install chromium

copy .env.example .env
notepad .env                 # pon el token y el chat id

npm run test-telegram        # ¿llega el mensaje al móvil?

powershell -ExecutionPolicy Bypass -File scripts\instalar-tarea.ps1
```

Eso registra una tarea programada de Windows que ejecuta un scan cada 30
minutos y escribe en `scan.log`.

```powershell
Start-ScheduledTask -TaskName 'Chollos - buscar errores de precio'   # probar ya
Get-Content scan.log -Tail 30                                        # ver qué hizo
powershell -File scripts\instalar-tarea.ps1 -Minutos 15              # cambiar frecuencia
powershell -File scripts\instalar-tarea.ps1 -Desinstalar             # quitarla
```

---

## Opción C — las dos a la vez (lo mejor de cada una)

Tu PC cubre las cinco tiendas cuando está encendido; GitHub cubre las dos que
funcionan desde cualquier IP, las 24 horas. Comparten repositorio, así que
también comparten lista de productos e histórico.

El truco para que no se peleen es **repartirse las tiendas**:

| Runner | Tiendas | Variable |
|---|---|---|
| GitHub Actions | MediaMarkt, El Corte Inglés | `STORES` en *Settings → Variables* |
| Tu PC | Amazon, PcComponentes, Carrefour | `STORES` en `.env` |

Como el histórico y los avisos están partidos **en un fichero por tienda**
(`data/history/amazon.json`, `data/alerts/amazon.json`…), cada runner escribe
solo sus ficheros. Nunca tocan los mismos, así que git los fusiona sin
conflictos y no hay avisos duplicados. El resumen de cada pasada también va
aparte (`last-run.local.json` / `last-run.cloud.json`), y `watchlist.json` no lo
escribe el scan: solo lo tocan `add`, `discover` y `rm`.

### Montarlo

1. Sube el repo a GitHub y pon los secretos (pasos de la Opción A).
2. En **Settings → Variables**, crea `STORES` = `mediamarkt,elcorteingles`.
   (Es el valor por defecto del workflow, así que puedes saltártelo.)
3. En tu `.env` local, descomenta:
   ```
   STORES=amazon,pccomponentes,carrefour
   ```
4. Ya está. `scripts/scan.cmd` detecta que hay un remoto configurado y hace
   `git pull --rebase` antes de cada scan y `git push` después.

> **Importante:** si activas GitHub Actions y *no* pones `STORES` en tu `.env`,
> las dos máquinas vigilarán MediaMarkt y El Corte Inglés, y recibirás cada
> aviso por duplicado.

---

## Uso diario

Lo único que tienes que hacer es ir metiendo productos.

```bash
npm run discover                          # rastrea las tiendas y añade tecnología en bloque
npm run add -- https://www.amazon.es/dp/B0BBR9JFNT
npm run add -- <url1> <url2> <url3>       # varios de golpe

npm run list                              # qué estoy vigilando
npm run report                            # precio actual vs precio normal
npm run rm -- amazon:B0BBR9JFNT           # quitar (el histórico se conserva)

npm run check -- <url>                    # leer un precio sin guardar nada
npm run scan -- --dry --verbose           # ensayo: ni escribe ni avisa
npm run scan -- --only amazon,carrefour   # solo estas tiendas (o variable STORES)
npm test                                  # tests de la lógica de detección
```

`npm run report` te da la foto de golpe:

```
estado  actual      normal      dto   lecturas  producto
 🚨      19,99 €    299,99 €     93%       47   Sony WH-1000XM5
 🔥      89,00 €    179,00 €     50%       52   Logitech MX Master 3S
  ·     144,00 €    144,00 €      0%       48   SanDisk Portable SSD 1TB
```

### Llenar la lista sin pegar URLs a mano

`npm run discover` rastrea los buscadores de las tiendas con una docena de
términos de tecnología (portátil gaming, tarjeta gráfica, smartwatch…), lee el
precio de cada candidato y da de alta lo que supere el mínimo.

```bash
npm run discover                                  # 30 por tienda, descarta lo de menos de 60 €
npm run discover -- --limit 60 --min-price 150    # más productos, y solo cosas caras
npm run discover -- --only amazon --limit 100
```

El filtro de precio importa más de lo que parece: con `MIN_ABS_DROP` en 10 €, un
producto de 15 € no va a avisar nunca por mucho que se desplome. Vigilar cosas
caras es lo que hace que el bot sirva para algo.

Funciona en Amazon, PcComponentes, MediaMarkt y El Corte Inglés. Carrefour
devuelve 503 en su buscador de tecnología y Fnac está bloqueada, así que ahí
tendrás que usar `npm run add` con URLs concretas.

### Cuántos productos puedo vigilar

El cuello de botella es el tiempo, no el dinero. El bot espera ~2,5 s entre
peticiones a la misma tienda para no llamar la atención, pero **las tiendas se
revisan en paralelo entre sí**. Con la ventana de 25 minutos por scan salen unas
**500 URLs por tienda** en el modo HTTP, bastante menos en las que van por
navegador (Chromium tarda más por página). Si te pasas, sube el intervalo del
cron o reparte por tiendas con `--only`.

Cuantos más productos vigiles, más probable es cazar un error. Merece la pena
meter cosas caras: el filtro de 10 € de ahorro mínimo hace que los productos
baratos casi nunca avisen.

---

## Cómo está montado

Node 24 ejecuta TypeScript directamente, así que **no hay paso de compilación**.
La única dependencia es Playwright, y solo para las tiendas con anti-bot.

```
src/
  cli.ts              comandos: add, discover, list, rm, check, scan, report, test-telegram
  config.ts           ajustes (todo sobreescribible por variables de entorno)
  types.ts
  core/
    http.ts           fetch educado: 1 petición a la vez por dominio, UA rotado, reintentos
    browser.ts        Chromium vía Playwright para las tiendas con Cloudflare/DataDome
    detect.ts         ⭐ la lógica de "¿esto es un error de precio?"  (+ detect.test.ts)
    storage.ts        histórico en JSON, precios en céntimos  (+ storage.test.ts)
    enroll.ts         alta de productos: resuelve, lee precio, filtra y guarda
    notify.ts         mensajes de Telegram
    scan.ts           orquestador de una pasada completa
  stores/
    index.ts          registro de tiendas y enrutado por URL
    common.ts         JSON-LD, metaetiquetas, parseo de precios (+ common.test.ts)
    discover.ts       rastreo de los buscadores para dar de alta en bloque
    amazon.ts         Amazon necesita parseo de HTML a mano
    retail.ts         las cinco que publican schema.org
data/
  watchlist.json      qué vigilar (el scan no lo escribe nunca)
  history/*.json      histórico de precios, un fichero por tienda
  alerts/*.json       último aviso de cada producto, un fichero por tienda
  last-run.*.json     resumen de la última pasada, uno por runner
```

### Añadir una tienda nueva

En [`src/stores/retail.ts`](src/stores/retail.ts), si la tienda publica
schema.org (la mayoría lo hacen), son seis líneas:

```ts
export const mitienda: StoreAdapter = {
  id: 'mitienda',
  label: 'Mi Tienda',
  hosts: ['mitienda.es'],
  sku: (url) => url.pathname.match(/-(\d+)\.html/)?.[1] ?? null,
  parse: (html) => genericSample(html),
};
```

Añádela al array de `src/stores/index.ts` y al tipo `StoreId`. Compruébalo con
`npm run check -- <url de un producto>`.

---

## Cuando algo falla

| Mensaje | Qué pasa |
|---|---|
| `blocked` | anti-bot. Sube `REQUEST_DELAY_MS`, o pasa esa tienda al runner de casa. |
| `parse` | la página cargó pero no se encontró el precio: la tienda cambió el HTML. |
| `http: HTTP 404` | el producto ya no existe; quítalo con `npm run rm`. |
| `network` | timeout o caída puntual; se reintenta solo en el siguiente scan. |
| `esta tienda necesita navegador real` | falta `npx playwright install chromium`. |

Que un scan falle no rompe nada: el histórico de lo que sí se leyó se guarda
igualmente, y el siguiente scan reintenta.

---

## Aviso

Esto lee páginas públicas a ritmo humano (una petición cada 2,5 s por tienda),
para uso personal. No lo conviertas en un scraper masivo: además de que te
bloquearán, las condiciones de uso de estas tiendas no lo permiten.

Y lo obvio: que la web ponga 1 € no obliga a nadie a vendértelo a 1 €. Muchos
errores de precio acaban en pedido cancelado.
