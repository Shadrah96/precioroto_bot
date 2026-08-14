import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StoreHistory } from '../types.ts';
import { stats } from './detect.ts';
import { appendPoint } from './storage.ts';

// node --test src/core/storage.test.ts

const NOW = 1_800_000_000;
const HOUR = 3600;

const fresh = (): StoreHistory => ({ version: 1, items: {} });
const points = (h: StoreHistory) => h.items['t:1'].points;

/** Simula scans cada `everyMin` minutos durante `hours` horas al mismo precio. */
function run(hours: number, priceEur: number, everyMin = 30): StoreHistory {
  const h = fresh();
  const step = everyMin * 60;
  for (let t = NOW - hours * HOUR; t <= NOW; t += step) {
    appendPoint(h, 't:1', 'Cosa', priceEur, t);
  }
  return h;
}

describe('appendPoint', () => {
  it('no guarda un punto por cada scan cuando el precio no se mueve', () => {
    // 48 scans en 24h no pueden dejar 48 puntos identicos en el fichero.
    assert.ok(points(run(24, 100)).length < 10);
  });

  it('pero el historico SIGUE creciendo con el precio quieto', () => {
    // Este es el fallo que hubo: al refrescar la marca de tiempo del ultimo
    // punto, el umbral de 6h no se alcanzaba nunca y el contador se quedaba
    // clavado en 1, de modo que la regla del historico no llegaba a activarse.
    const dia = run(24, 100);
    assert.ok(points(dia).length >= 4, `esperaba >=4 puntos en 24h, hubo ${points(dia).length}`);

    const semana = run(24 * 7, 100);
    assert.ok(points(semana).length > points(dia).length);
  });

  it('deja el historico listo para la regla del historico en menos de 2 dias', () => {
    const s = stats(points(run(36, 100)), NOW);
    assert.ok(s);
    assert.ok(s.samples >= 6, `esperaba >=6 lecturas, hubo ${s.samples}`);
    assert.ok(s.spanHours >= 12);
    assert.equal(s.reference, 100);
  });

  it('anota al instante cualquier cambio de precio', () => {
    const h = fresh();
    appendPoint(h, 't:1', 'Cosa', 100, NOW);
    appendPoint(h, 't:1', 'Cosa', 99.5, NOW + 60);
    appendPoint(h, 't:1', 'Cosa', 1, NOW + 120);
    assert.deepEqual(
      points(h).map((p) => p[1]),
      [10_000, 9950, 100],
    );
  });

  it('guarda los precios en centimos enteros', () => {
    const h = fresh();
    appendPoint(h, 't:1', 'Cosa', 19.99, NOW);
    assert.deepEqual(points(h), [[NOW, 1999]]);
  });

  it('poda lo que se sale de la ventana pero conserva las ultimas lecturas', () => {
    const h = run(24 * 200, 100, 60 * 12); // 200 dias, HISTORY_DAYS son 90
    const oldest = points(h)[0][0];
    assert.ok(oldest >= NOW - 91 * 24 * HOUR, 'deberia haber podado lo viejo');
    assert.ok(points(h).length >= 4);
  });

  it('actualiza el titulo sin perder el historico', () => {
    const h = fresh();
    appendPoint(h, 't:1', 'Nombre viejo', 100, NOW);
    appendPoint(h, 't:1', 'Nombre nuevo', 50, NOW + HOUR);
    assert.equal(h.items['t:1'].title, 'Nombre nuevo');
    assert.equal(points(h).length, 2);
  });
});
