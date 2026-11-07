import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CONFIG,
  CONFIG_FIELDS,
  configField,
  normalizeConfig,
  setRuntimeConfig,
  saveConfig,
  loadConfig,
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

test('configuration round-trips all fields and rejects invalid budgets, tiers and role weights', () => {
  // League/club odds are sparse maps (missing = 1): one synthetic field per catalog entry.
  for (const team of catalog.teams)
    assert.equal(configField('draft.clubOverrides.' + team.id).defaultValue, 1, team.name);
  assert.ok(!CONFIG_FIELDS.some(f => f.path.includes('Overrides.')));
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
  assert.ok(CONFIG_FIELDS.length > 400);
  for (const f of CONFIG_FIELDS.filter(f => typeof f.defaultValue === 'number'))
    assert.ok(
      Math.abs((f.defaultValue - f.min) / f.step - Math.round((f.defaultValue - f.min) / f.step)) <
        1e-7,
      f.path + ' must be editable at its default HTML step',
    );
  for (const change of [
    c => (c.draft.budget.superstar = 2.5),
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
  const previous = globalThis.localStorage,
    values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  try {
    const config = structuredClone(DEFAULT_CONFIG);
    config.gameplay.shotFrequency = 1.2;
    saveConfig(config);
    assert.equal(loadConfig().gameplay.shotFrequency, 1.2);
  } finally {
    globalThis.localStorage = previous;
  }
});
test('club strength is the median of the best ten retained players, with twelve default S clubs', () => {
  const clubs = clubSquads(catalog);
  assert.equal(clubs.filter(c => c.tier === 'S').length, 12);
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
test('legacy draw defaults upgrade once, preserving custom odds and all other settings', () => {
  const legacy = structuredClone(DEFAULT_CONFIG);
  legacy.draft.clubDoubleEvery = 6;
  legacy.draft.leagueWeights = { A: 32, B: 10, C: 3, D: 0.8, F: 0.2 };
  legacy.gameplay.shotFrequency = 1.3;
  legacy.draft.clubOverrides['9'] = 2;
  const upgraded = normalizeConfig(legacy);
  assert.deepEqual(upgraded.draft.clubDoubleEvery, { A: 5, B: 3.5, C: 2.5 });
  assert.deepEqual(upgraded.draft.leagueWeights, DEFAULT_CONFIG.draft.leagueWeights);
  assert.equal(upgraded.gameplay.shotFrequency, 1.3);
  assert.equal(upgraded.draft.clubOverrides['9'], 2);
  legacy.draft.clubDoubleEvery = 8;
  legacy.draft.leagueWeights.A = 40;
  assert.deepEqual(normalizeConfig(legacy).draft.clubDoubleEvery, { A: 8, B: 8, C: 8 });
  assert.deepEqual(normalizeConfig(legacy).draft.leagueWeights, legacy.draft.leagueWeights);
  upgraded.draft.clubDoubleEvery = { A: 6, B: 6, C: 6 };
  upgraded.draft.leagueWeights = { A: 32, B: 10, C: 3, D: 0.8, F: 0.2 };
  assert.deepEqual(normalizeConfig(upgraded), upgraded);
});
test('saved defaults adopt Superstar85 and lower A-league odds once, preserving subsequent edits', () => {
  const old = structuredClone(DEFAULT_CONFIG);
  old._settingsVersion = 1;
  old.playerTiers.Superstar.minimum = 83;
  old.draft.leagueWeights = { A: 39, B: 11, C: 3, D: 0.8, F: 0.2 };
  old.draft.clubOverrides['9'] = 2;
  const previous = globalThis.localStorage,
    values = new Map([['football-draft-settings-v1', JSON.stringify(old)]]);
  globalThis.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  try {
    const updated = loadConfig();
    assert.equal(updated.playerTiers.Superstar.minimum, 85);
    assert.deepEqual(updated.draft.leagueWeights, DEFAULT_CONFIG.draft.leagueWeights);
    assert.equal(updated.draft.clubOverrides['9'], 2);
    updated.playerTiers.Superstar.minimum = 83;
    updated.draft.leagueWeights = { A: 36, B: 10.5, C: 3, D: 0.8, F: 0.2 };
    saveConfig(updated);
    assert.deepEqual(loadConfig(), updated);
  } finally {
    globalThis.localStorage = previous;
  }
});
test('unchanged saved role weights and name timings upgrade while custom settings and replay weights survive', () => {
  const old = structuredClone(DEFAULT_CONFIG);
  old._settingsVersion = 1;
  old.ratings = structuredClone(oldRatings);
  old.display.receiptLabelDuration = 2.5;
  delete old.display.receiptLabelHold;
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify(old) };
  try {
    const next = loadConfig();
    assert.deepEqual(next.ratings.roleWeights, DEFAULT_CONFIG.ratings.roleWeights);
    assert.deepEqual(next.ratings.roleOffsets, DEFAULT_CONFIG.ratings.roleOffsets);
    assert.equal(next.display.receiptLabelDuration, 1.25);
    assert.equal(next.display.receiptLabelHold, 0.5);
    old.ratings.roleWeights.RM.crossing = 9;
    old.ratings.roleOffsets.RM = 2.75;
    old.display.receiptLabelDuration = 3;
    old.draft.leagueWeights.A = 42;
    const custom = loadConfig();
    assert.deepEqual(custom.ratings.roleWeights.RM, old.ratings.roleWeights.RM);
    assert.equal(custom.ratings.roleOffsets.RM, 2.75);
    assert.equal(custom.display.receiptLabelDuration, 3);
    assert.equal(custom.draft.leagueWeights.A, 42);
    assert.deepEqual(normalizeConfig({ ratings: oldRatings }).ratings, oldRatings);
  } finally {
    globalThis.localStorage = previous;
  }
});
test('previous saved defaults migrate to upper-tier maximums while retaining other settings', () => {
  const legacy = structuredClone(DEFAULT_CONFIG);
  legacy.draft.budget = { superstar: 2, star: 5, lower: 4, allowDowngrades: false };
  legacy.gameplay.shotFrequency = 1.3;
  const upgraded = normalizeConfig(legacy);
  assert.deepEqual(upgraded.draft.budget, DEFAULT_CONFIG.draft.budget);
  assert.equal(upgraded.gameplay.shotFrequency, 1.3);
  legacy.draft.budget = { superstar: 1, star: 4, lower: 6, allowDowngrades: true };
  assert.deepEqual(normalizeConfig(legacy).draft.budget, { superstar: 1, star: 4, starter: 3 });
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
test('Impossible upgrades the old 82 default to 84 while preserving customized settings and replays', () => {
  const saved = structuredClone(DEFAULT_CONFIG);
  saved._settingsVersion = 2;
  saved.ai.impossibleOverall = 82;
  const previous = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem: () => JSON.stringify(saved) };
    assert.equal(loadConfig().ai.impossibleOverall, 84);
    assert.equal(normalizeConfig(saved).ai.impossibleOverall, 82);
    saved.ai.impossibleOverall = 86;
    assert.equal(loadConfig().ai.impossibleOverall, 86);
    saved._settingsVersion = 3;
    saved.ai.impossibleOverall = 82;
    assert.equal(loadConfig().ai.impossibleOverall, 82);
  } finally {
    globalThis.localStorage = previous;
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
test('saved movement defaults upgrade without changing custom values or replay physics', () => {
  const saved = structuredClone(DEFAULT_CONFIG);
  saved.display.commentaryInterval = 3.5;
  delete saved.display.receiptLabelDuration;
  Object.assign(saved.gameplay, {
    movementSpeed: 1.03,
    acceleration: 1.03,
    shotFrequency: 1.12,
    passSpeed: 1.15,
  });
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify(saved) };
  try {
    const next = loadConfig();
    assert.equal(next.gameplay.movementSpeed, 1.28);
    assert.equal(next.gameplay.acceleration, 1.1);
    assert.equal(next.gameplay.shotFrequency, DEFAULT_CONFIG.gameplay.shotFrequency);
    assert.equal(next.gameplay.passSpeed, 1.15);
    saved.gameplay.movementSpeed = 1.4;
    assert.equal(loadConfig().gameplay.movementSpeed, 1.4);
    saved.gameplay.passSpeed = 1;
    assert.equal(loadConfig().gameplay.passSpeed, 1.08);
    assert.equal(normalizeConfig(saved).gameplay.shotFrequency, 1.12);
  } finally {
    globalThis.localStorage = previous;
  }
});
