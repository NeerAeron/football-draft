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
  overrideField,
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
  config.draft.clubOverrides['9'] = 2;
  config.draft.leagueOverrides['13'] = 1; // the default multiplier is not stored
  config.draft.rerolls.pro = 2;
  const saved = saveConfig(config, { storage });
  assert.deepEqual(storage.stored(), {
    gameplay: { shotFrequency: 1.2 },
    draft: { clubOverrides: { 9: 2 }, rerolls: { pro: 2 } },
    _settingsVersion: 9,
  });
  assert.deepEqual(saved.draft.leagueOverrides, {});
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
      draft: { clubOverrides: { 9: 2, 10: -4, 11: 'x' }, rerolls: { pro: 1.5, amateur: 3 } },
      removedSetting: { anything: 1 },
    }),
    { messages, warn } = collect(),
    config = loadConfig({ storage, warn });
  assert.equal(config.gameplay.shotFrequency, DEFAULT_CONFIG.gameplay.shotFrequency);
  assert.equal(config.gameplay.shotPower, 1.1);
  assert.equal(config.playerTiers.Star.minimum, DEFAULT_CONFIG.playerTiers.Star.minimum);
  assert.deepEqual(config.draft.clubOverrides, { 9: 2 });
  assert.equal(config.draft.rerolls.pro, 1);
  assert.equal(config.draft.rerolls.amateur, 3);
  assert.equal(messages.length, 5, messages.join('\n'));
  assert.ok(messages.some(m => m.includes('gameplay.shotFrequency')));
  // Strict normalisation (the config page, imports) still rejects the same values.
  assert.throws(() => normalizeConfig({ gameplay: { shotFrequency: 'fast' } }));
  assert.throws(() => normalizeConfig({ draft: { clubOverrides: { 9: -1 } } }));
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

test('version-8 full snapshots migrate: sparse overrides, customs kept, defaults dropped', () => {
  // A v8 save is a full snapshot with dense override maps (every league and club at 1).
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
  const config = loadConfig({ storage });
  assert.deepEqual(config.draft.leagueOverrides, { 19: 1.5 });
  assert.deepEqual(config.draft.clubOverrides, { 9: 2 });
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
  assert.deepEqual(storage.stored(), {
    gameplay: { shotFrequency: 1.25 },
    draft: { leagueOverrides: { 19: 1.5 }, clubOverrides: { 9: 2 } },
    _settingsVersion: 9,
  });
});

test('sparse override fields and runtime replacement of the maps', () => {
  assert.deepEqual(DEFAULT_CONFIG.draft.leagueOverrides, {});
  const f = overrideField('club', '9');
  assert.deepEqual(
    [f.path, f.defaultValue, f.min, f.max, f.step],
    ['draft.clubOverrides.9', 1, 0, 10, 0.05],
  );
  assert.equal(configField('draft.leagueOverrides.13').path, 'draft.leagueOverrides.13');
  assert.equal(configField('gameplay.shotPower').defaultValue, DEFAULT_CONFIG.gameplay.shotPower);
  assert.equal(configField('draft.rerolls.pro').label, 'Pro');
  assert.equal(configField('nope.nothing'), null);
  const config = structuredClone(DEFAULT_CONFIG);
  config.draft.clubOverrides = { 9: 2, 10: 0.5 };
  try {
    setRuntimeConfig(config);
    assert.deepEqual(CONFIG.draft.clubOverrides, { 9: 2, 10: 0.5 });
    config.draft.clubOverrides = { 10: 3 };
    setRuntimeConfig(config);
    assert.deepEqual(CONFIG.draft.clubOverrides, { 10: 3 }, 'removed entries return to 1');
  } finally {
    setRuntimeConfig(DEFAULT_CONFIG);
  }
  assert.deepEqual(CONFIG.draft.clubOverrides, {});
});
