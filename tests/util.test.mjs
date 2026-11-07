import test from 'node:test';
import assert from 'node:assert/strict';
import { lcg, lcgNext, LCG_RANGE } from '../app/core/util/rng.js';
import { clamp, lerp, dist } from '../app/core/util/math.js';
import { escapeHtml, foldDiacritics, searchKey } from '../app/core/util/text.js';

test('lcg matches the inline LCG the engine and draft have always used', () => {
  let state = 12345;
  const random = lcg(12345);
  for (let i = 0; i < 1000; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    assert.equal(random(), state / 4294967296);
  }
  assert.equal(lcgNext(0), 1013904223);
  assert.equal(LCG_RANGE, 2 ** 32);
  // Seeds are coerced to uint32 exactly like `(seed ^ salt) >>> 0`.
  assert.equal(lcg(-1)(), lcgNext(0xffffffff) / LCG_RANGE);
});

test('math helpers', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('text helpers escape HTML and fold diacritics for search', () => {
  assert.equal(
    escapeHtml(`<a href="x">Tom & 'Jerry'</a>`),
    '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
  );
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(foldDiacritics('Kylian Mbappé Lottin'), 'Kylian Mbappe Lottin');
  assert.equal(searchKey('Ødegaard ÁLVAREZ Çalhanoğlu'), 'ødegaard alvarez calhanoglu');
  assert.equal(searchKey(undefined), '');
});
