import { CONFIG } from '../app/config.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Draft } from '../app/draft.js';
import { leagueWeight, teamWeight } from '../app/leagues.js';
import { clubSquads, assignClubLineup } from '../app/club-lineups.js';
import {
  overallRating,
  playerTier,
  positionFamiliarity,
  ATTRS,
  OVERALL_WEIGHTS,
  OVERALL_OFFSETS,
  RATING_GROUPS,
} from '../app/ratings.js';
import { BADGES } from '../app/traits.js';
import { FORMATIONS, formationLabel } from '../app/formations.js';

// A reproducible, read-only export of the shipped catalog and opening draft pools.
const output = resolve(process.argv[2] || '/tmp/football-draft-audit');
mkdirSync(output, { recursive: true });
const bytes = readFileSync(new URL('../app/data/players-fc26.json', import.meta.url)),
  catalog = JSON.parse(bytes);
const draft = new Draft(catalog, { seed: 1 }),
  opening = draft.leagueOptions(),
  weightSum = opening.reduce((n, l) => n + l.weight, 0),
  clubs = clubSquads(catalog);
const tiers = ['A', 'B', 'C', 'D', 'F'],
  baseWeights = CONFIG.draft.leagueWeights;
const leagues = catalog.leagues.map(l => {
  const draw = opening.find(o => o.id === l.id),
    players = catalog.players.filter(p => p.source.leagueId === l.id),
    teams = clubs.filter(c => c.leagueId === l.id);
  return {
    ...l,
    retainedClubs: teams.length,
    goalkeepers: players.filter(p => p.primaryPosition === 'GK').length,
    completeClubXIs: teams.filter(c => c.formations.length).length,
    baseWeight: baseWeights[l.tier],
    optaWeightMultiplier: leagueWeight(l) / baseWeights[l.tier],
    openingWeight: draw?.weight || 0,
    openingProbability: draw ? draw.weight / weightSum : 0,
    clubSpinner: ['A', 'B', 'C'].includes(l.tier),
  };
});
const aiTiers = Object.fromEntries(Object.entries(CONFIG.ai.tiers).map(([k, v]) => [k, [v]])),
  aiPools = Object.fromEntries(
    Object.entries(aiTiers).map(([level, allowed]) => [
      level,
      clubs.filter(c => allowed.includes(c.tier) && c.formations.length),
    ]),
  );
const teams = clubs.map(c => {
  const l = leagues.find(l => l.id === c.leagueId),
    siblings = clubs.filter(t => t.leagueId === l.id),
    denominator = siblings.reduce((n, t) => n + teamWeight(t), 0);
  return {
    ...Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'players')),
    goalkeepers: c.players.filter(p => p.primaryPosition === 'GK').length,
    completeXI: c.formations.length > 0,
    clubWeight: teamWeight(c),
    openingConditionalClubProbability: l.clubSpinner ? teamWeight(c) / denominator : null,
    openingPlayerPoolAccessProbability:
      l.openingProbability * (l.clubSpinner ? teamWeight(c) / denominator : 1),
    aiClubProbabilities: Object.fromEntries(
      Object.entries(aiPools).map(([level, pool]) => [
        level,
        pool.some(t => t.id === c.id) ? 1 / pool.length : 0,
      ]),
    ),
  };
});
const players = catalog.players
  .map(p => {
    const club = teams.find(c => c.id === p.source.clubId),
      overall = overallRating(p, true, p.primaryPosition),
      tier = playerTier(p);
    return {
      ...p,
      overall,
      tier: tier.name,
      badgeRange: [tier.minimum, tier.capacity],
      openingPlayerPoolAccessProbability: club.openingPlayerPoolAccessProbability,
      impossibleNaturalOverallEligible: overall >= CONFIG.ai.impossibleOverall,
    };
  })
  .sort(
    (a, b) =>
      b.overall - a.overall || b.sourceOverall - a.sourceOverall || a.name.localeCompare(b.name),
  );
const eligible = players.filter(p => p.overall >= CONFIG.ai.impossibleOverall),
  impossibleFormations = Object.keys(FORMATIONS).map(formation => {
    const xi = assignClubLineup(eligible, formation, {
      minimumFit: CONFIG.ai.impossibleFit,
      minimumOverall: CONFIG.ai.impossibleOverall,
    });
    if (!xi) throw Error(`No ${CONFIG.ai.impossibleOverall}+ XI in ${formation}`);
    return {
      formation: formationLabel(formation),
      initialProbability: 1 / Object.keys(FORMATIONS).length,
      eligibleByRole: Object.fromEntries(
        [...new Set(FORMATIONS[formation].map(r => r[2]))].map(role => [
          role,
          eligible.filter(
            p =>
              positionFamiliarity(p, role) >= CONFIG.ai.impossibleFit &&
              overallRating(p, true, role) >= CONFIG.ai.impossibleOverall,
          ).length,
        ]),
      ),
    };
  });
const tierSummary = tiers.map(tier => {
  const ls = leagues.filter(l => l.tier === tier);
  return {
    tier,
    requested: ls.length,
    active: ls.filter(l => l.openingProbability).length,
    players: ls.reduce((n, l) => n + l.playerCount, 0),
    goalkeepers: ls.reduce((n, l) => n + l.goalkeepers, 0),
    clubs: ls.reduce((n, l) => n + l.retainedClubs, 0),
    openingProbability: ls.reduce((n, l) => n + l.openingProbability, 0),
  };
});
const audit = {
  configuration: CONFIG,
  exportDate: new Date().toISOString().slice(0, 10),
  catalogSha256: createHash('sha256').update(bytes).digest('hex'),
  source: catalog.source,
  compilerVersion: catalog.compilerVersion,
  selection: catalog.selection,
  probabilityBasis:
    'First PvP pick with all players available and both GK/outfield slots open. Later picks and AI-opponent exclusions renormalize eligible pools. Player pool access is not player selection probability; the human chooses.',
  rules: {
    leagueBaseWeights: baseWeights,
    leagueMultiplier: '1 + clamp((Opta score - 80) * 0.006, -0.10, 0.10)',
    clubWeight:
      '2 ** ((median top-ten OVR - 72 - A-league elite adjustment) / league-tier doubling interval); elite adjustment = max(0, OVR - A-team floor) * (1 - eliteClubBoost) in A leagues only',
    clubDoublingIntervals: CONFIG.draft.clubDoubleEvery,
    respin: {
      settings: CONFIG.draft.respinBoosts,
      formula:
        'ordinary eligible weight * (1 + improvement boost), then renormalize; compared to the replaced result only',
      clubComparison: 'unrounded median top-ten overall gain',
      leagueComparison:
        'A/B/C/D/F tier gain; stronger Opta score within the same tier counts as slight',
    },
    teamTierThresholds: CONFIG.teamTiers,
    clubStartingXI: { uniquePlayers: 11, minimumPositionFamiliarity: 0.85, goalkeepers: 1 },
    impossible: {
      minimumNaturalOverall: CONFIG.ai.impossibleOverall,
      minimumAssignedOverall: CONFIG.ai.impossibleOverall,
      minimumPositionFamiliarity: CONFIG.ai.impossibleFit,
      naturalEligiblePlayers: eligible.length,
      goalkeepers: eligible.filter(p => p.primaryPosition === 'GK').length,
      initialFormations: impossibleFormations,
      selection:
        'Uniform random formation. A best-fit XI guarantees coverage; add up to five randomly ordered compatible players per required role, then maximize assigned OVR + uniform random 0–60 per slot-player pair. Player probabilities are not uniform.',
    },
    ai: {
      clubPools: Object.fromEntries(
        Object.entries(aiPools).map(([level, pool]) => [
          level,
          { clubs: pool.length, tiers: aiTiers[level], perClubProbability: 1 / pool.length },
        ]),
      ),
      formationNoise: CONFIG.ai.formationNoise,
      executionModifiers: false,
    },
    overall: {
      formula: 'round(clamp(weighted detailed role ability + role offset, 1, 99) * familiarity)',
      familiarity:
        '.72 + .28 * exp(-1.4 * shortest position distance); disconnected positions .60; secondary distance starts at .025',
      roleWeightsPercent: OVERALL_WEIGHTS,
      roleOffsets: OVERALL_OFFSETS,
      categorySummaries: RATING_GROUPS,
    },
    badges: BADGES,
    attributes: ATTRS,
  },
  tierSummary,
  leagues,
  teams,
  players,
};
writeFileSync(resolve(output, 'football-draft-data.json'), JSON.stringify(audit, null, 2) + '\n');
const pct = n => (n * 100).toFixed(4) + '%',
  num = n => n.toLocaleString('en-US'),
  cell = v =>
    String(v ?? '—')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' '),
  table = (headers, rows) =>
    [headers, headers.map(() => '---'), ...rows]
      .map(row => '| ' + row.map(cell).join(' | ') + ' |')
      .join('\n');
const aiRows = Object.entries(aiPools).map(([level, pool]) => [
  level,
  aiTiers[level].join(' / '),
  pool.length,
  pct(1 / pool.length),
  aiTiers[level]
    .map(t => `${t}: ${pct(pool.filter(c => c.tier === t).length / pool.length)}`)
    .join('; '),
]);
const report = `# Football Draft Challenge — catalog and draw decisions

Exported ${audit.exportDate}. ${num(players.length)} players, ${clubs.length} clubs and ${opening.length} active leagues. This export uses the shipped defaults; the Config page displays and exports device-specific settings.

## League draw

${table(
  ['Tier', 'Active leagues', 'Players', 'Combined chance'],
  tierSummary.map(t => [t.tier, t.active, t.players, pct(t.openingProbability)]),
)}

Weights per league: ${Object.entries(baseWeights)
  .map(([k, v]) => k + ' ' + v)
  .join(
    ', ',
  )}. Each receives the bounded league strength multiplier and any league override. League tiers remain the supplied tiers. Missing real-player leagues have zero chance.

${table(
  ['Tier', 'League', 'Players', 'Clubs', 'Opening chance'],
  leagues.map(l => [l.tier, l.name, l.playerCount, l.retainedClubs, pct(l.openingProbability)]),
)}

## Club draw and team tiers

Only A/B/C league draws spin a club. D/F opens the whole league pool. Club weight is 2 raised to ((club overall minus72 minus the elite adjustment) divided by the league-tier doubling interval), multiplied by its override. For S/A clubs in A leagues, the extra strength above the A-team floor is multiplied by the configured eliteClubBoost; other club strength curves are unchanged. Intervals: ${Object.entries(
  CONFIG.draft.clubDoubleEvery,
)
  .map(([tier, v]) => tier + ' league ' + v + ' OVR')
  .join(
    ', ',
  )}. Lower intervals favor stronger clubs more strongly. Club overall is the median of the ten highest unrounded natural simulation player ratings. Clubs with fewer than ten retained players use the available median and record the sample size. Opta club scores do not determine game tiers or club odds.

${table(
  ['Team tier', 'Minimum median OVR', 'Clubs', 'Complete XIs'],
  Object.entries(CONFIG.teamTiers).map(([t, min]) => [
    t,
    min,
    clubs.filter(c => c.tier === t).length,
    clubs.filter(c => c.tier === t && c.formations.length).length,
  ]),
)}

Pool access is league chance times conditional club chance, or simply league chance for D/F. It is not individual selection probability: the human chooses. Picked players, the AI XI and filled budget/keeper slots change eligibility; weights normalize again. Draws remain locked while filtering. Re-spins apply the configured relative improvement boost against the result being replaced, then renormalize; these opening probabilities do not include re-spin bonuses.

## Classic Draft Challenge

${table(
  ['Difficulty', 'Team tier', 'Eligible clubs', 'Chance per club'],
  Object.entries(aiPools).map(([level, pool]) => [
    level,
    aiTiers[level].join('/'),
    pool.length,
    pct(1 / pool.length),
  ]),
)}

Impossible uses natural and assigned OVR${CONFIG.ai.impossibleOverall}+, at least${Math.round(CONFIG.ai.impossibleFit * 100)}% position familiarity, and a random compatible formation. There are ${eligible.length} eligible natural${CONFIG.ai.impossibleOverall}+ players. Its slot assignment combines ability and randomized priorities; per-player selection odds are not uniform. Difficulty affects squad choice and coaching only. Every mode uses identical match physics.

Budget mode provides 2 Superstar, 3 Star, 3 Starter and 3 shared Normal/Bench tickets. A lower-tier player uses their own ticket first, then may consume the nearest higher ticket after confirmation. The paid ticket remains spent; the player keeps their real tier. Lookahead protects a complete XI including a keeper. Financial Takeover has no tier limits. Upper-tier ticket counts are configurable.

## Player tiers

${table(
  ['Tier', 'Minimum natural OVR', 'Badge range'],
  Object.entries(CONFIG.playerTiers).map(([name, t]) => [
    name,
    t.minimum,
    t.badgeMinimum + '–' + t.badgeMaximum,
  ]),
)}

Source traits, detailed abilities and position compatibility drive the compiler. Individual tendencies remain continuous and hidden in the game UI. Badges add ability and preference boosts; they never exclusively unlock a technique. Exact values, evidence, attributes, overall weights and default configuration are included in the JSON.

## Files

- football-draft-players.md: all players, positions, source/simulation OVR, badges and opening pool access.
- football-draft-clubs.md: club tiers, colors, draw odds and AI eligibility.
- football-draft-data.json: full catalog, evidence, settings and probabilities.

The FC26 roster snapshot is ${catalog.source.asOf}; the retained league strength snapshot is ${catalog.source.optaAsOf}. Source CSV SHA-256: ${catalog.source.sha256}. Catalog SHA-256: ${audit.catalogSha256}. Source and asset provenance remain in the JSON and source files.
`;
writeFileSync(resolve(output, 'football-draft-audit.md'), report);
writeFileSync(
  resolve(output, 'football-draft-players.md'),
  `# All ${num(players.length)} compiled players\n\nSorted by natural-position simulation overall, then FC overall. FC rosters: ${catalog.source.asOf}. Opening pool access uses the first PvP draw before removals; the human chooses the player. Full attributes, preferences and evidence are in football-draft-data.json.\n\n` +
    table(
      [
        'Rank',
        'Player',
        'Club',
        'League',
        'Position(s)',
        'Foot',
        'FC OVR',
        'Sim OVR',
        'Tier',
        'Badges',
        'Pool access',
      ],
      players.map((p, i) => [
        i + 1,
        p.name,
        p.source.club,
        leagues.find(l => l.id === p.source.leagueId).name,
        [p.primaryPosition, ...p.secondaryPositions].join('/'),
        p.foot,
        p.sourceOverall,
        p.overall,
        p.tier,
        p.tags.map(id => BADGES.find(b => b.id === id).label).join(', '),
        pct(p.openingPlayerPoolAccessProbability),
      ]),
    ) +
    '\n',
);
writeFileSync(
  resolve(output, 'football-draft-clubs.md'),
  `# All ${teams.length} stored clubs\n\nInitial PvP draw, before any players are removed. Club odds are conditional on the named league being drawn. A dash means the league skips the club spinner. AI selects uniformly only from complete eligible XIs, using club tier. Colors are primary / secondary hex values; provenance is in football-draft-data.json.\n\n` +
    table(
      [
        'Club',
        'Club tier',
        'League',
        'Players',
        'GK',
        'Complete XI',
        'Colors',
        'Club draw',
        'Player pool access',
        'Very Easy AI',
        'Easy AI',
        'Medium AI',
        'Hard AI',
      ],
      teams.map(t => [
        t.name,
        t.tier,
        leagues.find(l => l.id === t.leagueId).name,
        t.playerCount,
        t.goalkeepers,
        t.completeXI ? 'Yes' : 'No',
        `${t.primary} / ${t.secondary}`,
        t.openingConditionalClubProbability === null
          ? '—'
          : pct(t.openingConditionalClubProbability),
        pct(t.openingPlayerPoolAccessProbability),
        pct(t.aiClubProbabilities.veryeasy),
        pct(t.aiClubProbabilities.easy),
        pct(t.aiClubProbabilities.medium),
        pct(t.aiClubProbabilities.hard),
      ]),
    ) +
    '\n',
);
if (Math.abs(leagues.reduce((n, l) => n + l.openingProbability, 0) - 1) > 1e-12)
  throw Error('League odds do not sum to one');
for (const l of leagues.filter(l => l.clubSpinner && l.openingProbability))
  if (
    Math.abs(
      teams
        .filter(t => t.leagueId === l.id)
        .reduce((n, t) => n + t.openingConditionalClubProbability, 0) - 1,
    ) > 1e-12
  )
    throw Error(`Club odds do not sum to one: ${l.name}`);
if (new Set(players.map(p => p.profileId)).size !== players.length)
  throw Error('Duplicate player in audit');
console.log(
  JSON.stringify(
    {
      output,
      players: players.length,
      goalkeepers: players.filter(p => p.primaryPosition === 'GK').length,
      clubs: clubs.length,
      completeXIs: clubs.filter(c => c.formations.length).length,
      activeLeagues: opening.length,
      tierSummary,
      ai: aiRows,
      impossibleEligible: eligible.length,
      allFormationsMeetMinimum: true,
      files: [
        'football-draft-audit.md',
        'football-draft-players.md',
        'football-draft-data.json',
        'football-draft-clubs.md',
      ],
    },
    null,
    2,
  ),
);
