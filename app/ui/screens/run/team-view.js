// View helpers shared by the run and daily screens: the drafted XI as PlayerViews with slot
// ratings, its nations (flag mosaic), award rows → PlayerViews and the share card data.
// Framework-free.
import { roleRating } from '../../../core/draft/pools.js';
import { DRAFT_MODES, DIFFICULTY_LABELS } from '../../../core/draft/session.js';
import { makePlayerView, surname } from '../../lib/player-view.js';
import { pageBase } from '../../lib/run-store.js';

const viewers = new WeakMap();
export function viewerFor(catalog) {
  if (!viewers.has(catalog)) viewers.set(catalog, makePlayerView(catalog));
  return viewers.get(catalog);
}

/** The user's XI (run.userSide()) → [{ view (ovr = slot rating), role, profileId }] in slot order. */
export function xiViews(catalog, side) {
  const toView = viewerFor(catalog);
  return side.players.map(p => {
    const base = catalog.byId?.get?.(p.profileId) || p;
    const rating = Math.round(roleRating(base, p.role));
    return {
      view: { ...toView(base), ovr: rating, tier: undefined },
      role: p.role,
      profileId: p.profileId,
      rating,
    };
  });
}

/** Nations of an XI, most players first: [{ code, name, count }]. */
export function nationList(views) {
  const map = new Map();
  for (const { view } of views) {
    const n = view.nation;
    if (!n?.name) continue;
    const e = map.get(n.name) || { code: n.code, name: n.name, count: 0 };
    e.count++;
    map.set(n.name, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** PlayerView for an award row (playerOfTheTournament / heldYouBack). */
export function awardView(catalog, row) {
  const p = row && catalog.byId?.get?.(row.profileId);
  if (!p) return null;
  return { ...viewerFor(catalog)(p), ovr: row.slotRating ?? undefined };
}

export const modeLabel = mode => DRAFT_MODES[mode]?.label || 'Nations';
export const levelLabel = level => DIFFICULTY_LABELS[level] || 'Pro';

/** Data for renderShareImage (lib/share-image.js). */
export function shareCardFor({ snapshot, views, formation, title, hideRatings, stats, subtitle }) {
  const host = (() => {
    try {
      const u = new URL(pageBase());
      return (u.host + u.pathname).replace(/\/$/, '');
    } catch {
      return '';
    }
  })();
  return {
    title,
    subtitle:
      subtitle ||
      [modeLabel(snapshot.mode), levelLabel(snapshot.difficulty), hideRatings && 'Ratings hidden']
        .filter(Boolean)
        .join(' · '),
    record: snapshot.record,
    results: snapshot.results,
    champion: snapshot.status === 'champion',
    grade: snapshot.grade?.grade || 'F',
    verdict: snapshot.grade?.verdict || '',
    stageLabel:
      snapshot.status === 'champion'
        ? 'World champions'
        : snapshot.status === 'eliminated'
          ? `Out in the ${snapshot.stageLabel}`
          : snapshot.stageLabel,
    formation,
    players: views.map(v => ({
      name: surname(v.view.name),
      code: v.view.nation?.code || null,
      nation: v.view.nation?.name || '',
      rating: v.rating,
    })),
    hideRatings: !!hideRatings,
    stats: stats || [
      { label: 'Team OVR', value: hideRatings ? '??' : snapshot.user.rating.toFixed(1) },
      { label: 'Goals', value: `${snapshot.record.gf}–${snapshot.record.ga}` },
    ],
    footer: host ? `Beat it → ${host}` : '',
  };
}
