import { CONFIG } from './config.js';
// Badges add small execution bonuses and contextual preferences; tendencies stay continuous and hidden.
export const BADGES = [
  ['speedster', 'Quick Step', 'Gone in a heartbeat.', 'Attack', { pace: 2, acceleration: 3 }],
  ['dribbler', 'Dribbler', 'The ball follows their lead.', 'Attack', { dribbling: 3 }],
  ['control', 'Close Control', 'Every touch feels effortless.', 'Attack', { control: 3 }],
  ['vision', 'Visionary', 'Sees the picture before it forms.', 'Attack', { vision: 3 }],
  ['through', 'Through Pass', 'Threads the needle.', 'Attack', { shortPassing: 2, vision: 2 }],
  ['crosser', 'Crosser', 'A delivery worth attacking.', 'Attack', { crossing: 3 }],
  [
    'cutback',
    'Cutback',
    'The final pass comes with a twist.',
    'Attack',
    { crossing: 2, shortPassing: 2 },
  ],
  ['finisher', 'Clinical Finish', 'Ice in their veins.', 'Attack', { shooting: 3 }],
  ['longshot', 'Long Shots', 'Danger beyond the box.', 'Attack', { longShots: 3 }],
  ['power', 'Power Shot', 'A thunderbolt waiting to happen.', 'Attack', { power: 3 }],
  ['curve', 'Finesse', 'Bends the game to their will.', 'Attack', { shooting: 2, longShots: 2 }],
  ['knuckle', 'Knuckleball', 'An unpredictable flight.', 'Attack', { longShots: 2, power: 2 }],
  ['onetouch', 'One Touch', 'One touch ahead.', 'Attack', { shortPassing: 2, control: 2 }],
  ['heading', 'Aerial Finish', 'Owns the moment in the air.', 'Attack', { heading: 3 }],
  ['shield', 'Shield', 'The ball is theirs to keep.', 'Attack', { strength: 3, control: 1 }],
  ['penalty', 'Penalty Specialist', 'Calm on the spot.', 'Attack', { penalties: 4, composure: 1 }],
  [
    'volley',
    'Acrobatic Finish',
    'Makes the difficult look spectacular.',
    'Attack',
    { shooting: 2, heading: 2 },
  ],
  ['longball', 'Long Ball', 'Sees the other side of the pitch.', 'Attack', { longPassing: 3 }],
  ['ballwinner', 'Ball Winner', 'Turns a contest into a statement.', 'Defense', { defending: 3 }],
  ['interceptor', 'Interceptor', 'Already knows where it is going.', 'Defense', { awareness: 3 }],
  [
    'marker',
    'Tight Marking',
    'A shadow that stays close.',
    'Defense',
    { awareness: 2, defending: 2 },
  ],
  ['recovery', 'Recovery', 'Never out of the chase.', 'Defense', { acceleration: 2, awareness: 2 }],
  ['engine', 'Relentless', 'Still going when others fade.', 'Defense', { stamina: 3 }],
  ['safehands', 'Safe Hands', 'Safe in their grasp.', 'Goalkeeper', { goalkeeping: 1 }],
  ['reflexes', 'Quick Reflexes', 'Ready in a split second.', 'Goalkeeper', { goalkeeping: 1 }],
  [
    'distributor',
    'GK Distribution',
    'The next chapter starts here.',
    'Goalkeeper',
    { longPassing: 3, shortPassing: 2 },
  ],
  ['gkreach', 'Extended Reach', 'Finds that last fingertip.', 'Goalkeeper', { goalkeeping: 2 }],
  ['gkoneonone', 'One-on-One', 'Stands tall in the final duel.', 'Goalkeeper', { composure: 2 }],
  [
    'gkcommand',
    'Box Command',
    'This box has a keeper.',
    'Goalkeeper',
    { awareness: 3, control: 2 },
  ],
  ['gkfeet', 'Safe Feet', 'At home with the ball.', 'Goalkeeper', { control: 3, shortPassing: 3 }],
  [
    'slalom',
    'Slalom',
    'Finds daylight through the crowd.',
    'Attack',
    { dribbling: 2, acceleration: 1 },
  ],
  ['pressescape', 'Press Escape', 'Grace under pressure.', 'Attack', { control: 2, composure: 1 }],
  [
    'givego',
    'Give & Go',
    'The move never ends at the pass.',
    'Attack',
    { shortPassing: 2, vision: 1 },
  ],
  ['latearrival', 'Late Arrival', 'Right on cue.', 'Attack', { composure: 1, shooting: 1 }],
  [
    'overlap',
    'Overlap Engine',
    'There is always another gear on the flank.',
    'Attack',
    { crossing: 2, stamina: 1 },
  ],
  [
    'anchor',
    'Backline Anchor',
    'An unshakable presence.',
    'Defense',
    { awareness: 2, defending: 1 },
  ],
].map(([id, label, description, group, boosts]) => ({ id, label, description, group, boosts }));
export const TAGS = BADGES; // Legacy tag field now contains badges only.
const badges = new Map(BADGES.map(b => [b.id, b]));
export function badgeBoost(p, key) {
  return Math.min(
    (p.tuning?.badges || CONFIG.badges).attributeCap,
    (p.tags || []).reduce(
      (n, id) => n + ((p.tuning?.badges || CONFIG.badges).boosts[id]?.[key] || 0),
      0,
    ),
  );
}
export function badgeEligible(p, b) {
  if (p.primaryPosition === 'GK')
    return (
      b.group === 'Goalkeeper' ||
      ['longball', 'control', 'onetouch', 'shield', 'engine', 'recovery'].includes(b.id)
    );
  if (b.group === 'Goalkeeper') return false;
  const roles = [p.primaryPosition, ...(p.secondaryPositions || [])];
  if (b.id === 'overlap') return roles.some(r => ['LB', 'RB', 'LM', 'RM'].includes(r));
  if (b.id === 'anchor') return roles.some(r => ['CB', 'DM'].includes(r));
  if (b.id === 'latearrival') return roles.some(r => ['CM', 'AM', 'LM', 'RM', 'ST'].includes(r));
  return true;
}
export const DEFAULT_TAGS = [
  ['safehands', 'distributor'],
  ['crosser', 'recovery'],
  ['marker', 'ballwinner'],
  ['recovery', 'interceptor'],
  ['crosser', 'engine'],
  ['longball', 'interceptor'],
  ['vision', 'through', 'longshot'],
  ['onetouch', 'control'],
  ['speedster', 'dribbler', 'curve'],
  ['finisher', 'heading', 'power'],
  ['cutback', 'crosser', 'curve'],
];
export const STYLES = {
  balanced: { label: 'Balanced', description: 'Connected shape and balanced support.' },
  possession: { label: 'Possession', description: 'Short support and patient combinations.' },
  counter: {
    label: 'Counter attack',
    description: 'Quick outlets and forward runs after a regain.',
  },
  press: { label: 'High press', description: 'Win the ball high with coordinated pressure.' },
  wings: { label: 'Wing play', description: 'Wide outlets, crosses and cutbacks.' },
  bus: {
    label: 'Park the bus',
    description: 'Compact defending with fewer players committed forward.',
  },
};
export const TACTICS = {
  tempo: {
    label: 'Tempo',
    levels: ['Patient', 'Measured', 'Normal', 'Quick', 'Urgent'],
    help: 'Controls how quickly players release the ball.',
  },
  width: {
    label: 'Width',
    levels: ['Very narrow', 'Narrow', 'Balanced', 'Wide', 'Very wide'],
    help: 'Controls the spacing between teammates.',
  },
  press: {
    label: 'Press intensity',
    levels: ['Contain', 'Selective', 'Standard', 'Frequent', 'Relentless'],
    help: 'More closing down, with higher energy use.',
  },
  fluidity: {
    label: 'Fluidity',
    levels: ['Disciplined', 'Structured', 'Balanced', 'Expressive', 'Free-flowing'],
    help: 'Balances positional discipline and freedom to roam.',
  },
};

export function badgeDescription(b) {
  return b.description;
}
