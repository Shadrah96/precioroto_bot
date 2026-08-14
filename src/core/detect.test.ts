import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Point } from '../types.ts';
import { evaluate, median, stats } from './detect.ts';

// node --test src/core/detect.test.ts

const NOW = 1_800_000_000;
const DAY = 86_400;

/** Historico sintetico: `days` lecturas diarias al mismo precio. */
const flat = (priceEur: number, days: number): Point[] =>
  Array.from({ length: days }, (_, i) => [NOW - (days - i) * DAY, Math.round(priceEur * 100)]);

const run = (points: Point[], priceEur: number, extra: Partial<Parameters<typeof evaluate>[0]> = {}) =>
  evaluate({ id: 'test:1', priceEur, inStock: true, points, nowSec: NOW, alerts: {}, ...extra });

describe('median', () => {
  it('usa el valor central y no se deja arrastrar por un extremo', () => {
    assert.equal(median([10, 20, 30]), 20);
    assert.equal(median([10, 20, 30, 1000]), 25);
  });
});

describe('stats', () => {
  it('resume el historico dentro de la ventana', () => {
    const s = stats(flat(200, 30), NOW);
    assert.ok(s);
    assert.equal(s.reference, 200);
    assert.equal(s.samples, 30);
    assert.ok(s.spanHours > 24 * 29);
  });

  it('devuelve null sin historico', () => {
    assert.equal(stats([], NOW), null);
  });
});

describe('evaluate', () => {
  it('canta un error de precio: 199,99 EUR estable que aparece a 1 EUR', () => {
    const v = run(flat(199.99, 30), 1);
    assert.equal(v.alert, true);
    assert.equal(v.tier, 'error');
    assert.ok(v.ratio < 0.01);
  });

  it('marca chollo (no error) una rebaja fuerte pero creible', () => {
    const v = run(flat(200, 30), 70); // -65%
    assert.equal(v.alert, true);
    assert.equal(v.tier, 'chollo');
  });

  it('ignora una rebaja normal de temporada', () => {
    assert.equal(run(flat(200, 30), 150).alert, false);
  });

  it('ignora caidas grandes en porcentaje pero ridiculas en euros', () => {
    assert.equal(run(flat(12, 30), 4).alert, false); // -67%, pero solo 8 EUR de ahorro
  });

  it('no avisa si el producto esta agotado', () => {
    assert.equal(run(flat(200, 30), 1, { inStock: false }).alert, false);
  });

  it('no avisa en la primera lectura, sin referencia', () => {
    assert.equal(run([], 1).alert, false);
  });

  it('detecta un desplome aunque el historico sea corto', () => {
    const v = run(flat(300, 2), 9);
    assert.equal(v.alert, true);
    assert.equal(v.rule, 'desplome');
  });

  it('no confunde con error un precio que siempre fue bajo', () => {
    // El producto lleva 30 dias a 5 EUR: 5 EUR no es noticia.
    assert.equal(run(flat(5, 30), 5).alert, false);
  });

  it('un pico puntual al alza no convierte el precio normal en chollo', () => {
    // 29 lecturas a 100 y una a 1000: la mediana sigue siendo 100.
    const points = [...flat(100, 29), [NOW - DAY, 100_000] as Point];
    assert.equal(run(points, 95).alert, false);
  });

  it('respeta el silencio tras un aviso reciente', () => {
    const alerts = { 'test:1': { price: 100, at: NOW - 3600 } }; // aviso hace 1h a 1 EUR
    assert.equal(run(flat(199.99, 30), 1, { alerts }).alert, false);
  });

  it('vuelve a avisar si el precio baja aun mas tras el aviso', () => {
    const alerts = { 'test:1': { price: 100, at: NOW - 3600 } }; // aviso a 1,00 EUR
    assert.equal(run(flat(199.99, 30), 0.5, { alerts }).alert, true);
  });
});
