// Draft board model: pool filtering/sorting, fit tags, slot highlights, link lines, reel items,
// honest odds and the live projection. Framework-free (Node tests import it).
import { LINE_OF, roleRating } from '../../../core/draft/pools.js';
import { teamLinks } from '../../../core/draft/links.js';
import { FORMATIONS } from '../../../core/players/formations.js';
import { NATURAL_FIT } from '../../../core/draft/session.js';
import { MODE_BASELINES, ladderTarget } from '../../../core/draft/opponents.js';
import { projectRun } from '../../../core/competition/cup.js';
import { outcomeProbabilities } from '../../../core/competition/model.js';
import { searchKey } from '../../../core/util/text.js';
import { keyStatsFirst } from '../../lib/player-view.js';

export const CATEGORY_LABEL = { nation: 'Nation', league: 'League', club: 'Club' };
export const CATEGORY_ICON = { nation: 'flag', league: 'layout-grid', club: 'shield' };

/** Chips over the pool: one sort (Best fit / Overall) or a line filter. */
export function poolFilters(hideRatings = false) {
  return [
    { value: 'best', label: hideRatings ? 'All' : 'Best fit' },
    ...(hideRatings ? [] : [{ value: 'ovr', label: 'Overall' }]),
    { value: 'GK', label: 'GK' },
    { value: 'DEF', label: 'DEF' },
    { value: 'MID', label: 'MID' },
    { value: 'ATT', label: 'ATT' },
  ];
}

const LINE_ORDER = { GK: 0, DEF: 1, MID: 2, ATT: 3 };
const lineOf = position => LINE_OF[position] || 'MID';
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const keys = new WeakMap();
function entryKey(e) {
  let k = keys.get(e);
  if (k === undefined)
    keys.set(e, (k = searchKey([e.name, e.fullName, e.club, e.nation, e.league].join(' '))));
  return k;
}

/**
 * Filter/sort a snapshot pool. `best` keeps the session's order (available first, best open
 * slot rating); `ovr` sorts by natural OVR. With hidden ratings nothing is ordered by rating:
 * available first, then by line (GK → ATT) and name.
 */
export function filterPool(pool = [], { filter = 'best', query = '', hideRatings = false } = {}) {
  const q = searchKey(query).trim();
  let list = pool;
  if (LINE_ORDER[filter] !== undefined) list = list.filter(e => lineOf(e.position) === filter);
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter(e => words.every(w => entryKey(e).includes(w)));
  }
  if (hideRatings)
    return [...list].sort(
      (a, b) =>
        b.available - a.available ||
        LINE_ORDER[lineOf(a.position)] - LINE_ORDER[lineOf(b.position)] ||
        byName(a, b),
    );
  if (filter === 'ovr')
    return [...list].sort((a, b) => b.available - a.available || b.ovr - a.ovr || byName(a, b));
  return list;
}

/** Counts for the pool header. */
export function poolCounts(pool = []) {
  const available = pool.filter(e => e.available).length;
  return { total: pool.length, available, blocked: pool.length - available };
}

/** FitTag for a pool row: natural best slot, the drop when out of position, or why not. */
export function rowFit(entry) {
  if (!entry.available)
    return {
      state: 'blocked',
      label: entry.reason === 'Already drafted' ? 'Taken' : 'No slot',
    };
  const best = entry.best;
  if (!best) return null;
  if (best.familiarity >= NATURAL_FIT) return { state: 'ok', label: best.role };
  return { state: 'penalty', label: best.role, from: entry.ovr, to: best.rating };
}

/** A drop bigger than this (OVR points) is shown as a muted "poor fit" instead of amber. */
export const POOR_FIT_DROP = 7;

/**
 * PitchView highlights for placementOptions(id): the Auto slot 'best', natural slots 'ok',
 * small out-of-position drops 'penalty' (natural → in-slot rating), big drops a muted
 * 'neutral' tag with the in-slot rating (still selectable), closed slots 'blocked'.
 */
export function slotHighlights(options = [], auto = null, { hideRatings = false } = {}) {
  const out = {};
  const off = o =>
    o.natural - o.rating > POOR_FIT_DROP
      ? { state: 'neutral', label: hideRatings ? 'Poor' : String(o.rating), from: o.natural }
      : { state: 'penalty', label: o.role, from: o.natural, to: o.rating };
  for (const o of options) {
    if (!o.allowed) out[o.slot] = { state: 'blocked', label: o.reason };
    else if (auto && o.slot === auto.slot)
      out[o.slot] = o.familiarity >= NATURAL_FIT ? { state: 'best', label: 'Best' } : off(o);
    else if (o.familiarity >= NATURAL_FIT) out[o.slot] = { state: 'ok', label: o.role };
    else out[o.slot] = off(o);
  }
  return out;
}

const GROUP_ORDER = ['Pot 1', 'Pot 2', 'Pot 3', 'Pot 4', 'S', 'A', 'B', 'C', 'D', 'F'].map(
  (k, i) => [k.length === 1 ? `Tier ${k}` : k, i],
);
const groupRank = label => new Map(GROUP_ORDER).get(label) ?? 99;

/** The six summary stats with the position's key stats first (pool rows). */
export const rowStats = (stats, position) => keyStatsFirst(stats, position);

/** PitchView link lines from Links pairs: club 3 · nation 2 · league 1. */
export function linkLines(pairs = []) {
  const strength = { club: 3, nation: 2, league: 1 };
  return pairs.map(p => ({ from: p.a, to: p.b, strength: strength[p.kind] || 1 }));
}

/** Reel items (only options that could have been drawn: weight > 0) and the landing index. */
export function reelItems(reel, { league = null } = {}) {
  if (!reel) return { items: [], landIndex: 0 };
  const landed = reel.options[reel.landing];
  const live = reel.options.filter(o => o.weight > 0);
  const items = live.map(o => {
    if (reel.category === 'nation')
      return {
        id: o.id,
        label: o.name,
        sub: o.pot ? `Pot ${o.pot}` : '',
        flag: { code: o.code, name: o.name, src: o.flag || undefined },
      };
    if (reel.category === 'league')
      return {
        id: o.id,
        label: o.name,
        sub: `Tier ${o.tier}`,
        logo: { src: o.logo, name: o.name },
      };
    return {
      id: o.id,
      label: o.name,
      sub: league?.name || `Tier ${o.tier}`,
      crest: { name: o.name, colors: [o.primary, o.secondary].filter(Boolean) },
    };
  });
  return { items, landIndex: Math.max(0, live.indexOf(landed)) };
}

const pct = p =>
  p >= 0.1 ? `${Math.round(p * 100)}%` : p >= 0.001 ? `${(p * 100).toFixed(1)}%` : '<0.1%';

/**
 * Honest odds of a spin for the info popover: per reel the eligible count, whether the odds
 * are uniform, the landed option's chance and groups (by pot/tier) with each option's chance.
 */
export function oddsSummary(spin) {
  if (!spin) return [];
  return spin.reels.map(reel => {
    const live = reel.options.filter(o => o.weight > 0);
    const landed = reel.options[reel.landing];
    const groupKey = o => (reel.category === 'nation' ? `Pot ${o.pot}` : `Tier ${o.tier}`);
    const groups = new Map();
    for (const o of live) {
      const k = groupKey(o);
      const g = groups.get(k) || { label: k, count: 0, each: o.probability, names: [] };
      g.count++;
      g.names.push(o.name);
      g.each = Math.max(g.each, o.probability);
      groups.set(k, g);
    }
    const ps = live.map(o => o.probability);
    return {
      category: reel.category,
      label: CATEGORY_LABEL[reel.category],
      eligible: live.length,
      total: reel.options.length,
      uniform: ps.length > 0 && Math.max(...ps) - Math.min(...ps) < 0.0015,
      landed: {
        name: landed.name,
        probability: landed.probability,
        chance: pct(landed.probability),
      },
      groups: [...groups.values()]
        .sort((a, b) => groupRank(a.label) - groupRank(b.label))
        .map(g => ({ ...g, chance: pct(g.each) })),
    };
  });
}

/** Headline of a landed spin: title, media and meta for the reveal card. */
export function spinHeadline(spin, poolSize = 0) {
  if (!spin) return null;
  const o = spin.option;
  const players = `${poolSize} player${poolSize === 1 ? '' : 's'}`;
  if (spin.category === 'nation')
    return {
      title: o.name,
      kind: 'nation',
      flag: { code: o.code, name: o.name, src: o.flag || undefined },
      meta: `Pot ${o.pot} · ${poolSize} call-up${poolSize === 1 ? '' : 's'}`,
      big: o.pot === 1,
      badge: o.pot === 1 ? 'Pot 1' : null,
    };
  if (spin.category === 'league')
    return {
      title: o.name,
      kind: 'league',
      logo: { src: o.logo, name: o.name },
      meta: `Tier ${o.tier} league · ${players}`,
      big: o.tier === 'A',
      badge: o.tier === 'A' ? 'Top league' : null,
    };
  return {
    title: o.name,
    kind: 'club',
    crest: { name: o.name, colors: [o.primary, o.secondary].filter(Boolean) },
    league: spin.league ? { src: spin.league.logo, name: spin.league.name } : null,
    meta: `${spin.league?.name || 'Club'} · ${players}`,
    big: o.tier === 'S' || o.tier === 'A',
    badge: o.tier === 'S' ? 'Elite club' : o.tier === 'A' ? 'Top club' : null,
  };
}

/** Plain text for the live region when a spin lands. */
export function landedAnnouncement(spin, poolSize) {
  const h = spinHeadline(spin, poolSize);
  if (!h) return '';
  return `${CATEGORY_LABEL[spin.category]}: ${h.title}. ${h.meta}.`;
}

/**
 * Effective rating estimate of a partial XI: filled slots as they are, open slots at the
 * mode's typical drafted rating; links chem plus the typical chem of the open share.
 */
export function estimateRating(team, mode) {
  const base = MODE_BASELINES[mode] || MODE_BASELINES.nations;
  const filled = team.slots.filter(s => s.player);
  const open = 11 - filled.length;
  const sum = filled.reduce((s, x) => s + x.rating, 0);
  const chem = (team.links?.chem || 0) * (filled.length / 11) + base.chem * (open / 11);
  return Math.round(((sum + open * base.ovr) / 11 + chem) * 100) / 100;
}

/**
 * Live projection for the draft meters:
 *   run/daily → projectRun stage label ('Quarter-finals');
 *   quick     → win chance vs the difficulty's opponent target;
 *   versus    → win chance against the other drafter's estimate.
 */
export function draftProjection({ kind, mode, difficulty, teams, side = 0, rules, rerolls }) {
  const team = teams[side];
  const filled = team.slots.filter(s => s.player).length;
  if (!filled) return null;
  const rating = estimateRating(team, mode);
  if (kind === 'versus') {
    const other = teams[1 - side];
    if (!other) return null;
    const p = outcomeProbabilities(rating, estimateRating(other, mode));
    return { kind: 'versus', label: 'Win chance', value: `${Math.round(p.win * 100)}%`, rating };
  }
  if (kind === 'quick') {
    const target = ladderTarget(mode, difficulty, {
      rules,
      ...(rerolls != null ? { rerolls } : {}),
    });
    const p = outcomeProbabilities(rating, target);
    return {
      kind: 'quick',
      label: 'Win chance',
      value: `${Math.round(p.win * 100)}%`,
      rating,
      target,
    };
  }
  const run = projectRun({
    rating,
    mode,
    difficulty,
    rules,
    ...(rerolls != null ? { rerolls } : {}),
  });
  const short = {
    group: 'Group',
    r16: 'Last 16',
    qf: 'Quarters',
    sf: 'Semis',
    final: 'Final',
    champion: 'Champions',
  };
  return {
    kind: 'run',
    label: 'Projected',
    value: short[run.stage] || run.stage,
    long: run.label.replace('Projected: ', ''),
    stage: run.stage,
    rating,
  };
}

/**
 * What drafting `profileId` into `slot` would do: team OVR after the pick (exact mean slot
 * rating), Links score and the XI players he links with ({ name, kind }).
 * `session` is the DraftSession (read-only use: lineup/player/rules).
 */
export function pickPreview(session, side, profileId, slot) {
  if (slot == null) return null;
  const rows = FORMATIONS[session.formations[side]];
  const lineup = session.lineup(side);
  const candidate = session.player(profileId);
  if (!rows?.[slot] || !candidate || lineup[slot]) return null;
  const next = [...lineup];
  next[slot] = candidate;
  let sum = 0,
    n = 0;
  next.forEach((p, i) => {
    if (p) {
      sum += roleRating(p, rows[i][2]);
      n++;
    }
  });
  const links = teamLinks(next, session.rules.links);
  const mates = links.pairs
    .filter(p => p.a === slot || p.b === slot)
    .map(p => ({ name: next[p.a === slot ? p.b : p.a].name, kind: p.kind }));
  return { rating: Math.round((sum / n) * 10) / 10, links: links.score, mates };
}
