// Shared UI helpers: number formatting (lib/format.js) and team kits (lib/kits.js), and that
// the match/pre-match stores give national sides their kit instead of the generic default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt1, fmt2, int, signed1, pct } from '../app/ui/lib/format.js';
import { nationKit, sideColors, kitColors, NEUTRAL_KIT } from '../app/ui/lib/kits.js';

test('format: fixed "." decimals and "," thousands whatever the locale', () => {
  assert.equal(fmt1(82.24), '82.2');
  assert.equal(fmt1(82), '82.0');
  assert.equal(fmt1('85.25'), '85.3');
  assert.equal(fmt1(null), '–');
  assert.equal(fmt1(undefined, ''), '');
  assert.equal(fmt1(NaN), '–');
  assert.equal(fmt2(0.456), '0.46');
  assert.equal(int(1234.4), '1,234');
  assert.equal(int(1234567), '1,234,567');
  assert.equal(int(-1200), '−1,200');
  assert.equal(int(12), '12');
  assert.equal(signed1(1.24), '+1.2');
  assert.equal(signed1(-0.8), '−0.8');
  assert.equal(signed1(0), '+0.0');
  assert.equal(pct(0.734), '73%');
});

test('kits: nations by flag code, clubs keep their colours, stable fallbacks', () => {
  assert.deepEqual(nationKit('UA'), ['#ffd500', '#005bbb']);
  assert.equal(nationKit(null), null);
  assert.deepEqual(nationKit('zz'), nationKit('zz'));
  assert.deepEqual(sideColors({ color: '#C8102E', secondary: '#FFFFFF' }), ['#C8102E', '#FFFFFF']);
  assert.deepEqual(sideColors({ code: 'fr' }), ['#1b2a5c', '#ffffff']);
  assert.deepEqual(sideColors({}), NEUTRAL_KIT);
  assert.deepEqual(kitColors({ colors: ['#111111', '#eeeeee'] }), ['#111111', '#eeeeee']);
  assert.deepEqual(kitColors({ flagCode: 'br' }), ['#f9d616', '#1d4f9c']);
  assert.deepEqual(kitColors({}, ['#000000', '#ffffff']), ['#000000', '#ffffff']);
});
