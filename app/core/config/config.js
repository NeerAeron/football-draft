// One set of named tuning inputs, shared by every game mode.
export const DEFAULT_CONFIG = {
  draft: {
    leagueWeights: {
      A: 36,
      B: 11,
      C: 3,
      D: 0.8,
      F: 0.2,
    },
    leagueOptaSlope: 0.006,
    leagueOptaLimit: 0.1,
    clubDoubleEvery: {
      A: 5,
      B: 3.5,
      C: 2.5,
    },
    minimumLeaguePlayers: 5,
    respins: {
      league: 1,
      team: 1,
    },
    respinBoosts: {
      slightlyBetter: 0.2,
      moderatelyBetter: 0.15,
      muchBetter: 0.05,
      clubSlightGap: 3,
      clubMediumGap: 7,
      leagueSlightSteps: 1,
      leagueMediumSteps: 2,
    },
    budget: {
      superstar: 2,
      star: 3,
      starter: 3,
    },
    leagueOverrides: {
      13: 1,
      19: 1,
      53: 1,
      31: 1,
      16: 1,
      7: 1,
      4: 1,
      353: 1,
      308: 1,
      14: 1,
      66: 1,
      1: 1,
      'opta:2hsidwomhjsaaytdy9u5niyi4': 1,
      336: 1,
      41: 1,
      10: 1,
      39: 1,
      2018: 1,
      68: 1,
      319: 1,
      317: 1,
      189: 1,
      54: 1,
      337: 1,
      80: 1,
      335: 1,
      63: 1,
      338: 1,
      'opta:3ab1uwtoyjopdj1y1fynyy9jg': 1,
      20: 1,
      'opta:8o5tv5viv4hy1qg9jp94k7ayb': 1,
      56: 1,
      318: 1,
      64: 1,
      'opta:byu00jvt1j6csyv4y1lkt2fm2': 1,
      2020: 1,
      50: 1,
      32: 1,
      350: 1,
      2017: 1,
      17: 1,
      2019: 1,
      'opta:2xg0qvif1rh7du6wmk2eleku3': 1,
      83: 1,
      330: 1,
      60: 1,
      'opta:1mpjd0vbxbtu9zw89yj09xk3z': 1,
      'opta:1eruend45vd20g9hbrpiggs5u': 1,
      'opta:8k1xcsyvxapl4jlsluh3eomre': 1,
      'opta:57nu0wygurzkp6fuy5hhrtaa2': 1,
    },
    clubOverrides: {
      111713: 1,
      113147: 1,
      114554: 1,
      200: 1,
      110069: 1,
      294: 1,
      1894: 1,
      1929: 1,
      1931: 1,
      111657: 1,
      112124: 1,
      110078: 1,
      1815: 1,
      115494: 1,
      1958: 1,
      111659: 1,
      110752: 1,
      110750: 1,
      110321: 1,
      111139: 1,
      1933: 1,
      110075: 1,
      1804: 1,
      1932: 1,
      1917: 1,
      110072: 1,
      114147: 1,
      9: 1,
      10: 1,
      1: 1,
      11: 1,
      5: 1,
      13: 1,
      2: 1,
      106: 1,
      18: 1,
      7: 1,
      19: 1,
      14: 1,
      1808: 1,
      144: 1,
      1799: 1,
      8: 1,
      1925: 1,
      1943: 1,
      1796: 1,
      110: 1,
      21: 1,
      22: 1,
      32: 1,
      112172: 1,
      36: 1,
      10029: 1,
      1824: 1,
      25: 1,
      169: 1,
      23: 1,
      38: 1,
      175: 1,
      1831: 1,
      28: 1,
      100409: 1,
      31: 1,
      110329: 1,
      111235: 1,
      243: 1,
      241: 1,
      240: 1,
      448: 1,
      449: 1,
      483: 1,
      450: 1,
      457: 1,
      479: 1,
      453: 1,
      461: 1,
      480: 1,
      1860: 1,
      110062: 1,
      452: 1,
      481: 1,
      463: 1,
      1853: 1,
      468: 1,
      110827: 1,
      44: 1,
      48: 1,
      47: 1,
      52: 1,
      45: 1,
      110374: 1,
      46: 1,
      39: 1,
      189: 1,
      111974: 1,
      54: 1,
      1745: 1,
      347: 1,
      206: 1,
      55: 1,
      111434: 1,
      110556: 1,
      1842: 1,
      110738: 1,
      50: 1,
      73: 1,
      219: 1,
      69: 1,
      66: 1,
      111817: 1,
      72: 1,
      65: 1,
      74: 1,
      76: 1,
      1809: 1,
      64: 1,
      378: 1,
      1530: 1,
      71: 1,
      68: 1,
      57: 1,
      217: 1,
      1738: 1,
      231: 1,
      673: 1,
      2014: 1,
      230: 1,
      229: 1,
      674: 1,
      110724: 1,
      100087: 1,
      681: 1,
      670: 1,
      232: 1,
      680: 1,
      1750: 1,
      15005: 1,
      537: 1,
      132231: 1,
      110580: 1,
      111022: 1,
      101083: 1,
      1876: 1,
      1877: 1,
      110395: 1,
      101085: 1,
      110093: 1,
      110396: 1,
      112670: 1,
      111019: 1,
      101088: 1,
      111706: 1,
      110953: 1,
      111020: 1,
      110404: 1,
      1013: 1,
      113044: 1,
      111711: 1,
      111716: 1,
      101084: 1,
      111710: 1,
      111708: 1,
      111715: 1,
      112689: 1,
      115472: 1,
      112713: 1,
      111707: 1,
      112965: 1,
      236: 1,
      237: 1,
      234: 1,
      1896: 1,
      744: 1,
      1888: 1,
      1891: 1,
      112809: 1,
      1438: 1,
      1900: 1,
      717: 1,
      112513: 1,
      1887: 1,
      10020: 1,
      112516: 1,
      131463: 1,
      114510: 1,
      718: 1,
      1794: 1,
      94: 1,
      88: 1,
      95: 1,
      1792: 1,
      1800: 1,
      97: 1,
      17: 1,
      1790: 1,
      1947: 1,
      91: 1,
      109: 1,
      1795: 1,
      15: 1,
      1952: 1,
      89: 1,
      1806: 1,
      1919: 1,
      12: 1,
      1807: 1,
      1960: 1,
      1801: 1,
      3: 1,
      1951: 1,
      873: 1,
      110746: 1,
      110745: 1,
      1871: 1,
      114326: 1,
      301: 1,
      420: 1,
      110747: 1,
      111091: 1,
      111097: 1,
      111088: 1,
      111086: 1,
      110749: 1,
      110206: 1,
      112510: 1,
      1569: 1,
      111083: 1,
      111082: 1,
      819: 1,
      1516: 1,
      269: 1,
      1786: 1,
      271: 1,
      1788: 1,
      272: 1,
      270: 1,
      1443: 1,
      822: 1,
      1447: 1,
      15006: 1,
      101100: 1,
      101106: 1,
      101099: 1,
      112992: 1,
      918: 1,
      300: 1,
      919: 1,
      417: 1,
      298: 1,
      920: 1,
      2041: 1,
      922: 1,
      112199: 1,
      418: 1,
      131491: 1,
      1463: 1,
      1756: 1,
      1757: 1,
      113459: 1,
      1523: 1,
      247: 1,
      246: 1,
      1906: 1,
      1910: 1,
      245: 1,
      1908: 1,
      1903: 1,
      100632: 1,
      100646: 1,
      1914: 1,
      1913: 1,
      634: 1,
      1904: 1,
      100634: 1,
      645: 1,
      1915: 1,
      1971: 1,
      112893: 1,
      112996: 1,
      101112: 1,
      697: 1,
      113149: 1,
      114162: 1,
      691: 1,
      689: 1,
      131439: 1,
      111928: 1,
      112885: 1,
      693: 1,
      114640: 1,
      113018: 1,
      111140: 1,
      112606: 1,
      695: 1,
      112828: 1,
      687: 1,
      111651: 1,
      694: 1,
      111144: 1,
      112134: 1,
      114161: 1,
      696: 1,
      688: 1,
      111065: 1,
      111138: 1,
      698: 1,
      110986: 1,
      114581: 1,
      110981: 1,
      112908: 1,
      114615: 1,
      325: 1,
      326: 1,
      327: 1,
      436: 1,
      101033: 1,
      111339: 1,
      101032: 1,
      110776: 1,
      101037: 1,
      101025: 1,
      101014: 1,
      131174: 1,
      748: 1,
      113142: 1,
      111117: 1,
      741: 1,
      101020: 1,
      101026: 1,
      266: 1,
      267: 1,
      110468: 1,
      211: 1,
      263: 1,
      896: 1,
      324: 1,
      10032: 1,
      894: 1,
      900: 1,
      898: 1,
      897: 1,
      322: 1,
      1862: 1,
      110770: 1,
      1715: 1,
      1968: 1,
      472: 1,
      100888: 1,
      242: 1,
      1861: 1,
      456: 1,
      462: 1,
      573: 1,
      244: 1,
      459: 1,
      110839: 1,
      467: 1,
      1854: 1,
      110832: 1,
      1867: 1,
      10846: 1,
      100852: 1,
      15012: 1,
      111008: 1,
      101108: 1,
      112716: 1,
      111329: 1,
      111006: 1,
      209: 1,
      191: 1,
      256: 1,
      252: 1,
      254: 1,
      111822: 1,
      110720: 1,
      15040: 1,
      15009: 1,
      2017: 1,
      780: 1,
      110980: 1,
      15029: 1,
      110975: 1,
      111328: 1,
      112531: 1,
      110977: 1,
      280: 1,
      278: 1,
      393: 1,
      1884: 1,
      111325: 1,
      101110: 1,
      115536: 1,
      112868: 1,
      112615: 1,
      1832: 1,
      160: 1,
      166: 1,
      576: 1,
      485: 1,
      171: 1,
      110502: 1,
      34: 1,
      10030: 1,
      531: 1,
      159: 1,
      110588: 1,
      110636: 1,
      29: 1,
      165: 1,
      110500: 1,
      580: 1,
      503: 1,
      320: 1,
      433: 1,
      708: 1,
      711: 1,
      700: 1,
      710: 1,
      112072: 1,
      702: 1,
      113458: 1,
      111594: 1,
      319: 1,
      113892: 1,
      111705: 1,
      100135: 1,
      1874: 1,
      111010: 1,
      111334: 1,
      111013: 1,
      111014: 1,
      111011: 1,
      114598: 1,
      78: 1,
      86: 1,
      77: 1,
      80: 1,
      81: 1,
      181: 1,
      621: 1,
      100805: 1,
      79: 1,
      83: 1,
      82: 1,
      180: 1,
      111811: 1,
      1837: 1,
      1843: 1,
      205: 1,
      110741: 1,
      110908: 1,
      1848: 1,
      110740: 1,
      112494: 1,
      110915: 1,
      2038: 1,
      1744: 1,
      112493: 1,
      111433: 1,
      110912: 1,
      1746: 1,
      607: 1,
      112139: 1,
      605: 1,
      112387: 1,
      112391: 1,
      111674: 1,
      112883: 1,
      113057: 1,
      131798: 1,
      112096: 1,
      112393: 1,
      113037: 1,
      112390: 1,
      113222: 1,
      113060: 1,
      131735: 1,
      115892: 1,
      113217: 1,
      110968: 1,
      131795: 1,
      132375: 1,
      112667: 1,
      379: 1,
      70: 1,
      1819: 1,
      1805: 1,
      1814: 1,
      111273: 1,
      111276: 1,
      62: 1,
      1823: 1,
      1816: 1,
      58: 1,
      110990: 1,
      110991: 1,
      114611: 1,
      110989: 1,
      2055: 1,
      1474: 1,
      982: 1,
      1473: 1,
      2056: 1,
      980: 1,
      1477: 1,
      112555: 1,
      1478: 1,
      112258: 1,
      112115: 1,
      112558: 1,
      110816: 1,
      100761: 1,
      110751: 1,
      310: 1,
      308: 1,
      100757: 1,
      1961: 1,
      1923: 1,
      1926: 1,
      1793: 1,
      1939: 1,
      4: 1,
    },
    eliteClubBoost: 0.8,
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
    tiers: {
      veryeasy: 'C',
      easy: 'B',
      medium: 'A',
      hard: 'S',
    },
    minimumFit: 0.85,
    impossibleOverall: 84,
    impossibleFit: 0.97,
    impossibleCandidatesPerRole: 5,
    impossibleRandomness: 60,
    formationNoise: {
      veryeasy: 4,
      easy: 3,
      medium: 1.2,
      hard: 0.3,
      impossible: 0,
    },
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
    creativeQuality: 0.45,
    movementSpeed: 1.28,
    acceleration: 1.1,
    shotFrequency: 1.4,
    shotScatter: 1.08,
    shotPower: 1,
    saveAbility: 1,
    passCompletion: 1,
    passError: 1,
    routinePassError: 0.6,
    difficultPassError: 2.5,
    teamCharacter: 1.15,
    passSpeed: 1.08,
    longBallPreference: 1.1,
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
  },
  discipline: {
    yellowSeverity: 1.2,
    redSeverity: 1,
    bookedFoulRisk: 0.28,
    bookedRiskAversion: 0.88,
  },
  stamina: {
    drain: 1,
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
      decisionTime: 0.7,
      finishPatience: 0.64,
      readWindow: 0.76,
      directness: 1.65,
      shotUrge: 3.75,
      spread: 0.34,
      saveBoost: -0.56,
      release: 0.85,
      runSupport: 4,
      passUrge: 0.28,
      deepUrge: 1.1,
      rangeUrge: 0.8,
    },
    300: {
      deliveryError: 0.5,
      decisionTime: 1,
      finishPatience: 1.05,
      readWindow: 0.94,
      directness: 1.08,
      shotUrge: 2.85,
      spread: 0.475,
      saveBoost: -0.33,
      release: 1.05,
      runSupport: 8,
      passUrge: 0.12,
      deepUrge: 1,
      rangeUrge: 0.65,
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
  display: {
    playerRadius: 1.08,
    ballRadius: 1,
    spinnerDuration: 1600,
    receiptLabelDuration: 1.25,
    receiptLabelHold: 0.5,
  },
};
const STORAGE_KEY = 'football-draft-settings-v1';
const SETTINGS_VERSION = 8;
const clone = x => JSON.parse(JSON.stringify(x));
const at = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
const put = (o, path, value) => {
  const keys = path.split('.');
  let next = o;
  for (const key of keys.slice(0, -1)) next = next[key];
  next[keys.at(-1)] = value;
};
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
  slightlyBetter: 'Slightly better re-spin boost',
  moderatelyBetter: 'Moderately better re-spin boost',
  muchBetter: 'Much better re-spin boost',
  clubSlightGap: 'Slight club improvement: max OVR gain',
  clubMediumGap: 'Medium club improvement: max OVR gain',
  leagueSlightSteps: 'Slight league improvement: max tier gain',
  leagueMediumSteps: 'Medium league improvement: max tier gain',
  lower: 'Normal / Bench',
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
  clubDoubleEvery: 'Club odds double every… OVR',
  clubRatingCenter: 'Club weight reference OVR',
  leagueOptaSlope: 'League strength adjustment per point',
  leagueOptaLimit: 'Maximum league strength adjustment',
  minimumLeaguePlayers: 'Minimum league player pool',
  eliteClubBoost: 'Top-club extra strength (A leagues)',
  receiptLabelHold: 'Player name hold (seconds)',
  minimumFit: 'Club XI minimum position fit',
  impossibleOverall: 'Impossible minimum OVR',
  impossibleFit: 'Impossible minimum position fit',
  impossibleCandidatesPerRole: 'Impossible candidates per role',
  impossibleRandomness: 'Impossible selection randomness',
  halftimeRecovery: 'Half-time stamina recovery',
  halftimeVariation: 'Recovery variation',
  drain: 'Match stamina usage',
  sprintDrain: 'Sprint reserve usage',
  sprintRecovery: 'Sprint reserve recovery',
  firstHalfMean: 'First-half added time mean',
  secondHalfMean: 'Second-half added time mean',
  standardDeviation: 'Added time variation',
  playerRadius: 'Player circle size',
  ballRadius: 'Ball circle size',
  spinnerDuration: 'Spinner duration (ms)',
  receiptLabelDuration: 'Player name duration (seconds)',
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
  slightlyBetter: [0, 1, 0.01],
  moderatelyBetter: [0, 1, 0.01],
  muchBetter: [0, 1, 0.01],
  clubSlightGap: [0.5, 20, 0.5],
  clubMediumGap: [1, 30, 0.5],
  leagueSlightSteps: [1, 3, 1],
  leagueMediumSteps: [2, 4, 1],
  clubDoubleEvery: [1, 20, 0.5],
  clubRatingCenter: [1, 99, 1],
  leagueOptaSlope: [0, 0.05, 0.001],
  leagueOptaLimit: [0, 0.5, 0.01],
  minimumLeaguePlayers: [1, 20, 1],
  minimumFit: [0.6, 1, 0.01],
  impossibleFit: [0.6, 1, 0.01],
  impossibleOverall: [60, 94, 1],
  impossibleCandidatesPerRole: [1, 20, 1],
  impossibleRandomness: [0, 100, 1],
  coachInterval: [1, 30, 1],
  halftimeRecovery: [0, 0.4, 0.01],
  halftimeVariation: [0, 2, 0.05],
  firstHalfMean: [0, 10, 0.25],
  secondHalfMean: [0, 10, 0.25],
  standardDeviation: [0, 4, 0.1],
  spinnerDuration: [300, 4000, 50],
  receiptLabelDuration: [1, 5, 0.25],
  receiptLabelHold: [0, 3, 0.05],
  eliteClubBoost: [0, 1, 0.05],
  storedTendencyWeight: [0, 1, 0.05],
  attributeCap: [0, 15, 1],
  familiarityBase: [0.4, 0.9, 0.01],
  familiarityBonus: [0.1, 0.6, 0.01],
  familiarityDecay: [0.1, 3, 0.05],
  secondaryDistance: [0, 0.2, 0.005],
  unfamiliarFit: [0.2, 0.8, 0.01],
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
  if (
    f.path.startsWith('gameplay.') ||
    ['drain', 'sprintDrain', 'sprintRecovery', 'playerRadius', 'ballRadius'].includes(f.key)
  )
    [min, max, step] = [0.5, 2, 0.01];
  if (['receptionError', 'difficultReceptionError'].includes(f.key))
    [min, max, step] = [0, 2, 0.01];
  if (['controlQuality', 'passingQuality', 'defensiveQuality', 'creativeQuality'].includes(f.key))
    [min, max, step] = [0, 2, 0.01];
  if (['routinePassError', 'difficultPassError'].includes(f.key)) [min, max, step] = [0, 4, 0.01];
  if (f.path.includes('Overrides.')) [min, max, step] = [0, 10, 0.05];
  if (f.path.startsWith('draft.clubDoubleEvery.')) [min, max, step] = [1, 20, 0.5];
  if (f.path.startsWith('draft.budget.') && typeof f.defaultValue === 'number')
    [min, max, step] = [0, 11, 1];
  if (f.path.startsWith('draft.respins.')) [min, max, step] = [0, 5, 1];
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
      labels[f.key] ||
      f.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()),
    min,
    max,
    step,
  };
});
export function normalizeConfig(input = {}) {
  // Upgrade the old shared club bias once; preserve customized odds and unrelated settings.
  if (typeof input?.draft?.clubDoubleEvery === 'number') {
    const old = input.draft,
      formerWeights = { A: 32, B: 10, C: 3, D: 0.8, F: 0.2 };
    const clubDoubleEvery =
      old.clubDoubleEvery === 6
        ? { ...DEFAULT_CONFIG.draft.clubDoubleEvery }
        : Object.fromEntries(['A', 'B', 'C'].map(t => [t, old.clubDoubleEvery]));
    const leagueWeights = Object.entries(formerWeights).every(
      ([t, v]) => old.leagueWeights?.[t] === v,
    )
      ? { ...DEFAULT_CONFIG.draft.leagueWeights }
      : old.leagueWeights;
    input = { ...input, draft: { ...old, clubDoubleEvery, leagueWeights } };
  }
  // Legacy shared lower-tier budgets become explicit upper-tier caps; lower
  // tiers now fill any remaining place, regardless of unused expensive slots.
  const legacy = input?.draft?.budget;
  if (legacy && legacy.starter === undefined && Number.isInteger(legacy.lower)) {
    const wasDefault = legacy.superstar === 2 && legacy.star === 5 && legacy.lower === 4;
    const budget = wasDefault
      ? { ...DEFAULT_CONFIG.draft.budget }
      : {
          superstar: legacy.superstar,
          star: legacy.star,
          starter: Math.min(DEFAULT_CONFIG.draft.budget.starter, legacy.lower),
        };
    input = { ...input, draft: { ...input.draft, budget } };
  }
  const out = clone(DEFAULT_CONFIG);
  for (const field of CONFIG_FIELDS) {
    const value = at(input, field.path);
    if (value === undefined) continue;
    if (typeof field.defaultValue === 'boolean') {
      if (typeof value !== 'boolean') throw Error(field.label + ' must be on or off.');
      put(out, field.path, value);
    } else if (typeof field.defaultValue === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < field.min ||
        value > field.max
      )
        throw Error(field.path + ' must be between ' + field.min + ' and ' + field.max + '.');
      if (field.step === 1 && !Number.isInteger(value))
        throw Error(field.label + ' must be a whole number.');
      put(out, field.path, value);
    } else {
      if (!['S', 'A', 'B', 'C', 'D', 'F'].includes(value)) throw Error('Choose a valid team tier.');
      put(out, field.path, value);
    }
  }
  const tierRows = Object.values(out.playerTiers);
  for (let i = 0; i < tierRows.length; i++) {
    const t = tierRows[i];
    if (t.badgeMinimum > t.badgeMaximum) throw Error('Badge minimum cannot exceed its maximum.');
    if (i && tierRows[i - 1].minimum <= t.minimum)
      throw Error('Player tier thresholds must descend.');
  }
  const teams = Object.values(out.teamTiers);
  if (teams.some((v, i) => i && teams[i - 1] <= v))
    throw Error('Team tier thresholds must descend.');
  if (Object.values(out.draft.leagueWeights).every(v => v <= 0))
    throw Error('At least one league tier must have a positive draw weight.');
  if (out.playerTiers.Bench.minimum !== 0 || out.teamTiers.F !== 0)
    throw Error('Bench and F must start at zero to cover every rating.');
  if (
    out.draft.respinBoosts.clubSlightGap >= out.draft.respinBoosts.clubMediumGap ||
    out.draft.respinBoosts.leagueSlightSteps >= out.draft.respinBoosts.leagueMediumSteps
  )
    throw Error('Medium re-spin improvement must exceed slight improvement.');
  if (out.periods.minimum > Math.min(out.periods.firstHalfMaximum, out.periods.secondHalfMaximum))
    throw Error('Minimum added time exceeds maximum.');
  if (out.ratings.familiarityBase + out.ratings.familiarityBonus > 1.001)
    throw Error('Position familiarity base and bonus must total at most 1.');
  for (const [role, weights] of Object.entries(out.ratings.roleWeights))
    if (Object.values(weights).reduce((s, v) => s + v, 0) <= 0)
      throw Error(role + ' needs a positive overall weight.');
  return out;
}
export function loadConfig() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}');
    const version = saved?._settingsVersion ?? 0;
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
    if (version < 3 && saved?.ai?.impossibleOverall === 82)
      saved.ai.impossibleOverall = DEFAULT_CONFIG.ai.impossibleOverall;
    if (
      version < 1 &&
      [
        { A: 36, B: 10.5, C: 3, D: 0.8, F: 0.2 },
        { A: 32, B: 10, C: 3, D: 0.8, F: 0.2 },
      ].some(old =>
        Object.entries(old).every(
          ([tier, weight]) => saved?.draft?.leagueWeights?.[tier] === weight,
        ),
      )
    )
      saved.draft.leagueWeights = { ...DEFAULT_CONFIG.draft.leagueWeights };
    if (version < 2) {
      if (saved?.playerTiers?.Superstar?.minimum === 83) saved.playerTiers.Superstar.minimum = 85;
      if (saved?.draft?.leagueWeights?.A === 39)
        saved.draft.leagueWeights.A = DEFAULT_CONFIG.draft.leagueWeights.A;
      if (saved?.display?.receiptLabelDuration === 2.5)
        saved.display.receiptLabelDuration = DEFAULT_CONFIG.display.receiptLabelDuration;
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
    return normalizeConfig(saved);
  } catch {
    return clone(DEFAULT_CONFIG);
  }
}
export function saveConfig(value) {
  const next = normalizeConfig(value);
  globalThis.localStorage?.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...next, _settingsVersion: SETTINGS_VERSION }),
  );
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
