// Shared UI helpers: number formatting (lib/format.js) and team kits (lib/kits.js), and that
// the match/pre-match stores give national sides their kit instead of the generic default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fmt1, fmt2, int, signed1, pct, fmtDate } from '../app/ui/lib/format.js';
import {
  nationKit,
  sideColors,
  kitColors,
  NEUTRAL_KIT,
  NATION_TRIGRAMS,
  nationTrigram,
  teamCode,
} from '../app/ui/lib/kits.js';

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

test('dates: one fixed format whatever the locale, and no locale formatting in the app', () => {
  // A day id is that calendar day as written, in any time zone.
  assert.equal(fmtDate('2026-11-12'), '12 Nov 2026');
  assert.equal(fmtDate('2026-01-01'), '1 Jan 2026');
  assert.equal(fmtDate('2027-12-31'), '31 Dec 2027');
  // A Date, a timestamp or an ISO string: the device's day, or the UTC day.
  const late = new Date(Date.UTC(2026, 10, 12, 23, 30));
  assert.equal(fmtDate(late, { utc: true }), '12 Nov 2026');
  assert.equal(fmtDate(late.getTime(), { utc: true }), '12 Nov 2026');
  assert.equal(fmtDate('2026-11-12T23:30:00.000Z', { utc: true }), '12 Nov 2026');
  assert.equal(fmtDate(new Date(2026, 1, 3, 9, 0)), '3 Feb 2026');
  // Nothing readable: the fallback.
  for (const bad of [null, undefined, '', 'soon', NaN, new Date('x'), '2026-13-01'])
    assert.equal(fmtDate(bad), '–', String(bad));
  assert.equal(fmtDate(null, { fallback: null }), null);
  // The same text under other locales and time zones (the helper never asks the runtime).
  const { TZ, LANG } = process.env;
  for (const [tz, lang] of [
    ['America/Los_Angeles', 'en_US.UTF-8'],
    ['Asia/Tokyo', 'ja_JP.UTF-8'],
    ['Europe/Berlin', 'de_DE.UTF-8'],
  ]) {
    process.env.TZ = tz;
    process.env.LANG = lang;
    assert.equal(fmtDate('2026-11-12'), '12 Nov 2026');
    assert.equal(fmtDate(late, { utc: true }), '12 Nov 2026');
  }
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
  if (LANG === undefined) delete process.env.LANG;
  else process.env.LANG = LANG;
  // No screen formats a date or a number through the locale (vendored code aside).
  const sources = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'vendor') walk(path);
      } else if (entry.name.endsWith('.js')) sources.push(path);
    }
  };
  walk(new URL('../app', import.meta.url).pathname);
  assert.ok(sources.length > 100);
  for (const path of sources) {
    const code = readFileSync(path, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(
      !/toLocale(Date|Time)?String\s*\(|Intl\.(DateTimeFormat|NumberFormat)/.test(code),
      `${path} formats through the locale: use ui/lib/format.js`,
    );
  }
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

test('nation trigrams: real FIFA codes, all distinct', () => {
  assert.equal(nationTrigram('at'), 'AUT');
  assert.equal(nationTrigram('AU'), 'AUS');
  assert.equal(nationTrigram('kr'), 'KOR');
  assert.equal(nationTrigram('gb-eng'), 'ENG');
  assert.equal(nationTrigram(null), null);
  const codes = Object.values(NATION_TRIGRAMS);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(teamCode('Real Madrid'), 'RMA');
});
