// The tournament's awards — Golden Boot, Golden Ball, Golden Glove — over every team of a
// finished World Cup Run, not only the user's. Pure and deterministic for the run: the same
// run gives the same awards on every device.
//
// The tournament behind them:
//   * the user's matches as they were recorded (CupRun.recordResult): the engine's player lines
//     for both sides when it played the match, else the lines of scorers.js;
//   * the two other teams' matches of his group (the run's own fixtures);
//   * Legendary in a Nations draft: every other tie of its World Cup (worldCupDraw's eleven
//     groups and the bracket around the user: run.field) — 48 nations;
//   * Pro, World Class, the Daily and every other run have no bracket: the field is the user
//     and the nine teams of his path. Each knockout opponent then gets the matches he must have
//     played to be there — three group matches and a win per round before the tie — against
//     sides nobody sees (their players count, the unseen sides' do not), and the finalist beat
//     the play-off opponent in the other semi-final;
//   * what the user did not play is played here by the fast model: whoever beat him takes his
//     place in the bracket (the best of his group mates when he went out in the group) and
//     meets the opponents that were waiting, up to the final and the third-place play-off.
// Every modelled side gets its players' lines from scorers.js (matchPerformances) with a seed
// of its own, so a team's line-up is what the run stored (buildOpponent's XI) — never assumed
// to be today's catalog players: `player(id)` resolves them (legends included).
//
// The rules:
//   * Golden Boot — most goals; level: more assists, then fewer matches, then the order of the
//     tournament's matches (stable for the seed).
//   * Golden Ball — the best average match rating plus BALL_DEPTH (0.1) for every round the
//     player's team went past the group (0 … +0.6 for the champions), among players with at
//     least BALL_MATCHES (4) matches; level: goals, assists, then the stable order.
//   * Golden Glove — the keeper with the most clean sheets among the teams that reached the
//     quarter-finals; level: fewer goals against per match, more matches, the stable order.
import { CONFIG } from '../config/config.js';
import { lcg } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import { baseProfileId } from '../players/legends.js';
import { mixSeed } from '../draft/session.js';
import { opponentCandidates, buildOpponent } from '../draft/opponents.js';
import { simulateResult } from './model.js';
import { matchPerformances } from './scorers.js';

export const BALL_MATCHES = 4;
export const BALL_DEPTH = 0.1;
/** The stage a team must have played for its keeper to win the Golden Glove. */
export const GLOVE_STAGE = 'qf';

const USER = 'user';
// How far a team went: the last stage it played (the champions one more).
const DEPTH = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, third: 4, final: 5 };
const CHAMPION = 6;
const KNOCKOUTS = ['r32', 'r16', 'qf', 'sf'];
const stageOf = id => (String(id).startsWith('group') ? 'group' : id);
const wonMatch = m => m.outcome === 'W' || m.shootout?.winner === 'user';
const round2 = x => Math.round(x * 100) / 100;
const count = v => (Number.isInteger(v) && v >= 0 ? v : 0);

// A tie that had to end one way (`wins`: 0 | 1), or any way (null): the fast model, drawn
// again until it does.
function tie(ratingA, ratingB, random, wins = null) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const r = simulateResult(ratingA, ratingB, random, { knockout: true }),
      winner = r.goals[0] > r.goals[1] || r.shootout?.winner === 0 ? 0 : 1;
    if (wins === null || winner === wins) return { goals: r.goals, winner };
  }
  return { goals: wins === 0 ? [1, 0] : [0, 1], winner: wins };
}

/**
 * The awards of a finished run, step by step (a Legendary run builds the other squads of its
 * World Cup one per step). Yields nothing of interest; returns
 *   { teams: number of teams counted,
 *     boot, ball, glove: { profileId, name, nation (the player's, a name), role, user (one of
 *       the user's XI), team: { key, name, code, flag, kind, user }, matches, goals, assists,
 *       average, cleanSheets, conceded } | null }.
 * @param run a complete CupRun (its public state)
 * @param context { catalog, player: id → player | undefined }
 */
export function* tournamentSteps(run, { catalog, player }) {
  const teams = new Map(),
    team = (key, t) =>
      teams.set(key, {
        key,
        user: key === USER,
        name: t.name,
        code: t.code ?? null,
        flag: t.flag ?? null,
        kind: t.kind ?? null,
        formation: t.formation,
        players: t.players,
        effective: Number(t.effective) || 0,
        xi: undefined,
      });
  team(USER, { ...run.user, kind: 'draft' });
  for (const o of run.opponents) team(o.key, o);
  const rating = key => teams.get(key)?.effective ?? 0,
    random = lcg(mixSeed(run.rngSeed ^ 0x3c6ef372)),
    matches = [];

  // The user's matches, and the rest of his group.
  for (const m of run.matches)
    matches.push({
      stage: stageOf(m.id),
      sides: [USER, m.opponent],
      goals: m.goals,
      winner: stageOf(m.id) === 'group' ? null : wonMatch(m) ? 0 : 1,
      lines: [m.players, m.against],
    });
  for (const f of run.group.fixtures)
    if (f.score && f.home !== USER && f.away !== USER)
      matches.push({ stage: 'group', sides: [f.home, f.away], goals: f.score });

  const field = Array.isArray(run.field?.matches) ? run.field.matches : null;
  if (field) {
    // The World Cup around him: build the squads the run did not meet.
    const refs = new Map(opponentCandidates(catalog, { rules: CONFIG.draft }).map(c => [c.key, c])),
      taken = run.user.players.map(id => baseProfileId(player(id) ?? { profileId: id }));
    for (const m of field) {
      if (!Array.isArray(m) || !(m[0] in DEPTH)) continue;
      const [stage, home, away, a, b, winner] = m;
      for (const key of [home, away]) {
        if (teams.has(key) || !refs.has(key)) continue;
        const built = buildOpponent(catalog, refs.get(key), { excludePlayers: taken });
        if (built) team(key, { ...built, players: built.players.map(p => p.profileId) });
        yield;
      }
      matches.push({
        stage,
        sides: [home, away],
        goals: [count(a), count(b)],
        winner: winner === 0 || winner === 1 ? winner : null,
      });
    }
  } else {
    // No bracket: each knockout opponent's way to his tie, against sides nobody sees.
    const [finalist, other] = [run.opponents[7], run.opponents[8]];
    run.opponents.slice(3).forEach((o, i) => {
      for (let md = 0; md < 3; md++)
        matches.push({
          stage: 'group',
          sides: [o.key, null],
          goals: simulateResult(o.effective, o.effective - 2, random).goals,
        });
      // Rounds won before the tie with the user; the finalist and the play-off opponent met
      // in the other semi-final.
      const won = Math.min(i, 3);
      for (let k = 0; k < won; k++)
        matches.push({
          stage: KNOCKOUTS[k],
          sides: [o.key, null],
          ...tie(o.effective, o.effective - 1, random, 0),
        });
    });
    matches.push({
      stage: 'sf',
      sides: [finalist.key, other.key],
      ...tie(finalist.effective, other.effective, random, 0),
    });
  }

  // The user's place in the bracket: his while he wins, then his conqueror's.
  let seat = USER,
    beaten = null;
  if (run.matches.length <= 3 && run.status !== 'playing')
    seat = run.table().find(r => r.key !== USER)?.key ?? null;
  for (let i = 0; i < KNOCKOUTS.length && seat; i++) {
    const played = run.matches[3 + i],
      opponent = run.opponents[3 + i].key;
    let winner;
    if (played) winner = wonMatch(played) ? 0 : 1;
    else {
      const r = tie(rating(seat), rating(opponent), random);
      matches.push({ stage: KNOCKOUTS[i], sides: [seat, opponent], ...r });
      winner = r.winner;
    }
    if (i === KNOCKOUTS.length - 1) beaten = winner === 0 ? opponent : seat;
    if (winner === 1) seat = opponent;
  }
  const last = run.matches[7],
    decider = (stage, a, b) => {
      if (last?.id === stage) return wonMatch(last) ? USER : last.opponent;
      if (!a || !b) return null;
      const r = tie(rating(a), rating(b), random);
      matches.push({ stage, sides: [a, b], ...r });
      return r.winner === 0 ? a : b;
    };
  const champion = decider('final', seat, run.opponents[7].key);
  decider('third', beaten, run.opponents[8].key);
  yield;

  // Player lines → rows.
  const lineup = t => {
    if (t.xi !== undefined) return t.xi;
    const rows = FORMATIONS[t.formation],
      xi = rows && t.players.map((id, slot) => ({ ...player(id), role: rows[slot]?.[2] }));
    return (t.xi = xi && xi.every(p => p.profileId && p.role) ? xi : null);
  };
  const rows = new Map(),
    depth = new Map();
  matches.forEach((m, n) =>
    m.sides.forEach((key, side) => {
      const t = teams.get(key),
        xi = t && lineup(t);
      if (!xi) return;
      depth.set(key, Math.max(depth.get(key) ?? 0, DEPTH[m.stage] ?? 0));
      const goalsFor = m.goals[side],
        goalsAgainst = m.goals[1 - side],
        recorded = m.lines?.[side],
        lines = recorded?.length
          ? recorded
          : matchPerformances(xi, {
              goalsFor,
              goalsAgainst,
              random: lcg(mixSeed((run.rngSeed ^ Math.imul(2 * n + side + 1, 0x85ebca6b)) >>> 0)),
            });
      for (const line of lines) {
        const id = key + '|' + line.profileId;
        let row = rows.get(id);
        if (!row) {
          const slot = t.players.indexOf(String(line.profileId));
          if (slot < 0) continue;
          row = {
            order: rows.size,
            profileId: t.players[slot],
            player: xi[slot],
            role: xi[slot].role,
            team: t,
            matches: 0,
            goals: 0,
            assists: 0,
            sum: 0,
            cleanSheets: 0,
            conceded: 0,
          };
          rows.set(id, row);
        }
        row.matches++;
        row.goals += count(line.goals);
        row.assists += count(line.assists);
        row.sum += Number(line.rating) || 0;
        row.conceded += goalsAgainst;
        if (goalsAgainst === 0) row.cleanSheets++;
      }
    }),
  );
  if (champion && depth.has(champion)) depth.set(champion, CHAMPION);

  const all = [...rows.values()],
    reached = row => depth.get(row.team.key) ?? 0,
    average = row => row.sum / row.matches,
    best = (list, ...order) =>
      list.length
        ? [...list].sort((a, b) => {
            for (const by of order) {
              const d = by(b) - by(a);
              if (d) return d;
            }
            return a.order - b.order;
          })[0]
        : null;
  const pick = (list, test) => {
    const some = list.filter(test);
    return some.length ? some : list;
  };
  const keepers = all.filter(r => r.role === 'GK');
  const view = row =>
    row && {
      profileId: row.profileId,
      name: row.player.name,
      nation: row.player.source?.nationality ?? null,
      role: row.role,
      user: row.team.user,
      team: {
        key: row.team.key,
        name: row.team.name,
        code: row.team.code,
        flag: row.team.flag,
        kind: row.team.kind,
        user: row.team.user,
      },
      matches: row.matches,
      goals: row.goals,
      assists: row.assists,
      average: round2(average(row)),
      cleanSheets: row.cleanSheets,
      conceded: row.conceded,
    };
  return {
    teams: depth.size,
    boot: view(
      best(
        all,
        r => r.goals,
        r => r.assists,
        r => -r.matches,
      ),
    ),
    ball: view(
      best(
        pick(all, r => r.matches >= BALL_MATCHES),
        r => round2(average(r) + BALL_DEPTH * reached(r)),
        r => r.goals,
        r => r.assists,
      ),
    ),
    glove: view(
      best(
        pick(keepers, r => reached(r) >= DEPTH[GLOVE_STAGE]),
        r => r.cleanSheets,
        r => -r.conceded / r.matches,
        r => r.matches,
      ),
    ),
  };
}
