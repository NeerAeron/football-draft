// Draft-mode baselines: the typical XI each draft mode produces, measured with the real draft
// session and a positional drafting policy. The ladder in core/draft/opponents.js targets
// opponents relative to these numbers (MODE_BASELINES); re-run after catalog/rating changes.
//
//   node tools/calibration/draft-baselines.mjs [--catalog file.json] [--n 200]
//        [--modes nations,leagues,clubs,clubAndCountry] [--rerolls 0,1,2] [--out /tmp/x.json]
//        [--budget "88:2,84:3,80:3;88:1,84:3,80:4"] [--policies positional,links,smart]
//        [--smart-weight 3] [--legend] [--primes default|N] [--captains N]
//
// --legend: the first spin is the Legend spin (World Cup drafts); --primes: Prime boosts
// (default = CONFIG.draft.primes for Pro… by the re-roll count's difficulty is not known here,
// so "default" means 2 with 2 re-rolls and 1 otherwise, as the difficulties have it), spent
// after the draft on the players who gain most in their slot. Extra columns: `captain` = share
// of XIs with a Captain, `legend` = the legend's slot rating, `primeGain` = slot-rating points
// the boosts added (sum per XI), `primeEligible` = XI players with a prime version (before
// boosting), `primeEligible2` = share of XIs with two or more. --captains N: tag the first N players of data/captains.json
// instead of the catalog's own Captain flags (to choose the list size).
//
// --catalog: a v3 catalog (default: app/data/catalog.v3.json) or a v2 runtime JSON.
// Policies: "positional" = the session's suggestPick() (best slot rating in the pool), with a
// smart re-roll when the best option is below 78; "links" = the same, but values an option as
// slot rating + the XI's total chem gain (deliberate link-chasing). Solo drafts; formations
// rotate through 4-3-3, 4-2-3-1, 4-4-2, 3-5-2, 3-4-3.
// --budget: Budget mode (core/draft/budget.js), one row per scheme ("minimum:slots" × 3, schemes
// separated by ";"; "default" = CONFIG.draft.budget; "off" = no caps). Extra columns: `bands` =
// players per band + free in the final XI, `blocked` = picks per draft whose best player (by
// slot rating) had no band slot left, `spendOrWait` = picks per draft where the best affordable
// player costs a band slot while a cheaper one within 3 points was on offer. Policy "smart":
// slot rating + the boosts the pick adds to the XI (mates), and in Budget mode minus a
// penalty for spending a scarce band slot on a player from the bottom of his band
// (--smart-weight points at most); `differs` = picks per draft where it did not take the
// positional pick.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRuntimeCatalog, readLegends } from '../../scripts/data/catalog-file.mjs';
import { attachLegends } from '../../app/core/players/legends.js';
import { PATHS } from '../../scripts/data/paths.mjs';
import { createDraftSession } from '../../app/core/draft/session.js';
import { teamLinks } from '../../app/core/draft/links.js';
import { budgetBands, bandIndex, bandUse, BUDGET_TIERS } from '../../app/core/draft/budget.js';
import { CONFIG, DEFAULT_CONFIG } from '../../app/core/config/config.js';
import { roleRating, roleFit, naturalRating, isKeeper } from '../../app/core/draft/pools.js';
import { FORMATIONS } from '../../app/core/players/formations.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const file = arg('catalog', null),
  N = Number(arg('n', 200)),
  modes = arg('modes', 'nations,leagues,clubs,clubAndCountry').split(','),
  rerollCounts = arg('rerolls', '0,1,2').split(',').map(Number),
  policies = arg('policies', 'positional,links').split(','),
  out = arg('out', null),
  SMART_WEIGHT = Number(arg('smart-weight', 3)),
  LEGEND = process.argv.includes('--legend'),
  PRIMES = arg('primes', null),
  CAPTAINS = arg('captains', null),
  schemes = arg('budget', null)
    ?.split(';')
    .map(text => text.trim())
    .filter(Boolean) ?? [null];
const schemeRules = text =>
  text === 'default'
    ? structuredClone(DEFAULT_CONFIG.draft.budget)
    : Object.fromEntries(
        text.split(',').map((part, i) => {
          const [minimum, slots] = part.split(':').map(Number);
          return [BUDGET_TIERS[i], { minimum, slots }];
        }),
      );
const raw = file ? JSON.parse(readFileSync(file, 'utf8')) : null;
const catalog = !raw || raw.schemaVersion >= 3 ? loadRuntimeCatalog(file || undefined) : raw;
if (LEGEND || PRIMES) attachLegends(catalog, readLegends());
if (CAPTAINS !== null) {
  const list = JSON.parse(readFileSync(PATHS.captains, 'utf8')).players.slice(0, Number(CAPTAINS)),
    ids = new Set(list.map(c => String(c.sofifaId)));
  for (const p of catalog.players) p.captain = ids.has(p.profileId.split(':')[1]);
  for (const p of catalog.legends?.primes.values() ?? [])
    p.captain = ids.has(p.profileId.split(':')[1]);
}
const primeCount = rerolls =>
  PRIMES === null ? 0 : PRIMES === 'default' ? (rerolls >= 2 ? 2 : 1) : Number(PRIMES);
const FORMATION_CYCLE = ['433', '4231', '442', '352', '343'];
const REROLL_BELOW = 78;

function linkMove(s) {
  const side = s.turn,
    rows = FORMATIONS[s.formations[side]],
    xi = s.lineup(side),
    chem = list => teamLinks(list, s.rules.links).players.reduce((t, e) => t + (e?.chem || 0), 0),
    base = chem(xi);
  let best = null;
  const pool = s.poolPlayers();
  const top = Math.max(...pool.map(p => s.autoSlot(p.profileId)?.rating ?? 0));
  for (const p of pool) {
    rows.forEach(([, , role], slot) => {
      if (xi[slot] || (role === 'GK') !== isKeeper(p)) return;
      const v = roleRating(p, role);
      if (v < top - 4) return;
      const next = [...xi];
      next[slot] = p;
      const value = v + chem(next) - base;
      if (!best || value > best.value + 1e-9) best = { value, profileId: p.profileId, slot };
    });
  }
  return best;
}
// The smart drafter: slot rating plus the boosts the pick adds to the XI (mates), and
// in Budget mode a band slot spent on a player from the bottom of his band is worth less than
// one spent near its top, the more so the scarcer the slots are for the picks to come.
function smartMove(s) {
  const side = s.turn,
    rows = FORMATIONS[s.formations[side]],
    xi = s.lineup(side),
    bands = s.bands,
    used =
      bands &&
      bandUse(
        bands,
        xi.filter(Boolean).map(p => Math.round(naturalRating(p))),
      ),
    left = xi.filter(p => !p).length,
    chem = list => teamLinks(list, s.rules.links).total,
    base = chem(xi);
  let best = null;
  for (const p of s.poolPlayers()) {
    if (!s.affordable(p)) continue;
    const ovr = Math.round(naturalRating(p)),
      b = bands ? bandIndex(bands, ovr) : -1;
    let penalty = 0;
    if (b >= 0) {
      const width = (bands[b].below ?? bands[b].minimum + 4) - bands[b].minimum,
        scarcity = Math.max(0, 1 - (bands[b].slots - used[b] - 1) / Math.max(1, left - 1)),
        depth = 1 - Math.min(1, (ovr - bands[b].minimum) / Math.max(1, width - 1));
      penalty = SMART_WEIGHT * scarcity * depth;
    }
    let gain = null;
    rows.forEach(([, , role], slot) => {
      if (xi[slot] || (role === 'GK') !== isKeeper(p)) return;
      if (gain === null) {
        const next = [...xi];
        next[slot] = p;
        gain = chem(next) - base;
      }
      const value = roleRating(p, role) + gain - penalty;
      if (!best || value > best.value + 1e-9) best = { value, profileId: p.profileId, slot };
    });
  }
  return best;
}
// Budget measurements of the pick about to be made (see the header).
function budgetPick(s) {
  const side = s.turn,
    rows = FORMATIONS[s.formations[side]],
    xi = s.lineup(side),
    options = [];
  let top = null;
  for (const p of s.poolPlayers())
    rows.forEach(([, , role], slot) => {
      if (xi[slot] || (role === 'GK') !== isKeeper(p)) return;
      const v = roleRating(p, role),
        ok = s.affordable(p);
      if (!top || v > top.v + 1e-9) top = { v, ok };
      if (ok) options.push({ v, band: bandIndex(s.bands, Math.round(naturalRating(p))) });
    });
  options.sort((a, b) => b.v - a.v);
  const first = options[0];
  return {
    blocked: top && !top.ok ? 1 : 0,
    spendOrWait:
      first && first.band >= 0 && options.some(o => o.band !== first.band && o.v >= first.v - 3)
        ? 1
        : 0,
  };
}
function draft(mode, seed, rerolls, policy, scheme) {
  if (scheme && scheme !== 'off') CONFIG.draft.budget = schemeRules(scheme);
  const s = createDraftSession(catalog, {
    mode,
    seed,
    rerolls,
    budget: !!scheme && scheme !== 'off',
    legendSpin: LEGEND && mode === 'nations',
    primes: primeCount(rerolls) || null,
    formation: FORMATION_CYCLE[seed % FORMATION_CYCLE.length],
  });
  CONFIG.draft.budget = structuredClone(DEFAULT_CONFIG.draft.budget);
  let duds = 0,
    used = 0,
    blocked = 0,
    spendOrWait = 0,
    differs = 0,
    legend = null,
    primeGain = 0;
  while (!s.complete) {
    s.spin();
    if (s.rerollsLeft[0] > 0 && s.suggestPick().rating < REROLL_BELOW) {
      s.reroll();
      used++;
    }
    const greedy = s.suggestPick();
    const move = policy === 'links' ? linkMove(s) : policy === 'smart' ? smartMove(s) : greedy;
    if (s.bands) {
      const b = budgetPick(s);
      blocked += b.blocked;
      spendOrWait += b.spendOrWait;
    }
    if (greedy.rating < 75) duds++;
    if (move.profileId !== greedy.profileId) differs++;
    const r = s.pick(move.profileId, move.slot);
    if (!r.ok) throw Error(r.reason);
    if (s.player(r.profileId).legend) legend = r.rating;
  }
  // Players of the XI with a stored prime version (what the Prime boost sheet can offer).
  const primeEligible = s.primesPerSide ? s.primeOptions(0).length : 0;
  // Prime boosts, used sensibly: each on the player who gains most in his slot.
  for (;;) {
    const options = s
      .primeOptions(0)
      .filter(o => o.allowed && o.to.rating > o.from.rating)
      .sort((a, b) => b.to.rating - b.from.rating - (a.to.rating - a.from.rating));
    if (!options.length) break;
    primeGain += options[0].to.rating - options[0].from.rating;
    s.prime(options[0].slot, 0);
  }
  const rows = FORMATIONS[s.formations[0]],
    xi = s.lineup(0),
    links = teamLinks(xi, s.rules.links),
    ovr = xi.reduce((t, p, i) => t + roleRating(p, rows[i][2]), 0) / 11,
    bands = s.bands || budgetBands(DEFAULT_CONFIG.draft.budget),
    perBand = bandUse(
      bands,
      xi.map(p => Math.round(naturalRating(p))),
    );
  return {
    bands: [...perBand, 11 - perBand.reduce((a, b) => a + b, 0)],
    blocked,
    spendOrWait,
    differs,
    ovr,
    chem: links.chem,
    links: links.score,
    effective: ovr + links.chem,
    captain: links.captain === null ? 0 : 1,
    legend,
    primeGain,
    primesUsed: s.primesPerSide - s.primesLeft[0],
    primeEligible,
    superstars: xi.filter(p => naturalRating(p) >= 84.5).length,
    oop: xi.filter((p, i) => roleFit(p, rows[i][2]) < 0.95).length,
    duds,
    rerollsUsed: used,
  };
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)));
const q = (xs, f) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];
const r2 = x => Math.round(x * 100) / 100;
const report = {
  catalog: file || 'app/data/catalog.v3.json',
  players: catalog.players.length,
  n: N,
  results: [],
};
const t0 = performance.now();
for (const scheme of schemes)
  for (const mode of modes)
    for (const rerolls of rerollCounts)
      for (const policy of policies) {
        if (policy === 'links' && rerolls !== 1) continue;
        const rows = Array.from({ length: N }, (_, i) =>
          draft(mode, 1000 + i, rerolls, policy, scheme),
        );
        const o = rows.map(r => r.ovr);
        const row = {
          ...(scheme ? { budget: scheme } : {}),
          mode,
          rerolls,
          policy,
          ovr: r2(mean(o)),
          sd: r2(sd(o)),
          p10: r2(q(o, 0.1)),
          p50: r2(q(o, 0.5)),
          p90: r2(q(o, 0.9)),
          chem: r2(mean(rows.map(r => r.chem))),
          chemSd: r2(sd(rows.map(r => r.chem))),
          links: r2(mean(rows.map(r => r.links))),
          effectiveSd: r2(sd(rows.map(r => r.effective))),
          bands: rows[0].bands.map((_, i) => r2(mean(rows.map(r => r.bands[i])))).join(' / '),
          ...(scheme && scheme !== 'off'
            ? {
                blocked: r2(mean(rows.map(r => r.blocked))),
                spendOrWait: r2(mean(rows.map(r => r.spendOrWait))),
                differs: r2(mean(rows.map(r => r.differs))),
              }
            : {}),
          effective: r2(mean(rows.map(r => r.effective))),
          captain: r2(mean(rows.map(r => r.captain))),
          ...(rows[0].legend !== null ? { legend: r2(mean(rows.map(r => r.legend))) } : {}),
          ...(PRIMES !== null
            ? {
                primesUsed: r2(mean(rows.map(r => r.primesUsed))),
                primeEligible: r2(mean(rows.map(r => r.primeEligible))),
                primeEligible2: r2(mean(rows.map(r => (r.primeEligible >= 2 ? 1 : 0)))),
                primeGain: r2(mean(rows.map(r => r.primeGain))),
              }
            : {}),
          superstars: r2(mean(rows.map(r => r.superstars))),
          oop: r2(mean(rows.map(r => r.oop))),
          dudPicks: r2(mean(rows.map(r => r.duds)) / 11),
          rerollsUsed: r2(mean(rows.map(r => r.rerollsUsed))),
        };
        report.results.push(row);
        console.error(JSON.stringify(row));
      }
report.seconds = r2((performance.now() - t0) / 1000);
const text = JSON.stringify(report, null, 1);
if (out) writeFileSync(out, text);
else console.log(text);
