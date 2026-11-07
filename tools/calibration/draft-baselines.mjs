// Draft-mode baselines: the typical XI each draft mode produces, measured with the real draft
// session and a positional drafting policy. The ladder in core/draft/opponents.js targets
// opponents relative to these numbers (MODE_BASELINES); re-run after catalog/rating changes.
//
//   node tools/calibration/draft-baselines.mjs [--catalog file.json] [--n 200]
//        [--modes nations,leagues,clubs,clubAndCountry] [--rerolls 0,1,2] [--out /tmp/x.json]
//
// --catalog: a v3 catalog (default: app/data/catalog.v3.json) or a v2 runtime JSON.
// Policies: "positional" = the session's suggestPick() (best slot rating in the pool), with a
// smart re-roll when the best option is below 78; "links" = the same, but values an option as
// slot rating + the XI's total chem gain (deliberate link-chasing). Solo drafts; formations
// rotate through 4-3-3, 4-2-3-1, 4-4-2, 3-5-2, 3-4-3.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRuntimeCatalog } from '../../scripts/data/catalog-file.mjs';
import { createDraftSession } from '../../app/core/draft/session.js';
import { teamLinks } from '../../app/core/draft/links.js';
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
  out = arg('out', null);
const raw = file ? JSON.parse(readFileSync(file, 'utf8')) : null;
const catalog = !raw || raw.schemaVersion >= 3 ? loadRuntimeCatalog(file || undefined) : raw;
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
function draft(mode, seed, rerolls, policy) {
  const s = createDraftSession(catalog, {
    mode,
    seed,
    rerolls,
    formation: FORMATION_CYCLE[seed % FORMATION_CYCLE.length],
  });
  let duds = 0,
    used = 0;
  while (!s.complete) {
    s.spin();
    if (s.rerollsLeft[0] > 0 && s.suggestPick().rating < REROLL_BELOW) {
      s.reroll();
      used++;
    }
    const move = policy === 'links' ? linkMove(s) : s.suggestPick();
    if (s.suggestPick().rating < 75) duds++;
    const r = s.pick(move.profileId, move.slot);
    if (!r.ok) throw Error(r.reason);
  }
  const rows = FORMATIONS[s.formations[0]],
    xi = s.lineup(0),
    links = teamLinks(xi, s.rules.links),
    ovr = xi.reduce((t, p, i) => t + roleRating(p, rows[i][2]), 0) / 11;
  return {
    ovr,
    chem: links.chem,
    links: links.score,
    effective: ovr + links.chem,
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
for (const mode of modes)
  for (const rerolls of rerollCounts)
    for (const policy of policies) {
      if (policy === 'links' && rerolls !== 1) continue;
      const rows = Array.from({ length: N }, (_, i) => draft(mode, 1000 + i, rerolls, policy));
      const o = rows.map(r => r.ovr);
      const row = {
        mode,
        rerolls,
        policy,
        ovr: r2(mean(o)),
        sd: r2(sd(o)),
        p10: r2(q(o, 0.1)),
        p50: r2(q(o, 0.5)),
        p90: r2(q(o, 0.9)),
        chem: r2(mean(rows.map(r => r.chem))),
        links: r2(mean(rows.map(r => r.links))),
        effective: r2(mean(rows.map(r => r.effective))),
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
