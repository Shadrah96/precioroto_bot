import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTitle, parseMoney, sampleFromJsonLd } from './common.ts';

// node --test src/stores/common.test.ts

describe('parseMoney', () => {
  it('lee el formato espanol', () => {
    assert.equal(parseMoney('19,99 €'), 19.99);
    assert.equal(parseMoney('1.234,56 €'), 1234.56);
    assert.equal(parseMoney('&nbsp;1.299,00&nbsp;€'), 1299);
  });

  it('lee el formato anglosajon', () => {
    assert.equal(parseMoney('1,234.56'), 1234.56);
    assert.equal(parseMoney('19.99'), 19.99);
    assert.equal(parseMoney(125.99), 125.99);
  });

  it('trata 1.234 como mil doscientos treinta y cuatro', () => {
    assert.equal(parseMoney('1.234'), 1234);
  });

  it('rechaza lo que no es un precio', () => {
    for (const bad of [null, undefined, '', 'gratis', '0', '-5', {}, '99999999']) {
      assert.equal(parseMoney(bad), null, `deberia rechazar ${JSON.stringify(bad)}`);
    }
  });
});

describe('cleanTitle', () => {
  it('quita el nombre de la tienda del final', () => {
    assert.equal(cleanTitle('SSD 1TB | PcComponentes.com'), 'SSD 1TB');
    assert.equal(cleanTitle('Auriculares - Fnac'), 'Auriculares - Fnac'); // guion simple: se respeta
  });

  it('no destroza un titulo que no lleva sufijo', () => {
    assert.equal(cleanTitle('Apple AirPods Pro 3 - Blanco'), 'Apple AirPods Pro 3 - Blanco');
  });
});

describe('sampleFromJsonLd', () => {
  const page = (ld: unknown) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`;

  it('extrae precio y disponibilidad de un Product', () => {
    const s = sampleFromJsonLd(
      page({
        '@type': 'Product',
        name: 'Cosa',
        offers: {
          '@type': 'Offer',
          price: '19.99',
          priceCurrency: 'EUR',
          availability: 'https://schema.org/InStock',
        },
      }),
    );
    assert.deepEqual(s, { price: 19.99, currency: 'EUR', inStock: true, title: 'Cosa' });
  });

  it('marca agotado lo que schema.org dice que esta agotado', () => {
    const s = sampleFromJsonLd(
      page({
        '@type': 'Product',
        name: 'Cosa',
        offers: { price: 19.99, availability: 'https://schema.org/OutOfStock' },
      }),
    );
    assert.equal(s?.inStock, false);
  });

  it('se maneja con @graph y elige la oferta mas barata disponible', () => {
    const s = sampleFromJsonLd(
      page({
        '@graph': [
          { '@type': 'WebPage' },
          {
            '@type': 'Product',
            name: 'Cosa',
            offers: [
              { price: 30, availability: 'InStock' },
              { price: 25, availability: 'InStock' },
            ],
          },
        ],
      }),
    );
    assert.equal(s?.price, 25);
  });

  it('devuelve null si la pagina no lleva Product', () => {
    assert.equal(sampleFromJsonLd(page({ '@type': 'Organization' })), null);
    assert.equal(sampleFromJsonLd('<html>sin json-ld</html>'), null);
  });

  it('no revienta con JSON-LD corrupto', () => {
    assert.equal(
      sampleFromJsonLd('<script type="application/ld+json">{roto,,}</script>'),
      null,
    );
  });
});
