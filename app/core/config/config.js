// One set of named tuning inputs, shared by every game mode.
import { V8_DEFAULT_SIGNATURE } from './v8-defaults.js';
export const DEFAULT_CONFIG = {
  // Draft session (core/draft/session.js, pools.js, opponents.js, links.js).
  draft: {
    // A league needs this many players to be drawn (Leagues, Clubs, Club & Country).
    minimumLeaguePlayers: 5,
    // Nations: the field is the strongest eligible nations (>= minimumPlayers and
    // >= minimumGoalkeepers), shown in pots; each spin offers the best available call-ups.
    nations: {
      fieldSize: 48,
      potSize: 12,
      minimumPlayers: 23,
      minimumGoalkeepers: 2,
      squadSize: 23,
      squadGoalkeepers: 3,
      squadDefenders: 7,
      squadMidfielders: 7,
      squadAttackers: 4,
    },
    // Leagues (and the league leg of Clubs): flat odds per league tier.
    leagueTierWeights: {
      A: 4,
      B: 2,
      C: 1,
      D: 0.5,
      F: 0.25,
    },
    // Clubs: one spin lands a league, then a club. Both legs are tier-weighted (shown on the
    // reels); with flat odds ~half of all picks were duds (no option >= 75) because 429 of
    // the 546 clubs are C/D/F.
    clubs: {
      minimumPlayers: 11,
      leagueTierWeights: {
        A: 12,
        B: 4,
        C: 1,
        D: 0.5,
        F: 0.25,
      },
      // By club tier (S >= 82 … F: median of the best ten; see teamTiers).
      tierWeights: {
        S: 4,
        A: 3,
        B: 2,
        C: 1,
        D: 0.5,
        F: 0.25,
      },
    },
    // Re-rolls per drafter by difficulty.
    rerolls: {
      amateur: 2,
      semipro: 2,
      pro: 1,
      worldclass: 1,
      legendary: 0,
    },
    // Opponent strength vs the mode's typical drafted XI (effective rating, links included).
    ladder: {
      amateur: -7,
      semipro: -3.5,
      pro: 0,
      worldclass: 4,
      legendary: 7,
    },
    // Links: a player's level is the sum of club / nation / league levels (teammates sharing
    // it, the player included, reaching each threshold), capped at 3. chem = level / 3 * maxChem.
    links: {
      club: {
        level1: 2,
        level2: 5,
        level3: 8,
      },
      nation: {
        level1: 2,
        level2: 5,
        level3: 8,
      },
      league: {
        level1: 3,
        level2: 5,
        level3: 8,
      },
      maxChem: 2,
    },
  },
  playerTiers: {
    Superstar: {
      minimum: 85,
      badgeMinimum: 5,
      badgeMaximum: 7,
    },
    Star: {
      minimum: 80,
      badgeMinimum: 3,
      badgeMaximum: 5,
    },
    Starter: {
      minimum: 74,
      badgeMinimum: 2,
      badgeMaximum: 3,
    },
    Normal: {
      minimum: 68,
      badgeMinimum: 1,
      badgeMaximum: 2,
    },
    Bench: {
      minimum: 0,
      badgeMinimum: 0,
      badgeMaximum: 2,
    },
  },
  teamTiers: {
    S: 82,
    A: 78,
    B: 74,
    C: 70,
    D: 66,
    F: 0,
  },
  ai: {
    // Club and national best XIs: minimum position familiarity per slot.
    minimumFit: 0.85,
    coachInterval: 6,
    coach: {
      counterPace: 80,
      possessionPassing: 76,
      wingCrossing: 73,
      pressRecovery: 75,
      pressStamina: 77,
      protectLeadAfter: 65,
      chaseGameAfter: 50,
      chasePressRecovery: 70,
      counterOpponentPress: 4,
      counterMinimumPace: 78,
      wingOpponentWidth: 2,
      wingMinimumCrossing: 70,
      slowRecovery: 65,
      paceMismatch: 12,
      fatigueThreshold: 0.25,
    },
  },
  gameplay: {
    qualityImpact: 1,
    controlQuality: 0.55,
    passingQuality: 0.65,
    defensiveQuality: 0.55,
    creativeQuality: 0.65,
    movementSpeed: 1.28,
    acceleration: 1.1,
    shotFrequency: 2,
    shotScatter: 1.08,
    shotPower: 1,
    saveAbility: 0.9,
    passCompletion: 1,
    passError: 1,
    routinePassError: 0.6,
    difficultPassError: 2.5,
    teamCharacter: 1.5,
    passSpeed: 1.08,
    longBallPreference: 1.3,
    clearanceWillingness: 1.06,
    interceptionReach: 1,
    dribbleSuccess: 1,
    dribbleLoss: 1,
    tackleSuccess: 0.86,
    foulFrequency: 1,
    penaltyPrecision: 1,
    firstTouchError: 1,
    receptionError: 0.12,
    difficultReceptionError: 1.1,
    markingDistance: 1,
    pressDistance: 1,
    restartSetup: 1,
    markingLapses: 1,
    deliveryDeflections: 1,
    runsInBehind: 1,
    crossWillingness: 1.5,
    keeperRange: 1,
  },
  discipline: {
    yellowSeverity: 0.75,
    redSeverity: 1,
    bookedFoulRisk: 0.28,
    bookedRiskAversion: 0.88,
  },
  stamina: {
    drain: 0.55,
    sprintDrain: 1,
    sprintRecovery: 1,
    halftimeRecovery: 0.15,
    halftimeVariation: 1,
  },
  periods: {
    firstHalfMean: 2,
    secondHalfMean: 3,
    firstHalfSpread: 0.8,
    secondHalfSpread: 1,
    minimum: 1,
    firstHalfMaximum: 5,
    secondHalfMaximum: 6,
  },
  formats: {
    180: {
      deliveryError: 0.5,
      decisionTime: 0.6,
      finishPatience: 0.3,
      readWindow: 0.76,
      directness: 2.8,
      shotUrge: 5,
      spread: 0.34,
      saveBoost: -0.1,
      release: 0.85,
      runSupport: 16,
      passUrge: 0.4,
      deepUrge: 1.1,
      rangeUrge: 1.2,
    },
    300: {
      deliveryError: 0.5,
      decisionTime: 1,
      finishPatience: 0.5,
      readWindow: 0.94,
      directness: 2,
      shotUrge: 4,
      spread: 0.43,
      saveBoost: 0,
      release: 1.05,
      runSupport: 20,
      passUrge: 0.25,
      deepUrge: 1,
      rangeUrge: 1,
    },
  },
  ratings: {
    roleWeights: {
      GK: {
        goalkeeping: 100,
      },
      CB: {
        pace: 1.87,
        acceleration: 1.15,
        shooting: 0.1,
        power: 0.39,
        longShots: 0.1,
        penalties: 0.1,
        heading: 14.55,
        shortPassing: 4.83,
        longPassing: 0.1,
        crossing: 0.1,
        vision: 0.1,
        dribbling: 0.1,
        control: 5.02,
        composure: 0.39,
        defending: 28.4,
        awareness: 30.01,
        stamina: 0.77,
        strength: 11.92,
      },
      LB: {
        pace: 7.0,
        acceleration: 4.96,
        shooting: 0.1,
        power: 0.1,
        longShots: 0.1,
        penalties: 0.1,
        heading: 4.72,
        shortPassing: 9.78,
        longPassing: 0.1,
        crossing: 10.81,
        vision: 0.1,
        dribbling: 0.58,
        control: 10.21,
        composure: 1.17,
        defending: 22.0,
        awareness: 20.0,
        stamina: 8.07,
        strength: 0.1,
      },
      RB: {
        pace: 7.0,
        acceleration: 4.96,
        shooting: 0.1,
        power: 0.1,
        longShots: 0.1,
        penalties: 0.1,
        heading: 4.72,
        shortPassing: 9.78,
        longPassing: 0.1,
        crossing: 10.81,
        vision: 0.1,
        dribbling: 0.58,
        control: 10.21,
        composure: 1.17,
        defending: 22.0,
        awareness: 20.0,
        stamina: 8.07,
        strength: 0.1,
      },
      DM: {
        pace: 0.1,
        acceleration: 0.13,
        shooting: 0.1,
        power: 0.32,
        longShots: 0.1,
        penalties: 0.1,
        heading: 1.22,
        shortPassing: 13.93,
        longPassing: 12.92,
        crossing: 0.59,
        vision: 3.84,
        dribbling: 0.14,
        control: 9.47,
        composure: 1.02,
        defending: 22.0,
        awareness: 23.01,
        stamina: 6.98,
        strength: 4.03,
      },
      CM: {
        pace: 0.11,
        acceleration: 0.1,
        shooting: 6.68,
        power: 0.1,
        longShots: 2.38,
        penalties: 0.1,
        heading: 0.1,
        shortPassing: 15.68,
        longPassing: 14.07,
        crossing: 0.1,
        vision: 14.34,
        dribbling: 8.31,
        control: 16.05,
        composure: 2.17,
        defending: 9.15,
        awareness: 4.15,
        stamina: 6.31,
        strength: 0.1,
      },
      AM: {
        pace: 3.7,
        acceleration: 4.32,
        shooting: 11.13,
        power: 0.1,
        longShots: 5.12,
        penalties: 0.1,
        heading: 0.58,
        shortPassing: 15.38,
        longPassing: 4.72,
        crossing: 0.17,
        vision: 18.56,
        dribbling: 15.61,
        control: 15.0,
        composure: 3.01,
        defending: 0.1,
        awareness: 0.86,
        stamina: 1.44,
        strength: 0.1,
      },
      LW: {
        pace: 5.16,
        acceleration: 6.28,
        shooting: 11.51,
        power: 0.1,
        longShots: 0.1,
        penalties: 0.1,
        heading: 0.84,
        shortPassing: 13.17,
        longPassing: 2.14,
        crossing: 11.22,
        vision: 9.27,
        dribbling: 18.0,
        control: 15.0,
        composure: 1.71,
        defending: 0.1,
        awareness: 0.8,
        stamina: 4.0,
        strength: 0.5,
      },
      RW: {
        pace: 5.16,
        acceleration: 6.28,
        shooting: 11.51,
        power: 0.1,
        longShots: 0.1,
        penalties: 0.1,
        heading: 0.84,
        shortPassing: 13.17,
        longPassing: 2.14,
        crossing: 11.22,
        vision: 9.27,
        dribbling: 18.0,
        control: 15.0,
        composure: 1.71,
        defending: 0.1,
        awareness: 0.8,
        stamina: 4.0,
        strength: 0.5,
      },
      LM: {
        pace: 5.16,
        acceleration: 6.28,
        shooting: 11.51,
        power: 0.1,
        longShots: 0.1,
        penalties: 0.1,
        heading: 0.84,
        shortPassing: 13.17,
        longPassing: 2.14,
        crossing: 11.22,
        vision: 9.27,
        dribbling: 18.0,
        control: 15.0,
        composure: 1.71,
        defending: 0.1,
        awareness: 0.8,
        stamina: 4.0,
        strength: 0.5,
      },
      RM: {
        pace: 5.16,
        acceleration: 6.28,
        shooting: 11.51,
        power: 0.1,
        longShots: 0.1,
        penalties: 0.1,
        heading: 0.84,
        shortPassing: 13.17,
        longPassing: 2.14,
        crossing: 11.22,
        vision: 9.27,
        dribbling: 18.0,
        control: 15.0,
        composure: 1.71,
        defending: 0.1,
        awareness: 0.8,
        stamina: 4.0,
        strength: 0.5,
      },
      ST: {
        pace: 4.05,
        acceleration: 3.98,
        shooting: 27.96,
        power: 11.31,
        longShots: 2.38,
        penalties: 0.1,
        heading: 14.0,
        shortPassing: 6.02,
        longPassing: 0.1,
        crossing: 0.27,
        vision: 0.65,
        dribbling: 6.66,
        control: 12.83,
        composure: 4.36,
        defending: 0.1,
        awareness: 0.62,
        stamina: 1.61,
        strength: 3.0,
      },
    },
    roleOffsets: {
      GK: 0,
      CB: 0.25,
      LB: 1.5,
      RB: 1.5,
      DM: 1,
      CM: 0.25,
      AM: 0.5,
      LM: 1.25,
      RM: 1.25,
      LW: 1.25,
      RW: 1.25,
      ST: 1,
    },
    familiarityBase: 0.72,
    familiarityBonus: 0.28,
    familiarityDecay: 1.4,
    secondaryDistance: 0.025,
    unfamiliarFit: 0.6,
    storedTendencyWeight: 0.7,
  },
  badges: {
    tendencies: {
      advance: {
        speedster: 0.1,
        givego: 0.06,
        latearrival: 0.08,
        overlap: 0.06,
        anchor: -0.1,
      },
      risk: {
        vision: 0.1,
        through: 0.08,
        longball: 0.06,
        pressescape: -0.06,
      },
      carry: {
        dribbler: 0.22,
        control: 0.1,
        shield: 0.04,
        onetouch: -0.18,
        slalom: 0.13,
        pressescape: 0.1,
        givego: -0.08,
      },
      roam: {
        vision: 0.1,
        cutback: 0.05,
        givego: 0.06,
        overlap: 0.05,
        anchor: -0.1,
      },
      overlap: {
        crosser: 0.05,
        overlap: 0.2,
      },
      aggression: {
        ballwinner: 0.18,
        engine: 0.08,
        marker: 0.03,
        anchor: -0.08,
      },
      discipline: {
        ballwinner: -0.07,
        interceptor: 0.07,
        pressescape: 0.08,
        anchor: 0.12,
      },
      timing: {
        through: 0.05,
        givego: 0.1,
        latearrival: 0.15,
        finisher: 0.05,
      },
      shoot: {
        longshot: 0.16,
        finisher: 0.14,
        power: 0.08,
        vision: -0.04,
        knuckle: 0.05,
      },
      hold: { shield: 0.08, givego: -0.08, latearrival: -0.05, anchor: 0.18 },
      inside: { curve: 0.07, slalom: 0.06 },
      aerial: { heading: 0.14, volley: 0.08 },
      sweep: { gkcommand: 0.1 },
    },
    attributeCap: 5,
    boosts: {
      slalom: { dribbling: 2, acceleration: 1 },
      pressescape: { control: 2, composure: 1 },
      givego: { shortPassing: 2, vision: 1 },
      latearrival: { composure: 1, shooting: 1 },
      overlap: { crossing: 2, stamina: 1 },
      anchor: { awareness: 2, defending: 1 },
      speedster: {
        pace: 2,
        acceleration: 3,
      },
      dribbler: {
        dribbling: 3,
      },
      control: {
        control: 3,
      },
      vision: {
        vision: 3,
      },
      through: {
        shortPassing: 2,
        vision: 2,
      },
      crosser: {
        crossing: 3,
      },
      cutback: {
        crossing: 2,
        shortPassing: 2,
      },
      finisher: {
        shooting: 3,
      },
      longshot: {
        longShots: 3,
      },
      power: {
        power: 3,
      },
      curve: {
        shooting: 2,
        longShots: 2,
      },
      knuckle: {
        longShots: 2,
        power: 2,
      },
      onetouch: {
        shortPassing: 2,
        control: 2,
      },
      heading: {
        heading: 3,
      },
      shield: {
        strength: 3,
        control: 1,
      },
      penalty: {
        penalties: 4,
        composure: 1,
      },
      volley: {
        shooting: 2,
        heading: 2,
      },
      longball: {
        longPassing: 3,
      },
      ballwinner: {
        defending: 3,
      },
      interceptor: {
        awareness: 3,
      },
      marker: {
        awareness: 2,
        defending: 2,
      },
      recovery: {
        acceleration: 2,
        awareness: 2,
      },
      engine: {
        stamina: 3,
      },
      safehands: {
        goalkeeping: 1,
      },
      reflexes: {
        goalkeeping: 1,
      },
      distributor: {
        longPassing: 3,
        shortPassing: 2,
      },
      gkreach: {
        goalkeeping: 2,
      },
      gkoneonone: {
        composure: 2,
      },
      gkcommand: {
        awareness: 3,
        control: 2,
      },
      gkfeet: {
        control: 3,
        shortPassing: 3,
      },
    },
  },
};
const STORAGE_KEY = 'football-draft-settings-v1';
// 9: only differences from the defaults are stored. Keys that are no longer settings (the
// pre-overhaul draft's budget, re-spin and league/club odds, its AI opponent and display
// settings) are ignored on load and dropped on the next save.
const SETTINGS_VERSION = 9;
const clone = x => JSON.parse(JSON.stringify(x));
const at = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
const put = (o, path, value) => {
  const keys = path.split('.');
  let next = o;
  for (const key of keys.slice(0, -1)) next = next[key] ??= {};
  next[keys.at(-1)] = value;
};
const isPlainObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
/** The CONFIG_FIELDS entry for a settings path, or null. */
export function configField(path) {
  return CONFIG_FIELDS.find(f => f.path === path) || null;
}
const labels = {
  controlQuality: 'Ball-control stat influence',
  passingQuality: 'Passing stat influence',
  defensiveQuality: 'Defensive reading stat influence',
  creativeQuality: 'Creative ambition stat influence',
  routinePassError: 'Simple pass scatter multiplier',
  difficultPassError: 'Pressured / ambitious pass scatter multiplier',
  teamCharacter: 'Team style influence',
  yellowSeverity: 'Yellow-card severity multiplier',
  redSeverity: 'Straight-red severity multiplier',
  bookedFoulRisk: 'Booked player foul-risk multiplier',
  bookedRiskAversion: 'Booked player risky-challenge avoidance',
  qualityImpact: 'Attribute difference impact (1 = original)',
  movementSpeed: 'Player speed',
  acceleration: 'Acceleration',
  shotFrequency: 'Shooting willingness',
  shotScatter: 'Shot scatter',
  shotPower: 'Shot power',
  saveAbility: 'Keeper save ability',
  passCompletion: 'Pass completion quality',
  passError: 'Pass scatter',
  passSpeed: 'Pass speed',
  interceptionReach: 'Interception reach',
  dribbleSuccess: 'Take-on success',
  dribbleLoss: 'Loose dribbling touches',
  tackleSuccess: 'Clean tackle success',
  foulFrequency: 'Foul likelihood',
  penaltyPrecision: 'Penalty accuracy',
  firstTouchError: 'First-touch error',
  receptionError: 'Routine reception error multiplier',
  difficultReceptionError: 'Difficult reception error multiplier',
  markingDistance: 'Marking distance',
  pressDistance: 'Pressing distance',
  restartSetup: 'Restart preparation time',
  markingLapses: 'Marking lapses (ball-watching)',
  deliveryDeflections: 'Deflected deliveries in the box',
  runsInBehind: 'Runs in behind the defensive line',
  crossWillingness: 'Crossing willingness',
  keeperRange: 'Keeper rating influence',
  minimumLeaguePlayers: 'Minimum league player pool',
  minimumFit: 'Club XI minimum position fit',
  halftimeRecovery: 'Half-time stamina recovery',
  halftimeVariation: 'Recovery variation',
  drain: 'Match stamina usage',
  sprintDrain: 'Sprint reserve usage',
  sprintRecovery: 'Sprint reserve recovery',
  firstHalfMean: 'First-half added time mean',
  secondHalfMean: 'Second-half added time mean',
  standardDeviation: 'Added time variation',
  storedTendencyWeight: 'Source tendency contribution',
  attributeCap: 'Total badge boost per attribute',
  shotUrge: 'Box shooting willingness',
  rangeUrge: 'Long-shot willingness',
  spread: 'Shot spread',
  saveBoost: 'Keeper save adjustment',
  deliveryError: 'Delivery error',
  decisionTime: 'Decision time',
  finishPatience: 'Finishing patience',
  readWindow: 'Defensive reading window',
  directness: 'Attacking directness',
  release: 'Release delay',
  runSupport: 'Supporting runs',
  passUrge: 'Passing willingness',
  deepUrge: 'Deep build-up urgency',
};
const ranges = {
  yellowSeverity: [0, 3, 0.01],
  redSeverity: [0, 3, 0.01],
  bookedFoulRisk: [0, 1, 0.01],
  bookedRiskAversion: [0, 1, 0.01],
  minimumLeaguePlayers: [1, 20, 1],
  minimumFit: [0.6, 1, 0.01],
  coachInterval: [1, 30, 1],
  halftimeRecovery: [0, 0.4, 0.01],
  halftimeVariation: [0, 2, 0.05],
  firstHalfMean: [0, 10, 0.25],
  secondHalfMean: [0, 10, 0.25],
  standardDeviation: [0, 4, 0.1],
  storedTendencyWeight: [0, 1, 0.05],
  attributeCap: [0, 15, 1],
  familiarityBase: [0.4, 0.9, 0.01],
  familiarityBonus: [0.1, 0.6, 0.01],
  familiarityDecay: [0.1, 3, 0.05],
  secondaryDistance: [0, 0.2, 0.005],
  unfamiliarFit: [0.2, 0.8, 0.01],
};
// Draft-session settings (draft.nations / leagueTierWeights / clubs / rerolls / ladder / links):
// [label, min, max, step] by path prefix, longest match wins.
const DRAFT_FIELDS = {
  'draft.nations.fieldSize': ['Nations in the field', 8, 64, 1],
  'draft.nations.potSize': ['Nations per pot', 1, 64, 1],
  'draft.nations.minimumPlayers': ['Eligible nation: minimum players', 11, 60, 1],
  'draft.nations.minimumGoalkeepers': ['Eligible nation: minimum goalkeepers', 1, 5, 1],
  'draft.nations.squadSize': ['Call-ups per spin', 11, 40, 1],
  'draft.nations.squadGoalkeepers': ['Call-ups: goalkeepers', 1, 5, 1],
  'draft.nations.squadDefenders': ['Call-ups: at least defenders', 0, 15, 1],
  'draft.nations.squadMidfielders': ['Call-ups: at least midfielders', 0, 15, 1],
  'draft.nations.squadAttackers': ['Call-ups: at least attackers', 0, 15, 1],
  'draft.leagueTierWeights.': [null, 0, 20, 0.05],
  'draft.clubs.minimumPlayers': ['Spinnable club: minimum players', 1, 30, 1],
  'draft.clubs.tierWeights.': [null, 0, 20, 0.05],
  'draft.clubs.leagueTierWeights.': [null, 0, 50, 0.05],
  'draft.rerolls.': [null, 0, 5, 1],
  'draft.ladder.': [null, -15, 15, 0.5],
  'draft.links.': [null, 1, 11, 1],
  'draft.links.maxChem': ['Maximum link boost (attribute points)', 0, 4, 0.25],
};
const LEVEL_LABELS = {
  amateur: 'Amateur',
  semipro: 'Semi-pro',
  pro: 'Pro',
  worldclass: 'World Class',
  legendary: 'Legendary',
  level1: 'Level 1 at … players',
  level2: 'Level 2 at … players',
  level3: 'Level 3 at … players',
};
const draftField = path => {
  const key = Object.keys(DRAFT_FIELDS)
    .filter(k => path === k || (k.endsWith('.') && path.startsWith(k)))
    .sort((a, b) => b.length - a.length)[0];
  return key ? DRAFT_FIELDS[key] : null;
};
const walk = (o, prefix = '') =>
  Object.entries(o).flatMap(([key, value]) => {
    const path = prefix ? prefix + '.' + key : key;
    return value && typeof value === 'object'
      ? walk(value, path)
      : [{ path, key, defaultValue: value }];
  });
export const CONFIG_FIELDS = walk(DEFAULT_CONFIG).map(f => {
  let [min, max, step] = ranges[f.key] || [0, 100, 0.01];
  if (f.path.startsWith('gameplay.') || ['drain', 'sprintDrain', 'sprintRecovery'].includes(f.key))
    [min, max, step] = [0.5, 2, 0.01];
  if (
    [
      'receptionError',
      'difficultReceptionError',
      'markingLapses',
      'deliveryDeflections',
      'runsInBehind',
    ].includes(f.key)
  )
    [min, max, step] = [0, 2, 0.01];
  if (['controlQuality', 'passingQuality', 'defensiveQuality', 'creativeQuality'].includes(f.key))
    [min, max, step] = [0, 2, 0.01];
  if (['routinePassError', 'difficultPassError'].includes(f.key)) [min, max, step] = [0, 4, 0.01];
  const session = draftField(f.path);
  if (session) [, min, max, step] = session;
  if (f.path.startsWith('playerTiers.') || f.path.startsWith('teamTiers.'))
    [min, max, step] = [0, f.key.startsWith('badge') ? 10 : 99, 1];
  if (f.path.startsWith('ratings.roleWeights.')) [min, max, step] = [0, 100, 0.01];
  if (f.path.startsWith('ratings.roleOffsets.')) [min, max, step] = [-10, 10, 0.25];
  if (f.path.startsWith('badges.tendencies.')) [min, max, step] = [-0.5, 0.5, 0.01];
  if (f.path.startsWith('badges.boosts.')) [min, max, step] = [0, 10, 1];
  if (f.path.startsWith('formats.'))
    [min, max, step] =
      f.key === 'saveBoost'
        ? [-1, 1, 0.01]
        : [
            ['decisionTime', 'finishPatience', 'readWindow', 'release', 'deliveryError'].includes(
              f.key,
            )
              ? 0.05
              : 0,
            f.key === 'runSupport' ? 30 : 8,
            0.005,
          ];
  if (f.path.startsWith('periods.'))
    [min, max, step] = f.key.includes('Spread')
      ? [0, 5, 0.1]
      : f.key.includes('Mean')
        ? [0, 15, 0.25]
        : [0, 15, 1];
  return {
    ...f,
    label:
      session?.[0] ||
      (session && LEVEL_LABELS[f.key]) ||
      labels[f.key] ||
      f.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()),
    min,
    max,
    step,
  };
});
// Whole-config rules that single fields cannot express. In lenient mode (loading saved
// settings) a broken rule resets only the named groups to their defaults, with a warning.
const CROSS_FIELD_RULES = [
  {
    message: 'Badge minimum cannot exceed its maximum.',
    reset: ['playerTiers'],
    ok: c => Object.values(c.playerTiers).every(t => t.badgeMinimum <= t.badgeMaximum),
  },
  {
    message: 'Player tier thresholds must descend.',
    reset: ['playerTiers'],
    ok: c =>
      Object.values(c.playerTiers).every((t, i, rows) => !i || rows[i - 1].minimum > t.minimum),
  },
  {
    message: 'Team tier thresholds must descend.',
    reset: ['teamTiers'],
    ok: c => Object.values(c.teamTiers).every((v, i, rows) => !i || rows[i - 1] > v),
  },
  {
    message: 'At least one league tier must have a positive draw weight.',
    reset: ['draft.leagueTierWeights'],
    ok: c => Object.values(c.draft.leagueTierWeights).some(v => v > 0),
  },
  ...['draft.clubs.leagueTierWeights', 'draft.clubs.tierWeights'].map(path => ({
    message: 'At least one tier must have a positive draw weight.',
    reset: [path],
    ok: c => Object.values(at(c, path)).some(v => v > 0),
  })),
  {
    message: 'Bench and F must start at zero to cover every rating.',
    reset: ['playerTiers', 'teamTiers'],
    ok: c => c.playerTiers.Bench.minimum === 0 && c.teamTiers.F === 0,
  },
  {
    message: 'Call-up minimums cannot exceed the call-up size.',
    reset: ['draft.nations'],
    ok: ({ draft: { nations: n } }) =>
      n.squadGoalkeepers + n.squadDefenders + n.squadMidfielders + n.squadAttackers <= n.squadSize,
  },
  {
    message: 'Link thresholds must rise from level 1 to level 3.',
    reset: ['draft.links'],
    ok: c =>
      ['club', 'nation', 'league'].every(
        k =>
          c.draft.links[k].level1 <= c.draft.links[k].level2 &&
          c.draft.links[k].level2 <= c.draft.links[k].level3,
      ),
  },
  {
    message: 'Minimum added time exceeds maximum.',
    reset: ['periods'],
    ok: c => c.periods.minimum <= Math.min(c.periods.firstHalfMaximum, c.periods.secondHalfMaximum),
  },
  {
    message: 'Position familiarity base and bonus must total at most 1.',
    reset: ['ratings.familiarityBase', 'ratings.familiarityBonus'],
    ok: c => c.ratings.familiarityBase + c.ratings.familiarityBonus <= 1.001,
  },
  ...Object.keys(DEFAULT_CONFIG.ratings.roleWeights).map(role => ({
    message: role + ' needs a positive overall weight.',
    reset: ['ratings.roleWeights.' + role],
    ok: c => Object.values(c.ratings.roleWeights[role]).reduce((s, v) => s + v, 0) > 0,
  })),
];
// Why a value cannot be used for a field, or '' when it can.
function fieldProblem(field, value) {
  if (typeof field.defaultValue === 'boolean')
    return typeof value === 'boolean' ? '' : field.label + ' must be on or off.';
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < field.min ||
    value > field.max
  )
    return field.path + ' must be between ' + field.min + ' and ' + field.max + '.';
  if (field.step === 1 && !Number.isInteger(value)) return field.label + ' must be a whole number.';
  return '';
}
/**
 * Validate a (possibly partial) settings object against DEFAULT_CONFIG and return a complete
 * configuration. Missing fields take their defaults; unknown keys (including settings that
 * no longer exist) are ignored silently.
 * Strict (default): the first invalid value throws (the config page shows the message).
 * Lenient ({ lenient: true }, used when loading saved settings): an invalid value is dropped
 * with a warning and only that field (or the group a cross-field rule names) falls back.
 */
export function normalizeConfig(input = {}, { lenient = false, warn = defaultWarn } = {}) {
  if (!isPlainObject(input)) {
    if (!lenient) throw Error('Settings must be an object.');
    warn('Ignoring settings that are not an object.');
    input = {};
  }
  const out = clone(DEFAULT_CONFIG);
  for (const field of CONFIG_FIELDS) {
    const value = at(input, field.path);
    if (value === undefined) continue;
    const problem = fieldProblem(field, value);
    if (!problem) put(out, field.path, value);
    else if (!lenient) throw Error(problem);
    else warn(`Ignoring saved setting ${field.path}=${JSON.stringify(value)}: ${problem}`);
  }
  for (const rule of CROSS_FIELD_RULES)
    if (!rule.ok(out)) {
      if (!lenient) throw Error(rule.message);
      warn(`Resetting ${rule.reset.join(', ')} to defaults: ${rule.message}`);
      for (const path of rule.reset) put(out, path, clone(at(DEFAULT_CONFIG, path)));
    }
  return out;
}
function defaultWarn(...args) {
  globalThis.console?.warn?.('[settings]', ...args);
}
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. storage blocked by the browser
  }
}
const fnv1a = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};
let v8Defaults = null;
// Settings saved before version 9 were full snapshots: drop every leaf that still holds its
// version-8 default, so it follows the current default instead of pinning the old one.
function dropUntouchedV8Defaults(saved) {
  v8Defaults ??= new Set(V8_DEFAULT_SIGNATURE.match(/.{7}/g).map(h => parseInt(h, 36)));
  (function prune(o, prefix) {
    for (const [key, value] of Object.entries(o)) {
      const path = prefix ? prefix + '.' + key : key;
      if (isPlainObject(value)) {
        prune(value, path);
        if (!Object.keys(value).length) delete o[key];
      } else if (v8Defaults.has(fnv1a(path + '=' + JSON.stringify(value)))) delete o[key];
    }
  })(saved, '');
}
/** Only the settings that differ from `base`. */
export function configDiff(value, base = DEFAULT_CONFIG) {
  const diff = {};
  for (const field of CONFIG_FIELDS) {
    const v = at(value, field.path);
    if (v !== undefined && v !== at(base, field.path)) put(diff, field.path, v);
  }
  return diff;
}
// Version upgrades of saved settings, oldest format first. Each rewrites only unchanged old
// defaults; customised values and imported match configurations keep their chosen values.
function migrateSaved(saved) {
  const version = saved?._settingsVersion ?? 0;
  delete saved._settingsVersion;
  // Moderate only unchanged device defaults. Explicit custom settings and
  // imported match configurations keep their chosen influence values.
  if (version < 8)
    for (const [key, old] of Object.entries({
      qualityImpact: 1.08,
      controlQuality: 1.4,
      passingQuality: 1.6,
      defensiveQuality: 1,
      creativeQuality: 1,
    }))
      if (saved?.gameplay?.[key] === old) saved.gameplay[key] = DEFAULT_CONFIG.gameplay[key];
  if (version < 7)
    for (const [key, old] of [
      ['receptionError', 0.75],
      ['difficultReceptionError', 1.05],
    ])
      if (saved?.gameplay?.[key] === old) saved.gameplay[key] = DEFAULT_CONFIG.gameplay[key];
  if (version < 6)
    for (const key of ['longBallPreference', 'clearanceWillingness'])
      if (saved?.gameplay?.[key] === 1) saved.gameplay[key] = DEFAULT_CONFIG.gameplay[key];
  if (version < 5) {
    for (const [key, old] of [
      ['receptionError', 0.18],
      ['difficultReceptionError', 0.55],
      ['tackleSuccess', 0.94],
      ['shotFrequency', 1.24],
    ])
      if (saved?.gameplay?.[key] === old) saved.gameplay[key] = DEFAULT_CONFIG.gameplay[key];
    for (const [duration, old] of [
      [180, -0.5],
      [300, -0.27],
    ])
      if (saved?.formats?.[duration]?.saveBoost === old)
        saved.formats[duration].saveBoost = DEFAULT_CONFIG.formats[duration].saveBoost;
  }
  if (version < 4 && saved?.gameplay?.tackleSuccess === 1)
    saved.gameplay.tackleSuccess = DEFAULT_CONFIG.gameplay.tackleSuccess;
  if (version < 4)
    for (const [duration, old] of [
      [180, -0.6],
      [300, -0.37],
    ])
      if (saved?.formats?.[duration]?.saveBoost === old)
        saved.formats[duration].saveBoost = DEFAULT_CONFIG.formats[duration].saveBoost;
  if (version < 2) {
    if (saved?.playerTiers?.Superstar?.minimum === 83) saved.playerTiers.Superstar.minimum = 85;
    // Migrate only unchanged role defaults, leaving custom weights and replays intact.
    const priorWeights = {
      GK: 3070697025,
      CB: 3528548659,
      LB: 917603,
      RB: 917603,
      DM: 4285413286,
      CM: 3983548147,
      AM: 1207724980,
      LW: 2493809455,
      RW: 2493809455,
      LM: 3102840154,
      RM: 3102840154,
      ST: 3884776852,
    };
    const priorOffsets = {
      GK: 0,
      CB: 2.5,
      LB: 2,
      RB: 2,
      DM: 1.75,
      CM: 0.5,
      AM: 2,
      LM: 3,
      RM: 3,
      LW: 1,
      RW: 1,
      ST: 1.5,
    };
    const signature = weights =>
      [
        ...Object.keys(weights)
          .sort()
          .map(k => k + ':' + weights[k])
          .join(','),
      ].reduce((hash, c) => (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0, 0);
    for (const role of Object.keys(priorWeights)) {
      const weights = saved?.ratings?.roleWeights?.[role];
      if (weights && signature(weights) === priorWeights[role])
        saved.ratings.roleWeights[role] = clone(DEFAULT_CONFIG.ratings.roleWeights[role]);
      if (saved?.ratings?.roleOffsets?.[role] === priorOffsets[role])
        saved.ratings.roleOffsets[role] = DEFAULT_CONFIG.ratings.roleOffsets[role];
    }
  }
  // Upgrade unchanged device defaults, while replay imports retain their original physics.
  if (saved?.display?.commentaryInterval !== undefined && saved.gameplay) {
    for (const [key, old] of Object.entries({
      movementSpeed: 1.03,
      acceleration: 1.03,
      shotFrequency: 1.12,
      passSpeed: 1,
    }))
      if (saved.gameplay[key] === old) saved.gameplay[key] = DEFAULT_CONFIG.gameplay[key];
  }
  if (version < 9) dropUntouchedV8Defaults(saved);
  return saved;
}
/**
 * Load saved settings. Never throws: unreadable storage or JSON falls back to the defaults, and
 * an invalid saved value is dropped field by field with a console warning.
 */
export function loadConfig({ storage = defaultStorage(), warn = defaultWarn } = {}) {
  let saved = {};
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {
    warn('Saved settings could not be read; using the defaults.', e?.message || e);
  }
  if (!isPlainObject(saved)) {
    warn('Ignoring saved settings that are not an object.');
    saved = {};
  }
  try {
    migrateSaved(saved);
    return normalizeConfig(saved, { lenient: true, warn });
  } catch (e) {
    warn('Saved settings are unusable; using the defaults.', e?.message || e);
    return clone(DEFAULT_CONFIG);
  }
}
/** Validate strictly (throws on an invalid value), store only the differences from the defaults. */
export function saveConfig(value, { storage = defaultStorage(), warn = defaultWarn } = {}) {
  const next = normalizeConfig(value);
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...configDiff(next), _settingsVersion: SETTINGS_VERSION }),
    );
  } catch (e) {
    warn('Settings could not be saved on this device.', e?.message || e);
  }
  return next;
}
export const CONFIG = loadConfig();
function copyInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object') {
      target[key] ??= {};
      copyInto(target[key], value);
    } else target[key] = value;
  }
}
export function setRuntimeConfig(value) {
  copyInto(CONFIG, normalizeConfig(value));
  return CONFIG;
}
export { at as configValue, put as setConfigValue };
