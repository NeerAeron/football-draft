// Reel odds of a World Cup draft (core/draft/reels.js): what the weights make of a draft's
// eleven spins, worked out from the pools themselves (no guards, nothing drafted: the odds of
// a first spin, eleven times).
//
//   node tools/calibration/reel-odds.mjs [--uniform] [--reels '{"nation":{"lift":6}}'] [--nations]
//
// Prints, per draft of 11 spins: the chance that a pool with an all-timer (shown 93+) comes up,
// and how many spins offer a player shown 90+, 85+ and 80+ (a spin counts once per tier); the
// same for GOAT and Captain cards when the data flags them; each era's share and its most and
// least likely nation. --uniform: every era and nation equally likely (the reference).
// --nations: every nation's chance per era.
import { loadEraCatalog } from '../../scripts/data/catalog-file.mjs';
import { DEFAULT_CONFIG } from '../../app/core/config/config.js';
import { eraList, eraPool } from '../../app/core/players/eras.js';
import { naturalRating } from '../../app/core/draft/pools.js';
import { reelWeights } from '../../app/core/draft/reels.js';

const arg = name => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const merge = (a, b) => {
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b || {}))
    out[k] = v && typeof v === 'object' ? merge(out[k] ?? {}, v) : v;
  return out;
};
const uniform = process.argv.includes('--uniform'),
  rules = merge(DEFAULT_CONFIG.draft.reels, JSON.parse(arg('reels') || '{}')),
  catalog = loadEraCatalog(),
  weights = reelWeights(catalog, rules),
  SPINS = 11,
  pct = x => (x * 100).toFixed(1) + '%',
  r2 = x => Math.round(x * 100) / 100;

const tiers = { '93+': 93, '90+': 90, '85+': 85, '80+': 80 },
  chance = Object.fromEntries([...Object.keys(tiers), 'goat', 'captain'].map(k => [k, 0])),
  eras = [];
let known = 0;
const eraTotal = eraList(catalog).reduce((t, e) => t + (uniform ? 1 : weights.get(e.id).weight), 0);
for (const era of eraList(catalog)) {
  const w = weights.get(era.id),
    pEra = (uniform ? 1 : w.weight) / eraTotal,
    total = era.nations.reduce((t, n) => t + (uniform ? 1 : w.nations.get(n.name)), 0),
    rows = [];
  for (const nation of era.nations) {
    const p = (uniform ? 1 : w.nations.get(nation.name)) / total,
      pool = eraPool(catalog, era.id, nation.name),
      best = Math.max(...pool.map(q => Math.round(naturalRating(q))));
    rows.push({ name: nation.name, p, best });
    for (const [key, min] of Object.entries(tiers)) if (best >= min) chance[key] += pEra * p;
    if (pool.some(q => q.goat)) chance.goat += pEra * p;
    if (pool.some(q => q.captain)) chance.captain += pEra * p;
    // "Knowing a player": the squad's fourth best is shown 80 or more.
    const fourth = pool.map(q => Math.round(naturalRating(q))).sort((a, b) => b - a)[3] ?? 0;
    if (fourth >= 80) known += pEra * p;
  }
  rows.sort((a, b) => b.p - a.p);
  eras.push({ era, pEra, rows });
}
console.log(uniform ? 'uniform reels' : `weighted reels ${JSON.stringify(rules)}`);
console.log(
  `a pool with an all-timer (93+): ${pct(1 - (1 - chance['93+']) ** SPINS)} of drafts (once every ${r2(1 / (1 - (1 - chance['93+']) ** SPINS))} drafts)`,
);
for (const key of ['90+', '85+', '80+'])
  console.log(`spins per draft with a ${key} player on offer: ${r2(SPINS * chance[key])}`);
console.log(`spins per draft on a squad whose fourth best is 80+: ${r2(SPINS * known)}`);
for (const key of ['goat', 'captain'])
  if (chance[key] > 0)
    console.log(
      `a ${key} on offer: ${r2(SPINS * chance[key])} spins per draft, ${pct(1 - (1 - chance[key]) ** SPINS)} of drafts`,
    );
console.log('\nera · share · nations · most likely · least likely');
for (const { era, pEra, rows } of eras) {
  const first = rows[0],
    last = rows.at(-1);
  console.log(
    `${era.label.padEnd(22)} ${pct(pEra).padStart(6)} ${String(rows.length).padStart(3)}  ${first.name} ${pct(first.p)} (best ${first.best}) … ${last.name} ${pct(last.p)} (best ${last.best}); ×${r2(first.p / last.p)}`,
  );
  if (process.argv.includes('--nations'))
    console.log(rows.map(r => `   ${r.name} ${pct(r.p)}`).join('\n'));
}
