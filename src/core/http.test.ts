import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { looksBlocked } from './http.ts';

// node --test src/core/http.test.ts

describe('looksBlocked', () => {
  it('trata cualquier 403 como anti-bot', () => {
    // Este es el caso que fallo en produccion: MediaMarkt devuelve un 403 con
    // una pagina larga y de aspecto normal. Al no reconocerlo como bloqueo, se
    // gastaban los 3 reintentos y nunca se probaba con navegador.
    assert.equal(looksBlocked(403, '<html>'.padEnd(50_000, 'x')), true);
    assert.equal(looksBlocked(403, ''), true);
    assert.equal(looksBlocked(429, 'slow down'), true);
  });

  it('reconoce las paginas de reto por su contenido', () => {
    assert.equal(looksBlocked(200, '<title>Just a moment...</title>'), true);
    assert.equal(looksBlocked(200, 'Please enable JS ... px-captcha ...'), true);
    assert.equal(looksBlocked(200, 'to discuss automated access'), true);
  });

  it('no confunde un 503 de sobrecarga con un bloqueo', () => {
    assert.equal(looksBlocked(503, 'Service Unavailable'.padEnd(20_000, ' ')), false);
    assert.equal(looksBlocked(503, 'Service Unavailable'), true); // corto: pagina de bloqueo
  });

  it('deja pasar una respuesta normal', () => {
    assert.equal(looksBlocked(200, '<html><body>Precio: 19,99 €</body></html>'), false);
    assert.equal(looksBlocked(404, 'Not found'), false);
    assert.equal(looksBlocked(500, 'Internal Server Error'), false);
  });
});
