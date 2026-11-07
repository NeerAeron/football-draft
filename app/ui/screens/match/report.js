// Post-match summary: Match → the result object of the hand-off contract (docs/ui-match.md),
// plus analysis chips and the share line. Pure (Node-tested).
import { performanceRating } from '../../../core/sim/replay.js';
import { commonName } from '../../../core/players/player-labels.js';
import { minuteLabel } from './commentary.js';
import { fmt1 } from '../../lib/format.js';

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);

/** Is this event worth keeping in the result (and the key moments list)? */
export function isSignificant(e) {
  switch (e.type) {
    case 'goal':
    case 'post':
    case 'near-miss':
    case 'penalty':
    case 'yellow':
    case 'red':
    case 'shootout':
      return true;
    case 'save':
      return (e.difficulty ?? 0) >= 0.45 || !!e.bigChance;
    case 'shot':
      return !!e.bigChance && e.outcome === 'off target';
    case 'block':
      return !!e.bigChance;
    default:
      return false;
  }
}

const EVENT_FIELDS = [
  'assistId',
  'xg',
  'bigChance',
  'oneOnOne',
  'situation',
  'setPiece',
  'story',
  'scoreAfter',
  'ownGoal',
  'penalty',
  'shotType',
  'saveType',
  'difficulty',
  'outcome',
  'miss',
  'by',
  'frame',
  'secondYellow',
  'shooterId',
  'keeperId',
  'round',
  'suddenDeath',
  'shootoutScore',
  'decisive',
];

function eventSummary(e, m) {
  const name = id => (id != null && m.players[id] ? commonName(m.players[id]) : null);
  const out = {
    id: e.id,
    type: e.type,
    team: e.team ?? null,
    time: e.time,
    half: e.half,
    minute: e.type === 'shootout' ? 'PEN' : minuteLabel(e.time, e.half),
    text: e.text,
    playerId: e.playerId ?? null,
    player: name(e.playerId),
  };
  for (const key of EVENT_FIELDS)
    if (e[key] !== undefined) out[key] = Array.isArray(e[key]) ? [...e[key]] : e[key];
  if (e.assistId != null) out.assist = name(e.assistId);
  if (e.keeperId != null) out.keeper = name(e.keeperId);
  if (e.shooterId != null) out.shooter = name(e.shooterId);
  return out;
}

function playerSummary(p, m) {
  const s = p.stats;
  return {
    id: p.id,
    profileId: p.profileId ?? null,
    team: p.team,
    slot: p.slot,
    number: p.number,
    name: commonName(p) || p.name,
    fullName: p.fullName || p.name,
    role: p.dismissedRole || p.role,
    rating: round(performanceRating(p, m)),
    goals: s.goals,
    assists: s.assists,
    shots: s.shots,
    onTarget: s.onTarget,
    keyPasses: s.keyPasses,
    saves: s.saves,
    tackles: s.tackles,
    interceptions: s.interceptions,
    passes: s.passes,
    completed: s.completed,
    turnovers: s.turnovers,
    fouls: s.fouls,
    yellowCards: p.yellowCards || 0,
    sentOff: !!p.sentOff,
  };
}

/** "2 goals · 1 assist" / "6 saves" / "92% passing" — the headline numbers of a game. */
export function playerLine(p) {
  const parts = [];
  if (p.goals) parts.push(`${p.goals} goal${p.goals > 1 ? 's' : ''}`);
  if (p.assists) parts.push(`${p.assists} assist${p.assists > 1 ? 's' : ''}`);
  if (p.saves) parts.push(`${p.saves} save${p.saves > 1 ? 's' : ''}`);
  if (parts.length < 2 && p.keyPasses >= 2) parts.push(`${p.keyPasses} chances created`);
  if (parts.length < 2 && p.tackles >= 3) parts.push(`${p.tackles} tackles`);
  if (parts.length < 2 && p.passes >= 15) parts.push(`${pct(p.completed, p.passes)}% passing`);
  if (!parts.length) parts.push(`${p.passes} passes`);
  return parts.slice(0, 3).join(' · ');
}

const DEFENDERS = new Set(['GK', 'CB', 'LB', 'RB']);

function heldBackReason(p, conceded) {
  if (p.sentOff) return 'Sent off';
  if (DEFENDERS.has(p.role) && conceded >= 2)
    return p.role === 'GK' ? `Conceded ${conceded}` : `Part of a defence that conceded ${conceded}`;
  if (p.turnovers >= 4) return `Gave the ball away ${p.turnovers} times`;
  if (p.shots >= 3 && !p.goals) return `${p.shots} shots, no goal`;
  if (p.passes >= 8 && p.completed / p.passes < 0.7)
    return `${pct(p.completed, p.passes)}% pass completion`;
  if (p.yellowCards) return 'Booked';
  if (p.fouls >= 2) return `${p.fouls} fouls`;
  if (p.passes + p.tackles + p.shots < 10) return 'Barely involved';
  return 'Lowest match rating';
}

function teamStats(m, t, events) {
  const s = m.stats[t],
    total = m.stats[0].possession + m.stats[1].possession,
    home = total > 0 ? Math.round((100 * m.stats[0].possession) / total) : 50;
  return {
    possession: t === 0 ? home : 100 - home,
    shots: s.shots,
    onTarget: s.onTarget,
    xg: round(s.xg || 0, 2),
    bigChances: events.filter(e => e.type === 'shot' && e.team === t && e.bigChance).length,
    passes: s.passes,
    completed: s.completed,
    passAccuracy: pct(s.completed, s.passes),
    saves: s.saves,
    tackles: s.tackles,
    fouls: s.fouls,
    yellowCards: s.yellowCards,
    redCards: s.redCards,
    offsides: s.offsides,
    corners: events.filter(
      e => e.type === 'restart' && e.team === t && /^Corner/.test(e.text || ''),
    ).length,
    woodwork: s.woodwork,
  };
}

/**
 * Chips that explain the result from `side`'s point of view (2–3, strongest first):
 * "Clinical: 3 goals from 1.4 xG", "Wasteful", "Dominated possession", "Keeper heroics"…
 */
export function analysisChips(result, side = 0, max = 3) {
  const o = 1 - side,
    us = result.stats[side],
    them = result.stats[o],
    g = result.score[side],
    ga = result.score[o],
    xg = us.xg,
    xga = them.xg,
    won = result.winner === side,
    lost = result.winner === o,
    f1 = fmt1,
    plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const chips = [];
  const add = (id, tone, label, detail, weight) => chips.push({ id, tone, label, detail, weight });
  // Finishing (goals vs xG) — ours and theirs
  if (g >= 2 && g - xg >= 0.9)
    add('clinical', 'positive', 'Clinical', `${g} goals from ${f1(xg)} xG`, 3 + g - xg);
  if (xg - g >= 1)
    add('wasteful', 'negative', 'Wasteful', `${plural(g, 'goal')} from ${f1(xg)} xG`, 2.5 + xg - g);
  if (ga >= 2 && ga - xga >= 1.2)
    add(
      'ruthless',
      'negative',
      'Punished',
      `${plural(ga, 'goal')} conceded from ${f1(xga)} xG`,
      2.4 + ga - xga,
    );
  if (xga - ga >= 1.2 && ga <= 1)
    add(
      'rode-luck',
      'neutral',
      'Rode their luck',
      `${f1(xga)} xG against, ${ga} conceded`,
      2 + xga - ga,
    );
  // Chances created
  if (xg - xga >= 0.8 && !lost)
    add('xg-win', 'positive', 'Created more', `${f1(xg)}–${f1(xga)} on xG`, 1.8 + xg - xga);
  if (lost && xg - xga >= 0.8)
    add('deserved', 'neutral', 'Deserved more', `${f1(xg)}–${f1(xga)} on xG`, 3.5);
  if (xga - xg >= 0.8)
    add('outcreated', 'negative', 'Out-created', `${f1(xg)}–${f1(xga)} on xG`, 1.6 + xga - xg);
  // Territory
  if (us.possession >= 58)
    add(
      'possession',
      'positive',
      'Dominated possession',
      `${us.possession}% of the ball`,
      1.4 + (us.possession - 58) / 10,
    );
  if (us.possession <= 42 && won)
    add('smash', 'positive', 'Smash and grab', `won with ${us.possession}% possession`, 3);
  else if (us.possession <= 40)
    add(
      'chasing',
      'negative',
      'Chasing shadows',
      `${us.possession}% possession`,
      1.5 + (40 - us.possession) / 10,
    );
  if (us.shots <= 3) add('shy', 'negative', 'Shot-shy', `only ${plural(us.shots, 'shot')}`, 2);
  else if (us.shots >= them.shots * 1.8 && us.shots >= 7)
    add('siege', 'positive', 'Laid siege', `${us.shots} shots to ${them.shots}`, 2);
  else if (them.shots >= us.shots * 1.8 && them.shots >= 7)
    add('pinned', 'negative', 'Pinned back', `${them.shots} shots faced, ${us.shots} taken`, 2);
  // Keepers and defending
  const keeper = result.players.find(p => p.team === side && p.role === 'GK');
  if (keeper && keeper.saves >= 4)
    add(
      'keeper',
      'positive',
      'Keeper heroics',
      `${keeper.name}: ${keeper.saves} saves`,
      2 + keeper.saves / 3,
    );
  if (ga === 0)
    add('clean', 'positive', 'Clean sheet', `${plural(them.shots, 'shot')} faced, none in`, 2.2);
  // People and drama
  const hero = result.players
    .filter(p => p.team === o && p.goals >= 3)
    .sort((a, b) => b.goals - a.goals)[0];
  if (hero)
    add(
      'undone',
      'negative',
      `Undone by ${hero.name}`,
      `${plural(hero.goals, 'goal')}`,
      3.2 + hero.goals / 2,
    );
  const star = result.players
    .filter(p => p.team === side && p.goals >= 3)
    .sort((a, b) => b.goals - a.goals)[0];
  if (star) add('star', 'positive', `${star.name} hat-trick`, `${plural(star.goals, 'goal')}`, 3.6);
  const late = result.goals.find(
    e =>
      e.team === side &&
      (e.story || []).some(s => s === 'late winner' || (s === 'winner' && e.time >= 4800)),
  );
  if (late)
    add('late', 'positive', 'Late winner', `${late.player || 'Own goal'} ${late.minute}`, 4);
  const lateLoss = result.goals.find(
    e =>
      e.team === o &&
      (e.story || []).some(s => s === 'late winner' || (s === 'winner' && e.time >= 4800)),
  );
  if (lateLoss)
    add(
      'late-loss',
      'negative',
      'Late heartbreak',
      `${lateLoss.player || 'Own goal'} ${lateLoss.minute}`,
      3.8,
    );
  if (won && result.goals.some(e => e.team === side && (e.story || []).includes('comeback')))
    add('comeback', 'positive', 'Comeback', 'came from behind to win', 4.2);
  if (result.players.some(p => p.team === side && p.sentOff))
    add('red', 'negative', 'Down to ten', 'a red card cost you', 3);
  if (result.players.some(p => p.team === o && p.sentOff))
    add('their-red', 'neutral', 'Extra man', 'they finished a player down', 1.6);
  if (result.shootout)
    add(
      'pens',
      result.shootout.winner === side ? 'positive' : 'negative',
      result.shootout.winner === side ? 'Nerves of steel' : 'Shootout heartbreak',
      `${result.shootout.score[side]}–${result.shootout.score[o]} on penalties`,
      4.5,
    );
  if (chips.length < 2) add('even', 'neutral', 'Tight contest', `${f1(xg)}–${f1(xga)} xG`, 0.5);
  if (chips.length < 2)
    add(
      'passing',
      'neutral',
      'Passing',
      `${us.passAccuracy}% vs ${them.passAccuracy}% completion`,
      0.4,
    );
  return chips
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map(({ weight, ...chip }) => chip);
}

/** One line to paste in a chat: "⚽ Liverpool 2–1 Real Madrid · Salah 23' 67' · MOTM Salah 8.4". */
export function shareLine(result) {
  const [home, away] = result.teams;
  const pens = result.shootout
    ? ` (${result.shootout.score[0]}–${result.shootout.score[1]} pens)`
    : '';
  const scorers = new Map();
  for (const g of result.goals) {
    const key = g.ownGoal ? `${g.player || '?'} (og)` : g.player || '?';
    scorers.set(key, [...(scorers.get(key) || []), g.minute]);
  }
  const goals = [...scorers].map(([n, mins]) => `${n} ${mins.join(' ')}`).join(', ');
  const motm = result.motm ? ` · MOTM ${result.motm.name} ${fmt1(result.motm.rating)}` : '';
  return `⚽ ${home.name} ${result.score[0]}–${result.score[1]} ${away.name}${pens}${goals ? ` · ${goals}` : ''}${motm} · Football Draft`;
}

/** A finished Match + its request → the stored result (docs/ui-match.md). */
export function summarizeMatch(m, request, { finishedAt = new Date().toISOString() } = {}) {
  const chronological = [...m.events].reverse();
  const events = chronological.filter(isSignificant).map(e => eventSummary(e, m));
  const players = m.players.map(p => playerSummary(p, m));
  const meta = request.meta || {};
  const userSides = meta.userSides || [0];
  const motm = [...players].sort(
    (a, b) => b.rating - a.rating || b.goals - a.goals || b.assists - a.assists || a.id - b.id,
  )[0];
  const heldBack = [0, 1].map(t => {
    if (!userSides.includes(t)) return null;
    const worst = players
      .filter(p => p.team === t)
      .sort((a, b) => a.rating - b.rating || b.turnovers - a.turnovers || a.id - b.id)[0];
    return worst ? { ...worst, reason: heldBackReason(worst, m.score[1 - t]) } : null;
  });
  const score = [...m.score],
    winner = m.winner();
  const result = {
    id: request.id,
    seed: request.seed,
    view: request.view,
    durationMode: request.view,
    context: meta.context || 'quick',
    title: meta.title || '',
    teams: m.teams.map((t, i) => ({
      name: t.name,
      short: t.short ?? null,
      color: t.color ?? null,
      secondary: t.secondary ?? null,
      formation: t.tactics?.formation ?? null,
      flagCode: meta.sides?.[i]?.flagCode ?? t.code ?? null,
      kind: meta.sides?.[i]?.kind ?? (i === 0 ? 'user' : 'ai'),
    })),
    userSides,
    score,
    shootout: m.shootout
      ? {
          score: [...m.shootout.score],
          winner: m.shootout.winner,
          first: m.shootout.first,
          kicks: m.shootout.kicks.map(k => ({
            team: k.team,
            playerId: k.playerId,
            name: m.players[k.playerId] ? commonName(m.players[k.playerId]) : null,
            keeperId: k.keeperId,
            round: k.round,
            suddenDeath: !!k.suddenDeath,
            outcome: k.outcome,
            scored: !!k.scored,
          })),
        }
      : null,
    winner,
    outcomes: [0, 1].map(t =>
      score[t] > score[1 - t] ? 'W' : score[t] < score[1 - t] ? 'L' : 'D',
    ),
    extraTime: m.half > 2,
    abandoned: m.abandonedTeam ?? null,
    xg: [round(m.stats[0].xg || 0, 2), round(m.stats[1].xg || 0, 2)],
    momentum: (m.momentum?.samples || []).map(s => round(s.values[0] - s.values[1], 3)),
    stats: [0, 1].map(t => teamStats(m, t, chronological)),
    events,
    goals: events.filter(e => e.type === 'goal'),
    players,
    motm: { ...motm, line: playerLine(motm) },
    heldYouBack: heldBack[userSides[0]] ?? null,
    heldBack,
    finishedAt,
  };
  result.analysis = analysisChips(result, userSides[0] ?? 0);
  result.share = shareLine(result);
  return result;
}
