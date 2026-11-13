// A side's units: its overall, its attack level and its defence level, on the rating scale.
// The engine reads them at kick-off (sim/match.js kickoffLevel: what a side scores is judged
// against the defence it faces) and the fast rating model can take them (competition/model.js).
import { overallRating } from './ratings.js';

/** How much each role shoots and creates. */
export const UNIT_ATTACK = {
  ST: 1,
  LW: 0.9,
  RW: 0.9,
  AM: 0.85,
  LM: 0.6,
  RM: 0.6,
  CM: 0.4,
  DM: 0.1,
};
/** How much each role keeps goals out — the keeper most of all. */
export const UNIT_DEFENCE = {
  GK: 2,
  CB: 1,
  LB: 0.8,
  RB: 0.8,
  DM: 0.7,
  CM: 0.3,
  LM: 0.15,
  RM: 0.15,
};
/**
 * Real XIs rate their attack this much above their defence on these weights (551 clubs: 0.5,
 * 56 nations: 1.1), so a typical side has no unit lean.
 */
export const UNIT_BALANCE = 0.8;

/**
 * { overall, attack, defence } of an XI: the mean overall of its players in their roles, and
 * the same weighted by UNIT_ATTACK / UNIT_DEFENCE. `roles[i]` is player i's role (default:
 * `p.role`, as engine players have it).
 */
export function unitLevels(players, roles = null) {
  let overall = 0,
    attack = 0,
    attackWeight = 0,
    defence = 0,
    defenceWeight = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i],
      role = roles ? roles[i] : p.role,
      rating = overallRating(p, false, role),
      a = UNIT_ATTACK[role] ?? 0,
      d = UNIT_DEFENCE[role] ?? 0;
    overall += rating;
    attack += rating * a;
    attackWeight += a;
    defence += rating * d;
    defenceWeight += d;
  }
  overall /= players.length || 1;
  return {
    overall,
    attack: attackWeight ? attack / attackWeight : overall,
    defence: defenceWeight ? defence / defenceWeight : overall,
  };
}

/**
 * Points by which side `own`'s scoring is harder than the two overalls say: the opponent's
 * defence above the opponent's overall, less its own attack above its own overall (0 for two
 * typical sides).
 */
export function unitLean(own, facing) {
  return facing.defence - facing.overall - (own.attack - own.overall) + UNIT_BALANCE;
}
