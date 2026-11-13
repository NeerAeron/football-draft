// Setup screen model (#/play/:mode): copy, defaults from the query / last choices / prefs,
// and the startDraft() context. Framework-free (Node tests import it).
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../../../core/draft/session.js';
import { ladderTarget } from '../../../core/draft/opponents.js';
import { FORMATIONS } from '../../../core/players/formations.js';
import { budgetBands } from '../../../core/draft/budget.js';
import { CONFIG, DEFAULT_CONFIG } from '../../../core/config/config.js';
import { draftMode, draftType, parseSeed, KIT_COLORS } from '../../lib/draft-store.js';

export const SETUP_KEY = 'football-draft-setup';
export const SETUP_MODES = {
  run: {
    title: 'World Cup Run',
    eyebrow: 'Draft · Group · Knockouts',
    lead: 'Draft your XI, then win a group of four and five knockout rounds. Perfect run: 8–0.',
    cta: 'Start draft',
  },
  quick: {
    title: 'Quick Match',
    eyebrow: 'Draft · One match',
    lead: 'Draft an XI and play one match against a team from the difficulty ladder.',
    cta: 'Start draft',
  },
  versus: {
    title: 'Versus',
    eyebrow: 'Two players · One device',
    lead: 'A coin toss decides who drafts first, then you alternate spins and picks. Then kick off.',
    cta: 'Toss the coin',
  },
};

export const TYPE_INFO = [
  {
    value: 'nations',
    label: 'Nations',
    icon: 'flag',
    text: 'Spin a nation, pick from its best 30 players.',
  },
  {
    value: 'leagues',
    label: 'Leagues',
    icon: 'layout-grid',
    text: 'Spin one of 40 leagues, pick anyone who plays there. Big leagues come up more.',
  },
  {
    value: 'clubs',
    label: 'Clubs',
    icon: 'shield',
    text: 'One spin lands a league, then a club. Pick from that squad. The hardest.',
  },
];

/** Formations shown first; the rest sit behind "More formations". */
export const MAIN_FORMATIONS = ['433', '4231', '442', '4141', '41212', '352', '343', '532'];
export const ALL_FORMATIONS = Object.keys(FORMATIONS);

/**
 * Versus offers re-rolls per player. `value` is the difficulty id the choice is stored under
 * (there is no opponent ladder in Versus); `rerolls` is what the draft gets.
 */
export const VERSUS_REROLLS = [
  { value: 'legendary', label: 'None', hint: '0 each', rerolls: 0 },
  { value: 'worldclass', label: 'One', hint: '1 each', rerolls: 1 },
  { value: 'pro', label: 'Two', hint: '2 each', rerolls: 2 },
];
/** Re-rolls per player of a Versus setup (its difficulty id → VERSUS_REROLLS). */
export const versusRerolls = difficulty =>
  (VERSUS_REROLLS.find(o => o.value === difficulty) ?? VERSUS_REROLLS[2]).rerolls;
/** What each difficulty is, in a line (setup screen). Legendary is the game's main challenge. */
export const DIFFICULTY_TEXT = {
  pro: 'Good nations in your way and a heavyweight in the final. Where a title is won first.',
  worldclass: 'The best nations from the quarter-finals on.',
  legendary: 'The ultimate test: the whole World Cup field stands between you and the cup.',
};

const truthy = v => v === '1' || v === 'true' || v === 'yes' || v === true;
const pick = (value, list) => (list.includes(value) ? value : null);

/**
 * Facts for a difficulty level: the opponent target (effective rating) and the tokens — the
 * same on every level (`rerolls`: nation respins, the re-rolls of a draft without eras).
 */
export function difficultyFacts(type, level, { useDefaultRules = false } = {}) {
  const rules = useDefaultRules ? DEFAULT_CONFIG.draft : CONFIG.draft;
  return {
    id: level,
    label: DIFFICULTY_LABELS[level],
    text: DIFFICULTY_TEXT[level] ?? '',
    rerolls: rules.tokens.nation,
    tokens: { ...rules.tokens },
    gap: rules.ladder[level] ?? 0,
    target: Math.round(ladderTarget(draftMode(type), level, { rules })),
  };
}

export const difficultyLevels = (type, options) =>
  DIFFICULTIES.map(level => difficultyFacts(type, level, options));

/**
 * Setup state from (highest priority first) the query (?type ?difficulty ?formation ?seed
 * ?hide ?unique ?budget — challenge links land here), the last choices for this mode, and prefs.
 */
export function setupDefaults(mode, { query = {}, saved = {}, prefs = {} } = {}) {
  // The World Cup is a Nations draft; Quick Match and Versus offer Nations, Leagues and Clubs.
  const asked = query.type ? draftType(query.type) : draftType(prefs.draftType || 'nations');
  const type = mode === 'run' || !TYPE_INFO.some(t => t.value === asked) ? 'nations' : asked;
  const seed = parseSeed(query.seed);
  const difficulty =
    pick(query.difficulty, DIFFICULTIES) || pick(saved.difficulty, DIFFICULTIES) || 'pro';
  const formation =
    (FORMATIONS[query.formation] && query.formation) ||
    (FORMATIONS[saved.formation] && saved.formation) ||
    '433';
  const kits = [0, 1].map(i =>
    KIT_COLORS.some(k => k.id === saved.kits?.[i]) ? saved.kits[i] : KIT_COLORS[i].id,
  );
  if (kits[0] === kits[1]) kits[1] = KIT_COLORS.find(k => k.id !== kits[0]).id;
  return {
    type,
    difficulty,
    formation,
    hideRatings: query.hide != null ? truthy(query.hide) : !!prefs.hideRatings,
    uniqueNations: query.unique != null ? truthy(query.unique) : !!saved.uniqueNations,
    // Budget mode: a harder World Cup (core/draft/budget.js), chosen on Home (its own button)
    // and carried by the link (?budget=1); never a remembered setting.
    budget: mode === 'run' && query.budget != null && truthy(query.budget),
    names: [0, 1].map(i => String(saved.names?.[i] || '').slice(0, 20)),
    kits,
    seed,
  };
}

/** What to remember for next time (per mode). */
export const savedChoices = state => ({
  difficulty: state.difficulty,
  formation: state.formation,
  uniqueNations: state.uniqueNations,
  names: state.names,
  kits: state.kits,
});

/**
 * Budget mode in one sentence, from the live rules: 'Harder: your XI may hold only 2 Superstars
 * (88+), 2 Stars (84–87) and 3 Starters (80–83). Everyone else must be under 80.'
 */
export function budgetCopy(rules = CONFIG.draft.budget) {
  const bands = budgetBands(rules),
    caps = bands.map(b => `${b.slots} ${b.label}${b.slots === 1 ? '' : 's'} (${b.range})`);
  return `Harder: your XI may hold only ${caps.slice(0, -1).join(', ')} and ${caps.at(-1)}. Everyone else must be under ${bands.at(-1).minimum}.`;
}

/** Does the type spin nations (so "one player per nation" applies)? */
export const spinsNations = type => draftType(type) === 'nations';

/** The startDraft() context for a setup state. */
export function setupContext(mode, state) {
  const kind = ['run', 'quick', 'versus'].includes(mode) ? mode : 'quick';
  return {
    kind,
    type: state.type,
    difficulty: state.difficulty,
    formation: state.formation,
    options: {
      hideRatings: !!state.hideRatings,
      uniqueNations: spinsNations(state.type) && !!state.uniqueNations,
      ...(kind === 'run' && state.budget ? { budget: true } : {}),
    },
    ...(state.seed != null ? { seed: state.seed, useDefaultRules: true } : {}),
    ...(kind === 'versus'
      ? { names: state.names, kits: state.kits, rerolls: versusRerolls(state.difficulty) }
      : {}),
    ...(kind === 'run' ? { returnTo: '/run' } : {}),
  };
}
