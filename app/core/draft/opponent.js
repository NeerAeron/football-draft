import { clubRating } from '../players/team-ratings.js';
import { CONFIG } from '../config/config.js';
import { overallRating, positionFamiliarity } from '../players/ratings.js';
import { FORMATIONS } from '../players/formations.js';
import { bestSlots } from './draft.js';
import { assignClubLineup, clubSquads } from '../players/club-lineups.js';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const DIFFICULTIES = {
  veryeasy: {
    label: 'Very Easy',
    get tiers() {
      return [CONFIG.ai.tiers.veryeasy];
    },
  },
  easy: {
    label: 'Easy',
    get tiers() {
      return [CONFIG.ai.tiers.easy];
    },
  },
  medium: {
    label: 'Medium',
    get tiers() {
      return [CONFIG.ai.tiers.medium];
    },
  },
  hard: {
    label: 'Hard',
    get tiers() {
      return [CONFIG.ai.tiers.hard];
    },
  },
  impossible: { label: 'Impossible', tiers: [] },
};
export function createAIOpponent(catalog, level = 'medium', random = Math.random) {
  const difficulty = DIFFICULTIES[level] || DIFFICULTIES.medium;
  if (level === 'impossible') {
    const eligible = catalog.players.filter(
      p => overallRating(p, true, p.primaryPosition) >= CONFIG.ai.impossibleOverall,
    );
    // Independent random priorities, then slot matching: a new all-star XI each time.
    const priorities = new Map(eligible.map(p => [p.profileId, random()]));
    const viable = Object.keys(FORMATIONS)
      .map(formation => ({
        formation,
        lineup: assignClubLineup(eligible, formation, {
          minimumFit: CONFIG.ai.impossibleFit,
          minimumOverall: CONFIG.ai.impossibleOverall,
          random: () => 0,
          variation: 0,
        }),
      }))
      .filter(c => c.lineup);
    if (!viable.length)
      throw Error(
        `The catalog cannot provide a full ${CONFIG.ai.impossibleOverall}+ all-star XI. Lower the minimum in Config.`,
      );
    const { formation, lineup } = viable[Math.floor(random() * viable.length)];
    const shuffled = [...eligible].sort(
      (a, b) => priorities.get(a.profileId) - priorities.get(b.profileId),
    );
    // Randomly sample a broad pool with every required natural/secondary position covered.
    const pool = new Map(lineup.map(p => [p.profileId, p]));
    for (const [, , role] of FORMATIONS[formation])
      for (const p of shuffled
        .filter(p => positionFamiliarity(p, role) >= CONFIG.ai.impossibleFit)
        .slice(0, CONFIG.ai.impossibleCandidatesPerRole))
        pool.set(p.profileId, p);
    const players = assignClubLineup([...pool.values()], formation, {
      minimumFit: CONFIG.ai.impossibleFit,
      minimumOverall: CONFIG.ai.impossibleOverall,
      random,
      variation: CONFIG.ai.impossibleRandomness,
    });
    return { id: null, name: 'All Stars', ...clubRating(players), formation, players };
  }
  const options = clubSquads(catalog).filter(
    c => difficulty.tiers.includes(c.tier) && c.formations.length,
  );
  if (!options.length)
    throw Error(
      `No complete ${difficulty.tiers.join('/')} club is available for ${difficulty.label}.`,
    );
  const club = options[Math.floor(random() * options.length)],
    choice = chooseAIFormation(club.players, { level, random });
  return { ...club, formation: choice.formation, players: choice.lineup };
}
export function draftValue(p, role, roster = [], level = 'medium') {
  const a = p.attrs,
    fit = positionFamiliarity(p, role),
    base = overallRating(p, false, role);
  if (['veryeasy', 'easy'].includes(level)) return base;
  const attack = ['ST', 'LW', 'RW', 'AM'].includes(role),
    back = ['CB', 'LB', 'RB'].includes(role);
  const partners = roster.filter(Boolean),
    speed = partners.length ? partners.reduce((n, p) => n + p.attrs.pace, 0) / partners.length : 75;
  const detail = attack
    ? a.acceleration * 0.035 + a.shooting * 0.035 + a.control * 0.025
    : back
      ? a.awareness * 0.04 + a.pace * 0.035 + a.defending * 0.025
      : a.vision * 0.04 + a.shortPassing * 0.035 + a.stamina * 0.025;
  const synergy =
    role === 'ST' && speed < 73
      ? a.pace * 0.025
      : role === 'CM' && speed > 78
        ? a.longPassing * 0.025
        : 0;
  return base + fit * 4 + detail + synergy + (p.tags?.length || 0) * 0.15;
}
export function chooseAIFormation(
  players,
  { level = 'medium', random = Math.random, complete = false } = {},
) {
  const noise = CONFIG.ai.formationNoise[level] ?? 1.2;
  const choices = Object.keys(FORMATIONS)
    .map(formation => {
      const lineup = complete
        ? bestSlots(players, formation)
        : assignClubLineup(players, formation);
      if (!lineup) return null;
      const rows = FORMATIONS[formation],
        fit = lineup.reduce((n, p, i) => n + draftValue(p, rows[i][2], lineup, level), 0) / 11;
      return { formation, lineup, value: fit + (random() - 0.5) * noise * 2 };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value || a.formation.localeCompare(b.formation));
  if (!choices.length) throw Error('This squad has no complete, compatible XI.');
  return choices[0];
}
export function coachAI(m, interval = false) {
  if (m.competition?.mode !== 'ai') return;
  const c = (m.tuning || CONFIG).ai.coach,
    level = m.competition.difficulty,
    players = (m.activePlayers || m.players).filter(p => p.team === 1 && p.role !== 'GK'),
    avg = (ps, k) => (ps.length ? ps.reduce((s, p) => s + p.attrs[k], 0) / ps.length : 65);
  const front = players.filter(p => ['ST', 'LW', 'RW', 'AM'].includes(p.role)),
    backs = players.filter(p => ['CB', 'LB', 'RB'].includes(p.role)),
    energy = avg(players, 'stamina'),
    pace = avg(front, 'pace'),
    pass = avg(players, 'shortPassing'),
    recovery = avg(backs, 'pace'),
    goals = m.score[1] - m.score[0],
    late = m.time > c.protectLeadAfter * 60;
  let style =
    pace > c.counterPace
      ? 'counter'
      : pass > c.possessionPassing
        ? 'possession'
        : avg(players, 'crossing') > c.wingCrossing
          ? 'wings'
          : 'balanced';
  let tempo = style === 'counter' ? 4 : 3,
    width = style === 'wings' ? 4 : 3,
    press = recovery > c.pressRecovery && energy > c.pressStamina ? 4 : 3,
    fluidity = pass > c.possessionPassing ? 4 : 3;
  if (level === 'veryeasy') {
    style = 'balanced';
    tempo = 2;
    press = 2;
    fluidity = 2;
  }
  if (level === 'easy') {
    tempo = Math.min(tempo, 3);
    press = Math.min(press, 3);
    fluidity = 3;
  }
  if (['hard', 'impossible'].includes(level)) {
    if (late && goals > 0) {
      style = 'bus';
      tempo = 2;
      press = 2;
      fluidity = 2;
    } else if (goals < 0 && m.time > c.chaseGameAfter * 60) {
      tempo = 5;
      press = recovery > c.chasePressRecovery ? 5 : 4;
      fluidity = 4;
    }
    const opposition = (m.activePlayers || m.players).filter(
      p => p.team === 0 && ['ST', 'LW', 'RW', 'AM'].includes(p.role),
    );
    if (recovery < c.slowRecovery || avg(opposition, 'pace') > recovery + c.paceMismatch)
      press = Math.min(press, 2);
    if (level === 'impossible' && !late) {
      const their = m.teams[0].tactics;
      if (their.press >= c.counterOpponentPress && pace > c.counterMinimumPace) {
        style = 'counter';
        tempo = 4;
      }
      if (their.width <= c.wingOpponentWidth && avg(players, 'crossing') > c.wingMinimumCrossing) {
        style = 'wings';
        width = 4;
      }
    }
    if (players.reduce((s, p) => s + p.energy, 0) / players.length < c.fatigueThreshold)
      press = Math.min(press, 3);
  }
  for (const [key, value] of Object.entries({ style, tempo, width, press, fluidity }))
    if (m.teams[1].tactics[key] !== value) m.setTactic(1, key, value);
}
export function tacticAccess(
  mode,
  team,
  { started = false, halftime = false, recording = false, finished = false } = {},
) {
  if (finished || recording) return false;
  if (mode === 'ai' && team === 1) return false;
  return mode !== 'pvp' || !started || halftime;
}
