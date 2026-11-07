// Shared simulation constants and small pure helpers (no Match state).
import { CONFIG } from '../config/config.js';
import { clamp } from '../util/math.js';

export const W = 105,
  H = 68,
  GOAL = 7.32;
export const LENGTHS = { full: 300, quick: 180, highlights: 60, instant: 0 };
// Match length never scales movement. Highlights and Instant resolve a 300 s game.
export const DURATION_PROFILES = CONFIG.formats;

export function segment(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { d: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t), t };
}
export const sigmoid = x => 1 / (1 + Math.exp(-x));
// Abilities already affect execution directly. This secondary adjustment is
// deliberately gradual and bounded, so nearby ratings cannot multiply the
// same technical advantage into near-perfect play.
export const skillError = (ability, influence) =>
  clamp(1 + (75 - ability) * 0.012 * influence, 0.72, 1.28);

export const NAMES = [
  [
    'Oliver Hart',
    'Theo Brooks',
    'Daniel Reed',
    'Luca Moretti',
    'Noah Park',
    'Elias Ward',
    'Leo Silva',
    'Mateo Cruz',
    'Finn Walker',
    'Alex Laurent',
    'Kai Morgan',
  ],
  [
    'Felix Weber',
    'Jules Martin',
    'Adam Cole',
    'Isaac Blake',
    'Rafael Costa',
    'Owen Clarke',
    'Hugo Vidal',
    'Emil Jensen',
    'Sam Okafor',
    'Marco Rossi',
    'Ben Turner',
  ],
];
export const NUMBERS = [1, 3, 4, 5, 2, 6, 10, 8, 11, 9, 7];
export const PROFILE = {
  GK: [49, 42, 65, 18, 65, 35, 65, 86],
  LB: [79, 70, 72, 46, 66, 77, 83, 9],
  RB: [82, 71, 70, 43, 68, 76, 84, 8],
  CB: [64, 47, 65, 32, 66, 86, 77, 8],
  DM: [67, 68, 83, 60, 82, 82, 87, 8],
  CM: [76, 83, 87, 75, 88, 63, 81, 8],
  LW: [91, 89, 75, 81, 77, 37, 75, 8],
  RW: [90, 86, 76, 82, 75, 39, 77, 8],
  ST: [82, 81, 65, 91, 79, 28, 76, 8],
  LM: [82, 80, 80, 72, 77, 58, 84, 8],
  RM: [84, 81, 78, 75, 78, 59, 82, 8],
  AM: [79, 88, 87, 82, 90, 42, 77, 8],
};
export const freshStats = () => ({
  goals: 0,
  assists: 0,
  shots: 0,
  onTarget: 0,
  passes: 0,
  completed: 0,
  keyPasses: 0,
  tackles: 0,
  interceptions: 0,
  takeons: 0,
  saves: 0,
  blocks: 0,
  turnovers: 0,
  miscontrols: 0,
  yellowCards: 0,
  redCards: 0,
  fouls: 0,
  foulsWon: 0,
  offsides: 0,
  penalties: 0,
  penaltyGoals: 0,
  blocked: 0,
  offTarget: 0,
  woodwork: 0,
  forwardPasses: 0,
  backwardPasses: 0,
  dribbleAttempts: 0,
  distance: 0,
});
// Copy a mixin class's methods onto a target class, non-enumerable like
// ordinary class methods. Calls stay `this.method()`, so tests can still
// replace a method on one instance.
export function install(target, ...sources) {
  for (const source of sources)
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(source.prototype)))
      if (key !== 'constructor') Object.defineProperty(target.prototype, key, d);
}
