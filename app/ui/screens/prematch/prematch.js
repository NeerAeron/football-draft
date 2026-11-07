// Pre-match (#/prematch): the generic screen before any match (Quick, Versus, RUN-UI's run
// matches and exhibitions). Both sides with strength and odds, your lineup on the pitch
// (tap two players to swap; a formation change re-slots everyone, fit shown on the pitch),
// tactics, the opponent preview, the view mode, and Kick off → lib/match-store requestMatch.
// Data: lib/prematch-store.js (persisted, so a reload keeps the edits).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { useStore } from '../../lib/store.js';
import { teamStyle } from '../../lib/color.js';
import { makePlayerView } from '../../lib/player-view.js';
import { tierOf } from '../../lib/tiers.js';
import { preloadRoutes } from '../../lib/screen-loader.js';
import { loadCatalog } from '../../../services/catalog.js';
import { FORMATIONS, formationLabel } from '../../../core/players/formations.js';
import { roleRating, roleFit, naturalRating } from '../../../core/draft/pools.js';
import { NATURAL_FIT } from '../../../core/draft/session.js';
import { outcomeProbabilities } from '../../../core/competition/model.js';
import {
  prematchStore,
  swapPlayers,
  changeFormation,
  setSideTactic,
  setMatchView,
  kickOff,
  lineupStrength,
  slotFits,
  canSwap,
  MENTALITIES,
  STYLE_OPTIONS,
  TACTIC_SLIDERS,
} from '../../lib/prematch-store.js';
import {
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Flag,
  Crest,
  PitchView,
  Range,
  Segmented,
  Skeleton,
  Icon,
  toast,
} from '../../components/index.js';
import { useMedia } from '../draft/use-media.js';
import { POOR_FIT_DROP, linkLines } from '../draft/draft-model.js';
import { fmt1 } from '../../lib/format.js';

const VIEWS = [
  { value: 'key', label: 'Key Moments', hint: '≈1 min' },
  { value: 'full', label: 'Full match', hint: '3 min' },
  { value: 'instant', label: 'Instant', hint: 'Result' },
];
const FORMATION_OPTIONS = Object.keys(FORMATIONS).map(f => ({
  value: f,
  label: formationLabel(f),
}));
const pct = p => `${Math.round(p * 100)}%`;

/** Fit tags while a slot is picked (where would he play?) or, at rest, out-of-position players. */
function lineupHighlights(side, picked, hide = false) {
  const rows = FORMATIONS[side.formation];
  const out = {};
  const tag = (p, role) => {
    const natural = Math.round(naturalRating(p)),
      rating = Math.round(roleRating(p, role));
    if (roleFit(p, role) >= NATURAL_FIT) return { state: 'ok', label: role };
    if (hide) return { state: 'penalty', label: role };
    return natural - rating > POOR_FIT_DROP
      ? { state: 'neutral', label: String(rating) }
      : { state: 'penalty', label: role, from: natural, to: rating };
  };
  if (picked != null) {
    const p = side.players[picked];
    rows.forEach(([, , role], j) => {
      if (j === picked) return;
      out[j] = canSwap(side.players, side.formation, picked, j)
        ? tag(p, role)
        : { state: 'blocked', label: 'Keepers only' };
    });
    return out;
  }
  slotFits(side.players, side.formation).forEach((f, i) => {
    if (f && !f.fits) out[i] = tag(side.players[i], f.role);
  });
  return out;
}

function SideBadge({ side, size = 56 }) {
  return side.flagCode
    ? html`<${Flag} code=${side.flagCode} name=${side.name} size=${size} decorative />`
    : html`<${Crest}
        name=${side.name}
        short=${side.short}
        colors=${side.colors}
        size=${size}
        decorative
      />`;
}

function Matchup({ data, strengths, children }) {
  const [a, b] = strengths;
  const p = outcomeProbabilities(a.effective, b.effective);
  const label = data.sides[0].name;
  const hide = data.hideRatings;
  return html`<section class="matchup" aria-label="Matchup">
    <div class="matchup__sides">
      ${data.sides.map(
        (s, i) =>
          html`<div
            key=${i}
            class=${cx('matchup__side', i === 1 && 'is-away')}
            style=${teamStyle(s.colors)}
          >
            <${SideBadge} side=${s} />
            <span class="matchup__name">${s.name}</span>
            <span class="matchup__meta">
              ${!hide && html`<b class="num">${fmt1(strengths[i].rating)}</b>`}
              <span>${formationLabel(s.formation).split(' · ')[0]}</span>
            </span>
          </div>`,
      )}
      <span class="matchup__vs" aria-hidden="true">vs</span>
    </div>
    ${
      hide
        ? html`<p class="matchup__hidden">
            <${Icon} name="eye-off" size=${16} /> Ratings hidden until the final whistle
          </p>`
        : html`<div
            class="matchup__odds"
            role="img"
            aria-label=${`${label}: win ${pct(p.win)}, draw ${pct(p.draw)}, loss ${pct(p.loss)}`}
          >
            <span class="matchup__bar">
              <i class="is-win" style=${`flex:${p.win};background:${data.sides[0].colors[0]}`}></i
              ><i class="is-draw" style=${`flex:${p.draw}`}></i
              ><i
                class="is-loss"
                style=${`flex:${p.loss};background:${data.sides[1].colors[0]}`}
              ></i>
            </span>
            <span class="matchup__legend">
              <span><b class="num">${pct(p.win)}</b> ${data.sides[0].short}</span>
              <span><b class="num">${pct(p.draw)}</b> draw</span>
              <span><b class="num">${pct(p.loss)}</b> ${data.sides[1].short}</span>
            </span>
          </div>`
    }
    ${children && html`<div class="matchup__cta">${children}</div>`}
  </section>`;
}

function Tactics({ side, index }) {
  const t = side.tactics;
  const style = STYLE_OPTIONS.find(s => s.value === t.style);
  return html`<section class="pm-panel tactics" aria-labelledby=${`tactics-${index}`}>
    <h2 class="pm-panel__title" id=${`tactics-${index}`}>Tactics</h2>
    <${Segmented}
      label="Mentality"
      options=${MENTALITIES}
      value=${t.mentality}
      onChange=${v => setSideTactic(index, 'mentality', v)}
      block
      class="tactics__mentality"
    />
    <div class="tactics__style">
      <span class="tactics__label">Style</span>
      <${ChipGroup}
        label="Playing style"
        options=${STYLE_OPTIONS}
        value=${t.style}
        onChange=${v => v && setSideTactic(index, 'style', v)}
        size="sm"
      />
      ${style && html`<p class="tactics__hint">${style.description}</p>`}
    </div>
    <div class="tactics__sliders">
      ${TACTIC_SLIDERS.map(
        s =>
          html`<${Range}
            key=${s.key}
            label=${s.label}
            min=${1}
            max=${5}
            value=${t[s.key]}
            valueText=${s.levels[t[s.key] - 1]}
            onInput=${v => setSideTactic(index, s.key, v)}
          />`,
      )}
    </div>
  </section>`;
}

function Opponent({ side, players, hideRatings }) {
  const top = useMemo(
    () =>
      side.players
        .map((p, i) => ({
          p,
          view: players[i],
          r: roleRating(p, FORMATIONS[side.formation][i][2]),
        }))
        .sort((a, b) => b.r - a.r)
        .slice(0, 3),
    [side, players],
  );
  return html`<section class="pm-panel opponent" aria-labelledby="opponent-title">
    <h2 class="pm-panel__title" id="opponent-title">
      <span>${side.name}</span>
      <small>${formationLabel(side.formation)}</small>
    </h2>
    <div class="opponent__body">
      <${PitchView}
        formation=${side.formation}
        players=${players}
        label=${`${side.name} XI`}
        aspect="4 / 4.6"
        class="opponent__pitch"
        hideRatings=${hideRatings}
      />
      <div class="opponent__keys">
        <span class="tactics__label">Key players</span>
        <ul role="list" class="opponent__list">
          ${top.map(
            ({ view, r }) =>
              html`<li key=${view.id}>
                <${Flag}
                  code=${view.nation?.code}
                  name=${view.nation?.name}
                  size=${22}
                  decorative
                />
                <span class="opponent__name truncate">${view.name}</span>
                <span class="opponent__pos">${view.position}</span>
                ${!hideRatings && html`<b class="num">${Math.round(r)}</b>`}
              </li>`,
          )}
        </ul>
      </div>
    </div>
  </section>`;
}

function Lineup({ side, index, players, title, hideRatings }) {
  const [picked, setPicked] = useState(null);
  const strength = useMemo(() => lineupStrength(side.players, side.formation), [side]);
  const highlights = useMemo(
    () => lineupHighlights(side, picked, hideRatings),
    [side, picked, hideRatings],
  );
  useEffect(() => setPicked(null), [side.formation, index]);
  const onSelect = slot => {
    if (picked == null) setPicked(slot);
    else if (picked === slot) setPicked(null);
    else {
      if (!swapPlayers(index, picked, slot))
        toast({ title: 'Keepers only in goal', tone: 'warning', duration: 2500 });
      setPicked(null);
    }
  };
  const pickedName = picked != null ? players[picked]?.name : null;
  return html`<section class="pm-panel lineup" aria-labelledby=${`lineup-${index}`}>
    <div class="lineup__head">
      <h2 class="pm-panel__title" id=${`lineup-${index}`}>${title}</h2>
      <label class="lineup__formation">
        <span class="visually-hidden">Formation</span>
        <${Icon} name="layout-grid" size=${16} />
        <select
          value=${side.formation}
          onChange=${e => changeFormation(index, e.currentTarget.value)}
          data-testid="formation-select"
        >
          ${FORMATION_OPTIONS.map(o => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
        </select>
      </label>
    </div>
    <p class="lineup__hint" aria-live="polite">
      ${
        pickedName
          ? html`<${Icon} name="arrow-up-down" size=${14} /> Tap where ${pickedName} should play.`
          : 'Tap two players to swap them. Tags show anyone out of position.'
      }
    </p>
    <${PitchView}
      formation=${side.formation}
      players=${players}
      highlights=${highlights}
      links=${linkLines(strength.links.pairs)}
      selected=${picked}
      onSelect=${onSelect}
      label=${`${side.name} lineup`}
      class="draft-pitch lineup__pitch"
      hideRatings=${hideRatings}
    />
    <p class="lineup__links">
      <${Icon} name="link" size=${14} />
      Links <b class="num">${strength.links.score}</b>/${strength.links.maxScore}
    </p>
  </section>`;
}

export default function PrematchScreen() {
  const data = useStore(prematchStore);
  const [catalog, setCatalog] = useState(null);
  const [edit, setEdit] = useState(0);
  const [busy, setBusy] = useState(false);
  const wide = useMedia();
  useEffect(() => {
    let live = true;
    loadCatalog()
      .then(c => live && setCatalog(c))
      .catch(() => live && setCatalog(false));
    const idle = globalThis.requestIdleCallback || (fn => setTimeout(fn, 300));
    idle(() => preloadRoutes(['/match']));
    return () => {
      live = false;
    };
  }, []);
  const toView = useMemo(() => (catalog ? makePlayerView(catalog) : null), [catalog]);
  const views = useMemo(
    () =>
      data && toView
        ? data.sides.map(s =>
            s.players.map((p, i) => ({
              ...toView(p),
              ovr: Math.round(roleRating(p, FORMATIONS[s.formation][i][2])),
              tier: tierOf(naturalRating(p)).name,
            })),
          )
        : null,
    [data, toView],
  );
  const strengths = useMemo(
    () => (data ? data.sides.map(s => lineupStrength(s.players, s.formation)) : null),
    [data],
  );

  if (!data)
    return html`<div class="screen container-narrow" data-screen="prematch">
      <${Card} variant="raised" padding="lg">
        <${EmptyState}
          icon="whistle"
          size="lg"
          level=${1}
          title="No match lined up"
          message="Draft a team first, then come back for the team talk."
          action=${html`<div class="cluster pm-empty__actions">
            <${Button} variant="primary" icon="zap" href="#/play/quick">Quick Match<//>
            <${Button} variant="secondary" icon="house" href="#/">Home<//>
          </div>`}
        />
      <//>
    </div>`;

  const editable = data.sides.map((s, i) => (s.editable ? i : null)).filter(i => i !== null);
  const editIndex = editable.includes(edit) ? edit : (editable[0] ?? 0);
  const editSide = data.sides[editIndex];
  const others = data.sides.map((s, i) => i).filter(i => !data.sides[i].editable);
  const start = () => {
    if (busy) return;
    setBusy(true);
    try {
      kickOff();
    } catch (error) {
      console.error('[prematch] kick-off failed', error);
      toast({
        title: 'Could not start the match',
        message: String(error.message || error),
        tone: 'danger',
      });
      setBusy(false);
    }
  };
  const cta = html`<${Button}
    variant="primary"
    size="xl"
    block
    icon="whistle"
    onClick=${start}
    loading=${busy}
    data-testid="kick-off"
    >Kick off<//
  >`;
  const viewPicker = html`<section class="pm-panel" aria-labelledby="view-title">
    <h2 class="pm-panel__title" id="view-title">Watch</h2>
    <${Segmented}
      label="How to watch"
      options=${VIEWS}
      value=${data.view}
      onChange=${setMatchView}
      block
    />
  </section>`;
  const loading = !views;

  return html`<div class=${cx('screen prematch', wide && 'is-wide')} data-screen="prematch">
    <div class="container prematch__layout">
      <header class="pm-head">
        <p class="eyebrow">${data.meta.title || 'Match'}</p>
        <h1 class="pm-head__title sr-only-mobile">Pre-match</h1>
      </header>
      <${Matchup} data=${data} strengths=${strengths}>${wide && cta}<//>
      ${
        editable.length > 1 &&
        html`<${Segmented}
          label="Edit team"
          options=${editable.map(i => ({ value: i, label: data.sides[i].name }))}
          value=${editIndex}
          onChange=${v => setEdit(Number(v))}
          block
          class="pm-switch"
        />`
      }
      <div class="prematch__main">
        ${
          loading
            ? html`<${Skeleton} variant="rect" height=${420} label="Loading lineups" />`
            : editable.length
              ? html`<${Lineup}
                  key=${editIndex}
                  side=${editSide}
                  index=${editIndex}
                  players=${views[editIndex]}
                  title=${editable.length > 1 ? `${editSide.name}’s lineup` : 'Your lineup'}
                  hideRatings=${data.hideRatings}
                />`
              : null
        }
      </div>
      <div class="prematch__side">
        ${editable.length > 0 && html`<${Tactics} key=${editIndex} side=${editSide} index=${editIndex} />`}
        ${
          !loading &&
          others.map(
            i =>
              html`<${Opponent}
                key=${i}
                side=${data.sides[i]}
                players=${views[i]}
                hideRatings=${data.hideRatings}
              />`,
          )
        }
        ${viewPicker}
      </div>
      ${!wide && html`<div class="action-bar prematch__bar">${cta}</div>`}
    </div>
  </div>`;
}
