import { CONFIG } from '../config.ts';
import type { AlertState, Point, Verdict } from '../types.ts';
import { pointsInWindow, toCents, toEur } from './storage.ts';

/**
 * El corazon del asunto: decidir si un precio es un error.
 *
 * Un error de precio real tiene una firma clara: el producto ha estado meses en
 * una horquilla estable y de repente vale una fraccion de eso. Comparamos contra
 * la MEDIANA de la ventana (no la media: un solo dia de rebajas no la mueve).
 *
 * Dos reglas independientes:
 *   - historico: hay recorrido suficiente y el precio actual se hunde vs la mediana.
 *   - desplome:  aun sin historico largo, la caida respecto a la ultima lectura
 *                es tan bestia que solo puede ser un fallo.
 */

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Stats {
  /** Precio "normal" en euros (mediana de la ventana). */
  reference: number;
  min: number;
  max: number;
  samples: number;
  spanHours: number;
}

/** Estadisticas del historico PREVIO (sin incluir la lectura de ahora). */
export function stats(points: Point[], nowSec: number): Stats | null {
  const window = pointsInWindow(points, nowSec, CONFIG.windowDays);
  if (window.length === 0) return null;
  const prices = window.map(([, c]) => toEur(c));
  return {
    reference: median(prices),
    min: Math.min(...prices),
    max: Math.max(...prices),
    samples: window.length,
    spanHours: (nowSec - window[0][0]) / 3600,
  };
}

export interface EvaluateInput {
  id: string;
  priceEur: number;
  inStock: boolean;
  /** Historico previo, sin la lectura actual. */
  points: Point[];
  nowSec: number;
  alerts: AlertState;
}

export function evaluate(input: EvaluateInput): Verdict {
  const { id, priceEur, inStock, points, nowSec, alerts } = input;

  if (!inStock) return { alert: false, reason: 'agotado' };
  const st = stats(points, nowSec);
  if (!st) return { alert: false, reason: 'primera lectura, sin referencia' };

  const tierFor = (ratio: number) => (ratio <= CONFIG.ratioError ? 'error' : 'chollo') as const;

  // --- Regla 1: desplome respecto a lo ultimo que vimos ---------------------
  // Mediana de las 3 ultimas lecturas, no el maximo: si una lectura salio
  // anomalamente alta, volver al precio de siempre no es ningun chollo.
  const recent = points.slice(-3).map(([, c]) => toEur(c));
  const lastKnown = median(recent);
  const crashRatio = priceEur / lastKnown;

  if (
    recent.length > 0 &&
    crashRatio <= CONFIG.crashRatio &&
    lastKnown - priceEur >= CONFIG.minAbsDrop &&
    // Y ademas tiene que ser barato respecto al precio normal de largo plazo:
    // asi un producto que ya venia rebajado no dispara un segundo aviso.
    priceEur <= st.reference * CONFIG.ratioDeal
  ) {
    return gate({
      alert: true,
      tier: tierFor(crashRatio),
      rule: 'desplome',
      ratio: crashRatio,
      reference: lastKnown,
      samples: st.samples,
    });
  }

  // --- Regla 2: hundimiento respecto al precio normal historico -------------
  if (st.samples < CONFIG.minSamples) {
    return { alert: false, reason: `historico corto (${st.samples}/${CONFIG.minSamples} lecturas)` };
  }
  if (st.spanHours < CONFIG.minSpanHours) {
    return { alert: false, reason: `historico reciente (${st.spanHours.toFixed(0)}h)` };
  }

  const ratio = priceEur / st.reference;
  if (ratio <= CONFIG.ratioDeal && st.reference - priceEur >= CONFIG.minAbsDrop) {
    return gate({
      alert: true,
      tier: tierFor(ratio),
      rule: 'historico',
      ratio,
      reference: st.reference,
      samples: st.samples,
    });
  }

  return { alert: false, reason: `sin caida relevante (${(ratio * 100).toFixed(0)}% del normal)` };

  /** Antirrepeticion: no volver a avisar del mismo producto sin novedad real. */
  function gate(v: Extract<Verdict, { alert: true }>): Verdict {
    const previous = alerts[id];
    if (!previous) return v;

    const hoursSince = (nowSec - previous.at) / 3600;
    if (hoursSince >= CONFIG.cooldownHours) return v;

    const dropSinceAlert = 1 - toCents(priceEur) / previous.price;
    if (dropSinceAlert >= CONFIG.reAlertDrop) return v;

    return { alert: false, reason: `ya avisado hace ${hoursSince.toFixed(1)}h` };
  }
}
