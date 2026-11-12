import { positionFamiliarity } from './ratings.js';
import { lcg } from '../util/rng.js';
import { assignRows, costMatrix } from '../util/assignment.js';

export function playerInitials(player) {
  const parts =
    String(player.name || player.fullName || '').match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) || [];
  return (
    parts
      .slice(0, 3)
      .map(part => Array.from(part)[0])
      .join('')
      .toLocaleUpperCase() || '?'
  );
}

// Assign the entire match together so a flexible player cannot displace the
// only specialist needed elsewhere. Random order breaks equal-proficiency ties;
// overall is deliberately absent, so the draw is not just an all-star selection.
export function randomLineups(slots, profiles, seed) {
  if (
    profiles.length < slots.length ||
    new Set(profiles.map(p => p.profileId)).size !== profiles.length
  )
    throw new Error('Not enough distinct player profiles');
  const random = lcg(seed ^ 0x9e3779b9);
  const shuffle = items => {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const rows = shuffle(slots.map((slot, index) => ({ slot, index }))),
    pool = shuffle(profiles),
    n = rows.length,
    m = pool.length;
  // Rectangular assignment (util/assignment.js) on the true familiarity costs; random ratings
  // or arbitrary position boosts never enter the optimization or the players' attributes.
  const cost = costMatrix(n * m);
  for (let i = 0; i < n; i++) {
    const role = rows[i].slot.role;
    for (let j = 0; j < m; j++) {
      const p = pool[j];
      cost[i * m + j] =
        (p.primaryPosition === 'GK') !== (role === 'GK') ? 100 : 1 - positionFamiliarity(p, role);
    }
  }
  const owner = assignRows(cost, n, m);
  const result = Array(n);
  for (let j = 1; j <= m; j++)
    if (owner[j]) {
      const row = owner[j] - 1;
      if (cost[row * m + j - 1] >= 100)
        throw new Error('Not enough players for the required goalkeeper and outfield slots');
      result[rows[row].index] = structuredClone(pool[j - 1]);
    }
  return result;
}
