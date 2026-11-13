// The era pools at a glance (app/data/eras.v1.json, as the game reads it): per era the nations
// that can be spun, pool sizes, the strongest and the weakest pool, who has cards in several
// eras, the all-time top — and, with a nation and an era, that pool.
//   node tools/research/era-report.mjs                 the summary
//   node tools/research/era-report.mjs 2002 Brazil     one pool
//   node tools/research/era-report.mjs --strength      Markdown: each era's top 10 players and
//                                                      how strong the eras are next to each other
import { readFile } from 'node:fs/promises';
import { loadRuntimeCatalog } from '../../scripts/data/catalog-file.mjs';
import { PATHS } from '../../scripts/data/paths.mjs';
import { decodeEras } from '../../app/core/players/eras-codec.js';
import {
  attachEras,
  eraList,
  eraPool,
  bestVersion,
  personId,
} from '../../app/core/players/eras.js';
import { editionLabel } from '../../app/core/players/legends.js';
import { overallRating } from '../../app/core/players/ratings.js';

const shown = p => overallRating(p, true, p.primaryPosition),
  line = p => `${shown(p)} ${p.name} ${p.primaryPosition}${p.year ? ' ' + editionLabel(p) : ''}`,
  catalog = attachEras(
    await loadRuntimeCatalog(),
    decodeEras(JSON.parse(await readFile(PATHS.eras, 'utf8'))),
  ),
  [eraId, nation] = process.argv.slice(2);

if (eraId === '--strength') {
  const mean = list => (list.reduce((sum, v) => sum + v, 0) / list.length).toFixed(1),
    rows = [],
    out = ['# Era pools: the top 10 of each era and how strong the eras are', ''];
  for (const era of eraList(catalog)) {
    const cards = era.nations
      .flatMap(n => eraPool(catalog, era.id, n.name))
      .map(p => ({ p, rating: shown(p) }))
      .sort((a, b) => b.rating - a.rating || (b.p.year ?? 2026) - (a.p.year ?? 2026));
    out.push(
      `## ${era.label} (ratings of ${era.from}–${era.to}; ${era.nations.length} nations)`,
      '',
      '| # | player | nation | card | position | rating |',
      '| --- | --- | --- | --- | --- | --- |',
      ...cards
        .slice(0, 10)
        .map(
          ({ p, rating }, i) =>
            `| ${i + 1} | ${p.name} | ${p.source.nationality} | ${p.year ? editionLabel(p) : 'today'} | ${p.primaryPosition} | ${rating} |`,
        ),
      '',
    );
    const top = n => mean(cards.slice(0, n).map(c => c.rating)),
      nations = n => mean(era.nations.slice(0, n).map(x => x.strength));
    rows.push(
      `| ${era.label} | ${top(10)} | ${top(50)} | ${top(200)} | ${nations(10)} | ${nations(20)} | ${cards.filter(c => c.rating >= 90).length} | ${cards.filter(c => c.rating >= 85).length} | ${cards.length} |`,
    );
  }
  out.push(
    '## Relative strength',
    '',
    '| era | top 10 | top 50 | top 200 | best XI, 10 strongest nations | best XI, 20 strongest | 90+ | 85+ | cards |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  );
  console.log(out.join('\n'));
} else if (eraId && nation) {
  for (const p of eraPool(catalog, eraId, nation)) {
    const best = bestVersion(catalog, p);
    console.log(
      `${line(p).padEnd(34)} ${(p.source.club ?? '').padEnd(24)} ${best ? 'prime ' + line(best) : ''}`,
    );
  }
} else {
  const eras = new Map(); // person → Set(era)
  for (const era of eraList(catalog)) {
    const sizes = era.nations.map(n => n.size),
      short = era.nations.filter(n => n.size < 26),
      [first, last] = [era.nations[0], era.nations.at(-1)];
    console.log(
      `${era.label} (${era.from}–${era.to}): ${era.nations.length} nations; pools of ${Math.min(...sizes)}–${Math.max(...sizes)} (${short.length} under 26; ${era.nations.filter(n => n.keepers < 3).length} with fewer than 3 keepers); strongest ${first.name} ${first.strength}, weakest ${last.name} ${last.strength}`,
    );
    console.log(`  ${era.nations.map(n => n.name).join(', ')}`);
    for (const n of era.nations)
      for (const p of eraPool(catalog, era.id, n.name)) {
        const key = personId(p);
        if (!eras.has(key)) eras.set(key, new Set());
        eras.get(key).add(era.id);
      }
  }
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const set of eras.values()) counts[set.size]++;
  console.log(
    `people in a pool: ${eras.size}; in 2+ eras: ${eras.size - counts[1]} (${counts
      .map((n, i) => (n && i ? `${i} era${i > 1 ? 's' : ''}: ${n}` : ''))
      .filter(Boolean)
      .join(', ')})`,
  );
  const best = new Map(); // person → his best card in any pool or kept as a best version
  for (const p of catalog.eras.byId.values())
    if (!best.has(p.person) || shown(p) > shown(best.get(p.person))) best.set(p.person, p);
  for (const p of catalog.eras.today.values())
    if (!best.has(personId(p)) || shown(p) > shown(best.get(personId(p)))) best.set(personId(p), p);
  console.log('all-time top 60:');
  console.log(
    [...best.values()]
      .sort((a, b) => shown(b) - shown(a) || (b.year ?? 2026) - (a.year ?? 2026))
      .slice(0, 60)
      .map(p => `  ${line(p)} (${p.source.nationality})`)
      .join('\n'),
  );
}
