import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  CONFIG,
  normalizeConfig,
  loadConfig,
  saveConfig,
  setRuntimeConfig,
  configDiff,
  configField,
} from '../app/core/config/config.js';

const KEY = 'football-draft-settings-v1';
const memory = (initial = null) => {
  const values = new Map(initial === null ? [] : [[KEY, JSON.stringify(initial)]]);
  return {
    values,
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    stored: () => JSON.parse(values.get(KEY)),
  };
};
const collect = () => {
  const messages = [];
  const warn = (...args) => messages.push(args.join(' '));
  return { messages, warn };
};

test('saving stores only the differences from the defaults', () => {
  const storage = memory(),
    config = structuredClone(DEFAULT_CONFIG);
  config.gameplay.shotFrequency = 1.2;
  config.draft.rerolls.pro = 3;
  config.draft.ladder.pro = DEFAULT_CONFIG.draft.ladder.pro; // a default value is not stored
  const saved = saveConfig(config, { storage });
  assert.deepEqual(storage.stored(), {
    gameplay: { shotFrequency: 1.2 },
    draft: { rerolls: { pro: 3 } },
    _settingsVersion: 9,
  });
  assert.deepEqual(loadConfig({ storage }), saved);
  assert.deepEqual(configDiff(DEFAULT_CONFIG), {});
  saveConfig(DEFAULT_CONFIG, { storage });
  assert.deepEqual(storage.stored(), { _settingsVersion: 9 });
});

test('an invalid saved value is dropped with a warning; the rest is kept', () => {
  const storage = memory({
      _settingsVersion: 9,
      gameplay: { shotFrequency: 'fast', shotPower: 1.1 },
      playerTiers: { Star: { minimum: 300 } },
      // amateur: a difficulty that no longer exists is ignored without a warning.
      draft: { rerolls: { pro: 1.5, legendary: 3, worldclass: -1, amateur: 3 } },
      removedSetting: { anything: 1 },
    }),
    { messages, warn } = collect(),
    config = loadConfig({ storage, warn });
  assert.equal(config.gameplay.shotFrequency, DEFAULT_CONFIG.gameplay.shotFrequency);
  assert.equal(config.gameplay.shotPower, 1.1);
  assert.equal(config.playerTiers.Star.minimum, DEFAULT_CONFIG.playerTiers.Star.minimum);
  assert.equal(config.draft.rerolls.pro, 2);
  assert.equal(config.draft.rerolls.legendary, 3);
  assert.equal('amateur' in config.draft.rerolls, false);
  assert.equal(config.draft.rerolls.worldclass, 1);
  assert.equal(messages.length, 4, messages.join('\n'));
  assert.ok(messages.some(m => m.includes('gameplay.shotFrequency')));
  // Strict normalisation (the config page, imports) still rejects the same values.
  assert.throws(() => normalizeConfig({ gameplay: { shotFrequency: 'fast' } }));
  assert.throws(() => normalizeConfig({ draft: { rerolls: { pro: -1 } } }));
});

test('a broken cross-field rule resets only its group', () => {
  const storage = memory({
      _settingsVersion: 9,
      teamTiers: { S: 70 }, // below A: thresholds no longer descend
      draft: { links: { club: { level1: 9 } } }, // above level 2
      gameplay: { shotPower: 1.1 },
      playerTiers: { Superstar: { minimum: 86 } },
    }),
    { messages, warn } = collect(),
    config = loadConfig({ storage, warn });
  assert.deepEqual(config.teamTiers, DEFAULT_CONFIG.teamTiers);
  assert.deepEqual(config.draft.links, DEFAULT_CONFIG.draft.links);
  assert.equal(config.gameplay.shotPower, 1.1);
  assert.equal(config.playerTiers.Superstar.minimum, 86);
  assert.equal(messages.length, 2);
});

test('unreadable or failing storage falls back without throwing', () => {
  const { messages, warn } = collect();
  const broken = {
    getItem: () => {
      throw Error('SecurityError');
    },
    setItem: () => {
      throw Error('QuotaExceededError');
    },
  };
  assert.deepEqual(loadConfig({ storage: broken, warn }), DEFAULT_CONFIG);
  const config = structuredClone(DEFAULT_CONFIG);
  config.gameplay.shotPower = 1.1;
  assert.equal(saveConfig(config, { storage: broken, warn }).gameplay.shotPower, 1.1);
  assert.deepEqual(loadConfig({ storage: { getItem: () => 'not json {' }, warn }), DEFAULT_CONFIG);
  assert.deepEqual(loadConfig({ storage: { getItem: () => '[1,2]' }, warn }), DEFAULT_CONFIG);
  assert.deepEqual(loadConfig({ storage: null, warn }), DEFAULT_CONFIG);
  assert.equal(messages.length, 4);
});

test('version-8 full snapshots migrate: customs kept, defaults and removed settings dropped', () => {
  // A v8 save is a full snapshot, with the pre-overhaul draft's dense override maps.
  const old = structuredClone(DEFAULT_CONFIG);
  delete old.draft.nations; // v8 had no draft-session settings
  delete old.draft.links;
  old.draft.leagueOverrides = { 13: 1, 19: 1.5, 53: 1 };
  old.draft.clubOverrides = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [String(i + 1), i === 8 ? 2 : 1]),
  );
  old.gameplay.shotFrequency = 1.25; // customised
  old._settingsVersion = 8;
  const storage = memory(old);
  const { messages, warn } = collect();
  const config = loadConfig({ storage, warn });
  assert.deepEqual(messages, []);
  assert.ok(!('leagueOverrides' in config.draft) && !('clubOverrides' in config.draft));
  assert.equal(config.gameplay.shotFrequency, 1.25);
  assert.deepEqual(config.draft.links, DEFAULT_CONFIG.draft.links);
  // Untouched v8 defaults follow later default changes instead of pinning the old value.
  const previous = DEFAULT_CONFIG.gameplay.shotPower;
  DEFAULT_CONFIG.gameplay.shotPower = previous + 0.05;
  try {
    assert.equal(loadConfig({ storage }).gameplay.shotPower, previous + 0.05);
    // ...while a v9 diff-only save keeps an explicit value even if it equals the old default.
    const v9 = memory({ _settingsVersion: 9, gameplay: { shotPower: previous } });
    assert.equal(loadConfig({ storage: v9 }).gameplay.shotPower, previous);
  } finally {
    DEFAULT_CONFIG.gameplay.shotPower = previous;
  }
  // Re-saving writes the compact form.
  saveConfig(config, { storage });
  assert.deepEqual(storage.stored(), { gameplay: { shotFrequency: 1.25 }, _settingsVersion: 9 });
});

test('settings of removed features load silently and are dropped on the next save', () => {
  // Keys only the pre-overhaul UI read: its draft (league/club weights and overrides, budget
  // tickets, re-spins and their boosts), its AI club opponents and its display settings.
  const removed = {
    draft: {
      leagueWeights: { A: 40, B: 10, C: 3, D: 0.8, F: 0.2 },
      leagueOptaSlope: 0.01,
      leagueOptaLimit: 0.2,
      clubDoubleEvery: { A: 6, B: 4, C: 3 },
      respins: { league: 2, team: 0 },
      respinBoosts: { slightlyBetter: 0.3, clubSlightGap: 4 },
      budget: { superstar: 1, star: 4, starter: 2 },
      leagueOverrides: { 19: 1.5 },
      clubOverrides: { 9: 2, 10: 'x' },
      eliteClubBoost: 0.5,
      rerolls: { pro: 3 }, // still a setting
    },
    ai: {
      tiers: { veryeasy: 'D', hard: 'A' },
      impossibleOverall: 86,
      impossibleFit: 0.9,
      impossibleCandidatesPerRole: 3,
      impossibleRandomness: 10,
      formationNoise: { easy: 2 },
      coachInterval: 8, // still a setting
    },
    display: { playerRadius: 1.2, spinnerDuration: 900, receiptLabelDuration: 2 },
  };
  for (const version of [2, 8, 9]) {
    const storage = memory({ ...structuredClone(removed), _settingsVersion: version }),
      { messages, warn } = collect(),
      config = loadConfig({ storage, warn });
    assert.deepEqual(messages, [], `v${version}: ${messages.join('\n')}`);
    assert.equal(config.draft.rerolls.pro, 3);
    assert.equal(config.ai.coachInterval, 8);
    assert.deepEqual(Object.keys(config), Object.keys(DEFAULT_CONFIG));
    assert.deepEqual(Object.keys(config.draft), Object.keys(DEFAULT_CONFIG.draft));
    assert.deepEqual(Object.keys(config.ai), Object.keys(DEFAULT_CONFIG.ai));
    saveConfig(config, { storage });
    assert.deepEqual(storage.stored(), {
      draft: { rerolls: { pro: 3 } },
      ai: { coachInterval: 8 },
      _settingsVersion: 9,
    });
  }
  // Imports (strict) ignore them too instead of rejecting the file.
  assert.equal(normalizeConfig(removed).ai.coachInterval, 8);
});

test('config fields and runtime replacement', () => {
  assert.equal(configField('gameplay.shotPower').defaultValue, DEFAULT_CONFIG.gameplay.shotPower);
  assert.equal(configField('draft.rerolls.pro').label, 'Pro');
  assert.equal(configField('draft.clubOverrides.9'), null);
  assert.equal(configField('nope.nothing'), null);
  const config = structuredClone(DEFAULT_CONFIG);
  config.draft.rerolls.pro = 4;
  try {
    setRuntimeConfig(config);
    assert.equal(CONFIG.draft.rerolls.pro, 4);
  } finally {
    setRuntimeConfig(DEFAULT_CONFIG);
  }
  assert.equal(CONFIG.draft.rerolls.pro, DEFAULT_CONFIG.draft.rerolls.pro);
});
