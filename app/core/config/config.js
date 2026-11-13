// One set of named tuning inputs, shared by every game mode.
export const DEFAULT_CONFIG = {
  // Draft session (core/draft/session.js, pools.js, opponents.js, links.js).
  draft: {
    // A league needs this many players to be drawn (league and club drafts).
    minimumLeaguePlayers: 5,
    // Drafts offer only players the game shows at this rating or more at their own position
    // (the rounded number on the card): in every draft pool, every guard that asks "can this
    // spin still fill an open slot", and the Daily's perfect XI. Teams are not drafts: the XIs
    // of opponents, clubs and nations keep their real players whatever they are rated.
    pickMinimum: 65,
    // Nations: a nation is playable — on the reel, met as an opponent — when it can field an
    // XI (>= minimumPlayers, >= minimumGoalkeepers and a best XI with nobody under the
    // engine's minimum fit, ai.minimumFit). `fieldSize` / `potSize` are only the real World Cup
    // draw (Legendary) and the Daily's schedule: the strongest playable nations, in pots.
    nations: {
      fieldSize: 48,
      potSize: 12,
      minimumPlayers: 11,
      minimumGoalkeepers: 1,
      // Only the strongest `playableSize` nations that can field an XI are playable.
      playableSize: 56,
      // The real World Cup draw (Legendary) qualifies its own 48 for every run: the strongest
      // `fieldCore` playable nations are always in, the other seats are drawn from the rest
      // with odds that halve every `fieldHalving` rating points below the last core nation.
      fieldCore: 30,
      fieldHalving: 1.5,
      // Star nations: nations that are not playable (no XI, or an XI outside the strongest
      // `playableSize`) but are still on the reel because they have a star — at least one player rated reelStar or better and reelPlayers players
      // (no keeper needed: they are spun, never met as opponents).
      reelStar: 80,
      reelPlayers: 9,
      // A nation's draft squad (draft/pools.js draftSquad): the only players a nation spin
      // ever offers — its best `squadSize` among the players a draft may offer (pickMinimum),
      // with that many keepers and at least that many defenders, midfielders and attackers so
      // every position can be filled. A spin's pool is those of them still available; it never
      // refills from deeper in the nation. Teams (opponents, strength, playable) keep everyone.
      squadSize: 30,
      squadGoalkeepers: 3,
      squadDefenders: 9,
      squadMidfielders: 9,
      squadAttackers: 5,
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
    // Tokens per drafter, the same on every difficulty. World Cup drafts (an era and a nation
    // per spin): `nation` respins keep the era and spin the nation again, `era` respins spin
    // the era again (the nation stays when the new era has it), `prime` turns a drafted player
    // into his best version across all titles. The other drafts have `nation` re-rolls only.
    tokens: {
      nation: 1,
      era: 1,
      prime: 1,
    },
    // Reel weights of a World Cup draft (draft/reels.js; never shown): famous, deep squads come
    // up more often, nobody is shut out. A nation: quality q(r) = (r − floor) / span (0…1) of
    // its 2nd, 3rd and 4th best, of the mean of its 5th–8th and of its best player, plus its
    // size (players / 26), each times its points; weight = 1 + lift · (score / top score)^curve.
    // An era: 1 + nations · (its nations / 70) + top · q(median of its nations' best players).
    reels: {
      era: {
        nations: 0.25,
        top: 0.25,
      },
      nation: {
        floor: 72,
        span: 20,
        second: 5,
        third: 3,
        fourth: 2,
        depth: 1,
        best: 1,
        size: 2.5,
        lift: 4,
        curve: 2,
        // A squad with an all-timer (its best shown rareFrom or more) keeps this share of its
        // weight: the greatest stay an event.
        rareFrom: 93,
        rare: 0.25,
      },
    },
    // Opponent strength vs the mode's typical drafted XI (effective rating, links included).
    ladder: {
      pro: 0,
      worldclass: 4,
      legendary: 7,
    },
    // Mates (draft/links.js): attribute points for a player with a nation team-mate and for
    // one with a club mate in the XI — one mate is enough, and the two stack (+2.5 with both).
    // `captain`: an XI with a Captain (catalog `captain`, data/captains.json) gives every
    // player this much on top (one captain counts).
    links: {
      nation: 1.5,
      club: 1,
      captain: 1,
      // A GOAT (an era card flagged `goat`: one of the few greatest, in his year) gives every
      // player of the XI this much — about +5 points of title odds on World Class; each
      // further GOAT adds half of what the one before added.
      goat: 1.5,
    },
    // The draft's player tiers (draft/budget.js), by the rating shown on the player, highest
    // first: `minimum` is where the tier starts (these are the tiers the game shows: frames,
    // outlines, pick celebrations) and `slots` how many of them a Budget-mode XI may hold
    // (session option `budget`). Players under Starter (Normal, Bench) are free.
    budget: {
      Superstar: {
        minimum: 88,
        slots: 2,
      },
      Star: {
        minimum: 84,
        slots: 2,
      },
      Starter: {
        minimum: 80,
        slots: 3,
      },
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
    minimumFit: 0.965,
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
    qualityImpact: 1.25,
    controlQuality: 0.55,
    passingQuality: 0.65,
    defensiveQuality: 0.55,
    creativeQuality: 0.65,
    movementSpeed: 1.28,
    acceleration: 1.1,
    shotFrequency: 2,
    shotScatter: 0.92,
    shotPower: 1,
    saveAbility: 0.97,
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
    markingLapses: 0,
    deliveryDeflections: 1,
    runsInBehind: 1,
    crossWillingness: 1.5,
    keeperRange: 1,
    // The level of the match (sim/match.js kickoffLevel: the mean overall of the 22 at
    // kick-off, against 78): a fixture between two star XIs used to score half as much again
    // as one between two modest clubs — better finishers hit the target far more often and
    // nothing answered it. Shots scatter a little more and keepers hold a little more the
    // higher the level of the match, the same for both sides (so who is better, and by how
    // much, counts as before). 0 switches either off.
    levelScatter: 1.5,
    levelSaves: 1,
    // … and a mismatch counts as a higher level: this many points per point of overall
    // between the two sides (a one-sided match used to be the highest-scoring of all).
    levelGap: 0.8,
  },
  // The player's side as favourite. Against the AI (competition.mode 'ai'), when the player's
  // XI (team 0) has the higher overall, its shots are saved a little less and the shots it
  // faces a little more: `perPoint` of the save chance per point of overall it is ahead, at
  // most `cap` (a 5-point favourite: about +3% on its conversion, -3% on the opponent's).
  // Never for the weaker side, never in Versus or Exhibition. Read once, at kick-off
  // (match.edge); the fast rating model (competition/model.js) does not include it.
  userEdge: {
    perPoint: 0.006,
    cap: 0.05,
  },
  // What a mentality changes, as differences from Balanced (which is all zeros). Push raises
  // the chance of a goal at both ends, Hold lowers it at both ends (docs/calibration.md).
  mentality: {
    push: {
      line: 8,
      attacking: 20,
      restDefence: 0,
      runners: 0,
      shotUrge: 0.15,
      ambition: 0,
      turnoverCost: 0,
      join: 0.12,
      lateRuns: 0.1,
      pressing: 0,
      restartTime: -0.15,
      load: 0.05,
      chances: 0.55,
      exposure: 0.3,
    },
    hold: {
      line: -10,
      attacking: -20,
      restDefence: 0,
      runners: 0,
      shotUrge: -0.15,
      ambition: -0.03,
      turnoverCost: 0.25,
      join: -0.12,
      lateRuns: -0.1,
      pressing: 0,
      restartTime: 0.25,
      load: -0.05,
      chances: -0.33,
      exposure: -0.24,
    },
    // Rewards for the well-timed choice, read from the score at that moment.
    chase: 0.1,
    protect: 0.1,
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
    // Announced added time (minutes): 1.5 and 2 on average since the whistle waits for an
    // attack to finish (they were 2 and 3; the minute and a half pays for the goals that
    // scores, docs/calibration.md).
    firstHalfMean: 1.5,
    secondHalfMean: 2,
    firstHalfSpread: 0.8,
    secondHalfSpread: 1,
    minimum: 1,
    firstHalfMaximum: 5,
    secondHalfMaximum: 6,
    // The whistle is held for an attack that is on when time runs out (sim/whistle.js): the
    // attackers on the ball within holdRange metres of the goal line, for at most holdAttack
    // seconds of play (and again from the delivery of a set piece they win); at most
    // holdCorners corners awarded after time was up are taken; nothing new is waited for
    // beyond holdMaximum seconds. Real seconds: 2 are a minute on the match clock.
    holdRange: 30,
    holdAttack: 4,
    holdCorners: 1,
    holdMaximum: 10,
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
      saveBoost: -0.16,
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
      CB: 0.5,
      LB: 2,
      RB: 2,
      DM: 1.25,
      CM: 0.5,
      AM: 0.5,
      LM: 1.25,
      RM: 1.25,
      LW: 1.25,
      RW: 1.25,
      ST: 1,
    },
    topFrom: 78,
    topLift: 0.1,
    familiarityBase: 0.72,
    familiarityBonus: 0.28,
    familiarityDecay: 0.235,
    secondaryDistance: 0.4,
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
const clone = x => JSON.parse(JSON.stringify(x));
const at = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
const put = (o, path, value) => {
  const keys = path.split('.');
  let next = o;
  for (const key of keys.slice(0, -1)) next = next[key] ??= {};
  next[keys.at(-1)] = value;
};
const isPlainObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const labels = {
  perPoint: "Player's side as favourite: save-chance edge per point of overall",
  cap: "Player's side as favourite: largest edge",
  topFrom: 'Overall: stretch ratings above',
  topLift: 'Overall: extra per point above that',
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
  levelScatter: 'Match level: shot scatter',
  levelSaves: 'Match level: keeper saves',
  levelGap: 'Match level: points per point between the sides',
  minimumLeaguePlayers: 'Minimum league player pool',
  minimumFit: 'Club XI minimum position fit',
  halftimeRecovery: 'Half-time stamina recovery',
  halftimeVariation: 'Recovery variation',
  drain: 'Match stamina usage',
  sprintDrain: 'Sprint reserve usage',
  sprintRecovery: 'Sprint reserve recovery',
  firstHalfMean: 'First-half added time mean',
  secondHalfMean: 'Second-half added time mean',
  holdRange: 'Whistle held for an attack within (m of the goal line)',
  holdAttack: 'Whistle held: seconds an attack gets',
  holdCorners: 'Whistle held: corners awarded after time that are taken',
  holdMaximum: 'Whistle held: longest wait (seconds)',
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
  perPoint: [0, 0.05, 0.001],
  cap: [0, 0.25, 0.005],
  yellowSeverity: [0, 3, 0.01],
  redSeverity: [0, 3, 0.01],
  bookedFoulRisk: [0, 1, 0.01],
  bookedRiskAversion: [0, 1, 0.01],
  minimumLeaguePlayers: [1, 20, 1],
  minimumFit: [0.6, 1, 0.005],
  coachInterval: [1, 30, 1],
  halftimeRecovery: [0, 0.4, 0.01],
  halftimeVariation: [0, 2, 0.05],
  firstHalfMean: [0, 10, 0.25],
  secondHalfMean: [0, 10, 0.25],
  storedTendencyWeight: [0, 1, 0.05],
  attributeCap: [0, 15, 1],
  topFrom: [50, 99, 0.5],
  topLift: [0, 1, 0.01],
  familiarityBase: [0.4, 0.9, 0.01],
  familiarityBonus: [0.1, 0.6, 0.01],
  familiarityDecay: [0.05, 3, 0.005],
  secondaryDistance: [0, 2, 0.005],
  unfamiliarFit: [0.2, 0.8, 0.01],
};
// Draft-session settings (draft.nations / leagueTierWeights / clubs / tokens / ladder / links):
// [label, min, max, step] by path prefix, longest match wins.
const DRAFT_FIELDS = {
  'draft.nations.fieldSize': ['Nations in the field', 8, 64, 1],
  'draft.nations.potSize': ['Nations per pot', 1, 64, 1],
  'draft.nations.playableSize': ['Playable nations: the strongest that can field an XI', 8, 250, 1],
  'draft.nations.fieldCore': ['World Cup draw: nations always in', 0, 64, 1],
  'draft.nations.fieldHalving': [
    'World Cup draw: rating points that halve the odds',
    0.25,
    10,
    0.25,
  ],
  'draft.nations.reelStar': ['Reel nation without an XI: best player at least', 60, 99, 1],
  'draft.nations.reelPlayers': ['Reel nation without an XI: minimum players', 1, 30, 1],
  'draft.nations.minimumPlayers': ['Eligible nation: minimum players', 11, 60, 1],
  'draft.pickMinimum': ['Draft: a player can be picked from this rating', 0, 85, 1],
  'draft.nations.minimumGoalkeepers': ['Eligible nation: minimum goalkeepers', 1, 5, 1],
  'draft.nations.squadSize': ['Draftable players per nation', 11, 40, 1],
  'draft.nations.squadGoalkeepers': ['Draftable per nation: goalkeepers', 1, 5, 1],
  'draft.nations.squadDefenders': ['Draftable per nation: at least defenders', 0, 15, 1],
  'draft.nations.squadMidfielders': ['Draftable per nation: at least midfielders', 0, 15, 1],
  'draft.nations.squadAttackers': ['Draftable per nation: at least attackers', 0, 15, 1],
  'draft.leagueTierWeights.': [null, 0, 20, 0.05],
  'draft.clubs.minimumPlayers': ['Spinnable club: minimum players', 1, 30, 1],
  'draft.clubs.tierWeights.': [null, 0, 20, 0.05],
  'draft.clubs.leagueTierWeights.': [null, 0, 50, 0.05],
  'draft.tokens.nation': ['Tokens: nation respins (re-rolls)', 0, 5, 1],
  'draft.tokens.era': ['Tokens: era respins', 0, 5, 1],
  'draft.tokens.prime': ['Tokens: Primes', 0, 5, 1],
  'draft.reels.era.nations': ['Era reel: bump for the number of nations', 0, 3, 0.05],
  'draft.reels.era.top': ['Era reel: bump for the median best player', 0, 3, 0.05],
  'draft.reels.nation.floor': ['Nation reel: rating that counts for nothing', 50, 90, 1],
  'draft.reels.nation.span': ['Nation reel: rating points to full quality', 5, 40, 1],
  'draft.reels.nation.second': ['Nation reel: points for the second best', 0, 10, 0.5],
  'draft.reels.nation.third': ['Nation reel: points for the third best', 0, 10, 0.5],
  'draft.reels.nation.fourth': ['Nation reel: points for the fourth best', 0, 10, 0.5],
  'draft.reels.nation.depth': ['Nation reel: points for the 5th–8th best', 0, 10, 0.5],
  'draft.reels.nation.best': ['Nation reel: points for the best player', 0, 10, 0.5],
  'draft.reels.nation.size': ['Nation reel: points for the size of the squad', 0, 10, 0.5],
  'draft.reels.nation.lift': [
    'Nation reel: how much the best squad outweighs the weakest',
    0,
    30,
    0.5,
  ],
  'draft.reels.nation.curve': ['Nation reel: curve of the weight', 0.5, 4, 0.25],
  'draft.reels.nation.rareFrom': ['Nation reel: an all-timer is shown at least', 85, 99, 1],
  'draft.reels.nation.rare': [
    'Nation reel: share of its weight an all-timer squad keeps',
    0.05,
    1,
    0.05,
  ],
  'draft.ladder.': [null, -15, 15, 0.5],
  'draft.links.nation': ['Nation mate boost (attribute points)', 0, 4, 0.5],
  'draft.links.club': ['Club mate boost (attribute points)', 0, 4, 0.5],
  'draft.links.captain': ['Captain boost to every player (attribute points)', 0, 2, 0.25],
  'draft.links.goat': ['GOAT boost to every player (attribute points)', 0, 3, 0.25],
  'draft.budget.': [null, 0, 99, 1],
};
const LEVEL_LABELS = {
  pro: 'Pro',
  worldclass: 'World Class',
  legendary: 'Legendary',
  minimum: 'Draft tier: rating from',
  slots: 'Budget mode: players of this tier allowed',
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
      'levelScatter',
      'levelSaves',
      'levelGap',
    ].includes(f.key)
  )
    [min, max, step] = [0, 2, 0.01];
  if (['controlQuality', 'passingQuality', 'defensiveQuality', 'creativeQuality'].includes(f.key))
    [min, max, step] = [0, 2, 0.01];
  if (['routinePassError', 'difficultPassError'].includes(f.key)) [min, max, step] = [0, 4, 0.01];
  const session = draftField(f.path);
  if (session) [, min, max, step] = session;
  if (f.path.startsWith('mentality.')) [min, max, step] = [-100, 100, 0.001];
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
        : f.key === 'holdAttack' || f.key === 'holdMaximum'
          ? [0, 30, 0.5]
          : f.key === 'holdRange'
            ? [0, 52, 0.5]
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
// Whole-config rules that single fields cannot express. In lenient mode a broken rule resets only the named groups to their defaults, with a warning.
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
    message: 'A nation’s line minimums cannot exceed its draftable players.',
    reset: ['draft.nations'],
    ok: ({ draft: { nations: n } }) =>
      n.squadGoalkeepers + n.squadDefenders + n.squadMidfielders + n.squadAttackers <= n.squadSize,
  },
  {
    message: 'Mates boosts cannot total more than 5 (the engine cap).',
    reset: ['draft.links'],
    ok: ({ draft: { links: l } }) => l.nation + l.club + l.captain + l.goat <= 5,
  },
  {
    message: 'Draft tiers must descend and their Budget slots stay within an XI.',
    reset: ['draft.budget'],
    ok: ({ draft: { budget: b } }) =>
      b.Superstar.minimum > b.Star.minimum &&
      b.Star.minimum > b.Starter.minimum &&
      [b.Superstar, b.Star, b.Starter].every(x => x.slots <= 11),
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
 * Strict (default): the first invalid value throws.
 * Lenient ({ lenient: true }): an invalid value is dropped with a warning and only that field
 * (or the group a cross-field rule names) falls back.
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
    else warn(`Ignoring setting ${field.path}=${JSON.stringify(value)}: ${problem}`);
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
/**
 * The live config. Tuning is a developer job (DEFAULT_CONFIG in code; tools pass patches): the
 * game does not read players' saved overrides any more (the tuning page is gone), so every
 * device plays the same engine. Nothing is stored: setRuntimeConfig() lasts for the process.
 */
export const CONFIG = clone(DEFAULT_CONFIG);
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
