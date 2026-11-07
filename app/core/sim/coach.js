import { CONFIG } from '../config/config.js';

// In-match AI coaching (team 1 in AI mode) and tactic-control access rules.
// The engine imports this; it must not depend on draft code.

// Game-state mentality after ~70': a side behind pushes for a goal, a side
// ahead from ~75' holds what it has. The AI coach uses it for its own team;
// a UI can offer it to the human as the suggested "auto" choice.
export function gameStateMentality(m, team) {
  const lead = m.score[team] - m.score[1 - team],
    minute = m.time / 60;
  if (m.half > 2 || minute >= 70) {
    if (lead < 0) return 'push';
    if (lead > 0 && (m.half > 2 || minute >= 75)) return 'hold';
  }
  return 'balanced';
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
  const mentality = level === 'veryeasy' ? 'balanced' : gameStateMentality(m, 1);
  for (const [key, value] of Object.entries({ style, tempo, width, press, fluidity, mentality }))
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
