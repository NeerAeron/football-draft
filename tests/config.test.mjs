import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CONFIG,
  CONFIG_FIELDS,
  normalizeConfig,
  setRuntimeConfig,
} from '../app/core/config/config.js';
import { clubSquads } from '../app/core/players/club-lineups.js';
import { clubRating } from '../app/core/players/team-ratings.js';
import { overallRating } from '../app/core/players/ratings.js';
import { Match } from '../app/core/sim/engine.js';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
const catalog = loadRuntimeCatalog();
const oldRatings = JSON.parse(
  readFileSync(new URL('./fixtures/ratings-v21.json', import.meta.url)),
);

test('configuration round-trips all fields and rejects invalid tiers, odds and role weights', () => {
  assert.ok(CONFIG_FIELDS.every(f => typeof f.defaultValue === 'number'));
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
  assert.ok(CONFIG_FIELDS.length > 400);
  for (const f of CONFIG_FIELDS.filter(f => typeof f.defaultValue === 'number'))
    assert.ok(
      Math.abs((f.defaultValue - f.min) / f.step - Math.round((f.defaultValue - f.min) / f.step)) <
        1e-7,
      f.path + ' must be editable at its default HTML step',
    );
  for (const change of [
    c => (c.draft.rerolls.pro = 1.5),
    c => (c.draft.leagueTierWeights = { A: 0, B: 0, C: 0, D: 0, F: 0 }),
    c => (c.playerTiers.Star.badgeMinimum = 3.5),
    c => (c.playerTiers.Normal.minimum = 80),
    c => (c.playerTiers.Bench.minimum = 60),
    c => (c.teamTiers.S = 70),
    c => (c.gameplay.shotFrequency = NaN),
    c =>
      (c.ratings.roleWeights.ST = Object.fromEntries(
        Object.keys(c.ratings.roleWeights.ST).map(k => [k, 0]),
      )),
  ]) {
    const c = structuredClone(DEFAULT_CONFIG);
    change(c);
    assert.throws(() => normalizeConfig(c));
  }
});
test('club strength is the median of the best ten retained players, with eighteen default S clubs', () => {
  const clubs = clubSquads(catalog);
  assert.equal(clubs.filter(c => c.tier === 'S').length, 18);
  const club = clubs.find(c => c.players.length > 20),
    ratings = club.players
      .map(p => overallRating(p, false, p.primaryPosition))
      .sort((a, b) => b - a)
      .slice(0, 10);
  assert.equal(club.overall, (ratings[4] + ratings[5]) / 2);
  assert.equal(club.sampleSize, 10);
  const partial = clubRating(club.players.slice(0, 3));
  assert.equal(partial.sampleSize, 3);
});
test('older rating settings are kept as they are; newer keys take the defaults', () => {
  const { topFrom, topLift } = DEFAULT_CONFIG.ratings;
  assert.deepEqual(normalizeConfig({ ratings: oldRatings }).ratings, {
    ...oldRatings,
    topFrom,
    topLift,
  });
});
test('configuration is frozen for the current match and restored with a replay', () => {
  const match = new Match(28),
    speed = match.players[9].baseSpeed(),
    c = structuredClone(DEFAULT_CONFIG);
  c.gameplay.movementSpeed = DEFAULT_CONFIG.gameplay.movementSpeed * 1.1;
  c.badges.boosts.power.power = 8;
  setRuntimeConfig(c);
  try {
    assert.equal(match.players[9].baseSpeed(), speed);
    const next = new Match(28);
    assert.ok(next.players[9].baseSpeed() > speed);
    next.importConfig(match.exportConfig());
    assert.deepEqual(next.tuning, match.tuning);
    assert.ok(next.players.every(p => p.tuning === next.tuning));
    assert.equal(next.players[9].baseSpeed(), speed);
  } finally {
    setRuntimeConfig(DEFAULT_CONFIG);
  }
});
test('unreachable ground passes are not treated as safe receiving options', () => {
  const m = new Match(9);
  m.tuning.gameplay.passSpeed = 0.5;
  assert.equal(m.flightTime(20), Infinity);
  assert.ok(Number.isFinite(m.flightTime(20, true)));
  const p = m.players[6];
  for (const q of m.players) {
    q.x = q.team ? 100 : 30;
    q.y = q.slot % 2 ? 5 : 63;
  }
  p.x = 10;
  p.y = 34;
  m.players[7].x = 30;
  m.players[7].y = 34;
  assert.ok(
    m
      .options(p)
      .every(
        o => o.loft || Number.isFinite(m.flightTime(Math.hypot(o.aim.x - p.x, o.aim.y - p.y))),
      ),
  );
});
