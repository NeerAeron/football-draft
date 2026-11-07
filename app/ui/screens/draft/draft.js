// Draft board (#/draft): one-tap spin → honest reel → pool with visible fit → select →
// place (pitch highlights) → lock. Live meters (team OVR, lines, Links, projection),
// Versus turns with a pass-the-device interstitial, pick moments and the completion sheet.
// Phones: one column with a sticky action bar and a pick sheet. Desktop (≥ 960 px): the XI
// on the left, spin + pool on the right, a dock for the selected player.
// State lives in lib/draft-store.js (persisted after every action).
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { useStore } from '../../lib/store.js';
import { isReducedMotion } from '../../lib/motion.js';
import { playCue } from '../../lib/audio.js';
import { makePlayerView } from '../../lib/player-view.js';
import { preloadRoutes } from '../../lib/screen-loader.js';
import { selectionSound } from '../../../services/sound.js';
import {
  draftStore,
  loadDraft,
  currentDraft,
  spinDraft,
  rerollDraft,
  pickPlayer,
  autoPick,
  autoComplete,
  markLanded,
  finishDraft,
  contextRules,
  modeLabel,
  difficultyLabel,
} from '../../lib/draft-store.js';
import { Button, Card, EmptyState, Skeleton, toast } from '../../components/index.js';
import { useMedia } from './use-media.js';
import {
  CATEGORY_LABEL,
  slotHighlights,
  draftProjection,
  landedAnnouncement,
  pickPreview,
  rowStats,
} from './draft-model.js';
import { SpinStage } from './spin-stage.js';
import { PoolPanel } from './pool-list.js';
import {
  TeamSummary,
  TeamPitch,
  LineMeters,
  VersusStrip,
  Progress,
  History,
} from './team-panel.js';
import { PickSheet, PickDock } from './pick-panel.js';
import { CompleteSheet } from './complete-sheet.js';
import { PickMoment, PassDevice } from './moments.js';

const KIND_TITLE = {
  run: 'World Cup Run',
  quick: 'Quick Match',
  versus: 'Versus',
  daily: 'Daily Challenge',
};

export default function DraftScreen({ query = {} }) {
  const state = useStore(draftStore);
  useEffect(() => {
    if (!currentDraft()) loadDraft();
  }, []);
  const draft = currentDraft();
  if (state.status === 'ready' && draft && state.snap)
    return html`<${Board} state=${state} draft=${draft} auto=${query.auto === '1'} />`;
  if (state.status === 'empty' || state.status === 'error') {
    const error = state.status === 'error';
    return html`<div class="screen container-narrow draft-empty" data-screen="draft">
      <${Card} variant="raised" padding="lg">
        <${EmptyState}
          icon=${error ? 'triangle-alert' : 'reel'}
          tone=${error ? 'coral' : 'volt'}
          size="lg"
          level=${1}
          title=${error ? 'This draft cannot continue' : 'No draft in progress'}
          message=${
            error
              ? 'The saved draft no longer matches the player database. Start a new one.'
              : 'Pick a mode and spin your first nation, league or club.'
          }
          action=${html`<div class="cluster draft-empty__actions">
            <${Button} variant="primary" icon="trophy" href="#/play/run">World Cup Run<//>
            <${Button} variant="secondary" icon="zap" href="#/play/quick">Quick Match<//>
          </div>`}
        />
      <//>
    </div>`;
  }
  return html`<div class="screen container draft" data-screen="draft" aria-busy="true">
    <h1 class="visually-hidden">Draft</h1>
    <div class="draft-loading">
      <${Skeleton} variant="rect" height=${140} label="Loading the draft" />
      <${Skeleton} variant="row" lines=${6} />
    </div>
  </div>`;
}

function useAnnouncer() {
  const [text, setText] = useState('');
  const announce = useCallback(t => setText(t), []);
  return [text, announce];
}

function Board({ state, draft, auto }) {
  const { snap, context, animate, lastPick } = state;
  const { session, catalog } = draft;
  const wide = useMedia();
  const hide = context.options.hideRatings;
  const side = snap.turn;
  const team = snap.teams[side];
  const [shownSide, setShownSide] = useState(side);
  const [sel, setSel] = useState(null); // { id, target }
  const [xiOpen, setXiOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(snap.complete && !auto);
  const [busy, setBusy] = useState(false);
  const [passAck, setPassAck] = useState(-1);
  const [moment, setMoment] = useState(null);
  const [announcement, announce] = useAnnouncer();
  const seenPick = useRef(lastPick?.token);

  // ---- views ----
  const toView = useMemo(() => makePlayerView(catalog), [catalog]);
  const entryView = useMemo(() => {
    const cache = new WeakMap();
    return e => {
      let v = cache.get(e);
      if (!v) {
        const base = toView(session.player(e.profileId));
        v = { ...base, ovr: e.ovr, tier: e.tier, stats: rowStats(base.stats, base.position) };
        cache.set(e, v);
      }
      return v;
    };
  }, [toView, session]);
  const lookups = useMemo(
    () => ({
      nations: new Map((catalog.nations || []).map(n => [n.name, n])),
      leagues: new Map(catalog.leagues.map(l => [String(l.id), l])),
      teams: new Map(catalog.teams.map(t => [String(t.id), t])),
    }),
    [catalog],
  );
  const history = useMemo(() => {
    const shown = snap.sides === 2 ? shownSide : 0;
    return snap.history
      .filter(h => h.side === shown)
      .map(h => {
        const slot = snap.teams[h.side].slots[h.slot];
        const n = lookups.nations.get(h.optionId);
        const l = lookups.leagues.get(String(h.optionId));
        const c = lookups.teams.get(String(h.optionId));
        const media =
          h.category === 'nation'
            ? { flag: { code: n?.code, name: h.optionName, src: n?.flag } }
            : h.category === 'league'
              ? { logo: { src: l?.logo, name: h.optionName } }
              : {
                  crest: { name: h.optionName, colors: [c?.primary, c?.secondary].filter(Boolean) },
                };
        return {
          key: `${h.side}:${h.round}`,
          round: h.round + 1,
          category: h.category,
          from: h.optionName,
          media,
          name: slot.player?.name || '',
          role: slot.role,
          rating: slot.rating,
        };
      })
      .reverse();
  }, [snap, lookups, shownSide]);
  const teamPlayers = useMemo(
    () =>
      snap.teams.map(t =>
        t.slots.map(s =>
          s.player
            ? { ...toView(session.player(s.player.profileId)), ovr: s.rating, tier: s.player.tier }
            : null,
        ),
      ),
    [snap, toView, session],
  );

  // ---- selection and placement ----
  const spinId = snap.spin
    ? `${snap.pickIndex}:${snap.spin.option.id}:${snap.spin.reroll}`
    : `idle:${snap.pickIndex}`;
  useEffect(() => setSel(null), [spinId]);
  useEffect(() => setShownSide(side), [side]);
  const entry = sel ? snap.pool.find(e => e.profileId === sel.id && e.available) : null;
  const placement = useMemo(
    () =>
      entry
        ? {
            options: session.placementOptions(entry.profileId),
            auto: session.autoSlot(entry.profileId),
          }
        : null,
    [entry, snap],
  );
  const target = entry ? (sel.target ?? placement?.auto?.slot ?? null) : null;
  const highlights = placement
    ? slotHighlights(placement.options, placement.auto, { hideRatings: hide })
    : null;
  const preview = useMemo(
    () => (entry && target != null ? pickPreview(session, side, entry.profileId, target) : null),
    [entry, target, snap],
  );

  // ---- projection ----
  const projection = useMemo(
    () =>
      draftProjection({
        kind: context.kind,
        mode: context.mode,
        difficulty: context.difficulty,
        teams: snap.teams,
        side: context.kind === 'versus' ? shownSide : 0,
        rules: contextRules(context),
        rerolls: context.rerolls ?? undefined,
      }),
    [snap.teams, shownSide, context],
  );

  // ---- effects: pick moments, completion, test auto-complete ----
  useEffect(() => {
    if (!lastPick || lastPick.token === seenPick.current) return;
    seenPick.current = lastPick.token;
    const star = !hide && (lastPick.tier === 'Star' || lastPick.tier === 'Superstar');
    playCue(hide ? 'pick' : selectionSound(lastPick.tier));
    announce(
      `Drafted ${lastPick.name} at ${lastPick.role}.` +
        (snap.sides === 2 && !snap.complete ? ` ${snap.teams[snap.turn].name} to pick.` : ''),
    );
    if (star && !isReducedMotion()) setMoment(lastPick);
  }, [lastPick?.token]);
  useEffect(() => {
    if (!snap.complete) return;
    idlePreload(['/prematch', '/match']);
    const delay = isReducedMotion() || auto ? 0 : moment ? 1500 : 650;
    const t = setTimeout(() => setCompleteOpen(true), delay);
    return () => clearTimeout(t);
  }, [snap.complete]);
  useEffect(() => {
    if (auto && !snap.complete) autoComplete();
  }, [auto]);
  useEffect(() => {
    if (!wide || !sel) return;
    const onKey = e => e.key === 'Escape' && setSel(null);
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [wide, !!sel]);

  // ---- actions ----
  const spin = () => {
    setPassAck(snap.pickIndex);
    if (!spinDraft()) return;
    playCue('tick');
  };
  const reroll = () => {
    if (rerollDraft()) announce('Re-rolling…');
  };
  const onLanded = () => {
    markLanded();
    playCue('reveal');
    announce(landedAnnouncement(snap.spin, snap.pool.length));
  };
  const select = id => {
    setSel(s => (s?.id === id && wide ? null : { id, target: null }));
    setShownSide(side);
  };
  const confirm = () => {
    if (!entry || target == null) return;
    const result = pickPlayer(entry.profileId, target);
    if (!result.ok)
      toast({ title: 'Cannot place him there', message: result.reason, tone: 'warning' });
    else setSel(null);
  };
  const quickDraft = id => {
    const result = pickPlayer(id);
    if (!result.ok)
      toast({ title: 'No open slot for him', message: result.reason, tone: 'warning' });
  };
  const onSlot = slot => {
    const option = placement?.options[slot];
    if (!option?.allowed) return;
    if (slot === target) confirm();
    else setSel(s => ({ ...s, target: slot }));
  };
  const doAutoPick = () => {
    setPassAck(snap.pickIndex);
    const result = autoPick();
    if (result && !result.ok)
      toast({ title: 'Auto-pick failed', message: result.reason, tone: 'warning' });
  };
  const onContinue = async () => {
    setBusy(true);
    try {
      await finishDraft();
    } catch (error) {
      console.error('[draft] continue failed', error);
      toast({
        title: 'Something went wrong',
        message: String(error.message || error),
        tone: 'danger',
      });
      setBusy(false);
    }
  };

  // ---- derived UI state ----
  const animating = animate != null && !!snap.spin;
  const phase = snap.complete ? 'complete' : animating ? 'spinning' : snap.phase;
  const versus = snap.sides === 2;
  const shownTeam = snap.teams[versus ? shownSide : 0];
  const needPass =
    versus && !snap.complete && snap.phase === 'spin' && !animating && passAck !== snap.pickIndex;
  const turnName = versus ? team.name : null;
  const rerollsLeft = snap.rerolls[side];
  const placing = !!(entry && highlights) && shownSide === side;
  const momentView =
    moment && session.player(moment.profileId)
      ? { ...toView(session.player(moment.profileId)), ovr: moment.ovr, tier: moment.tier }
      : null;
  const eyebrow = `${modeLabel(context.type)} draft${
    context.kind === 'versus' ? '' : ` · ${difficultyLabel(context.difficulty)}`
  }${hide ? ' · Ratings hidden' : ''}`;

  const summary = html`<${TeamSummary}
    team=${shownTeam}
    projection=${projection}
    hideRatings=${hide}
    preview=${placing ? preview : null}
    compact=${!wide}
    showOvr=${!versus}
  />`;
  const pitch = html`<${TeamPitch}
    team=${shownTeam}
    players=${teamPlayers[versus ? shownSide : 0]}
    highlights=${wide && placing ? highlights : null}
    selected=${wide && placing ? target : null}
    onSelect=${wide && placing ? onSlot : undefined}
    hideRatings=${hide}
    aspect=${wide ? '4 / 4.8' : undefined}
  />`;
  const spinLabel = `Spin ${versus ? `· ${team.name}` : `a ${CATEGORY_LABEL[snap.category]?.toLowerCase()}`}`;
  const spinButton = html`<${Button}
    variant="primary"
    size=${wide ? 'lg' : 'xl'}
    block
    icon="reel"
    onClick=${spin}
    data-testid="spin"
    >${spinLabel}<//
  >`;
  const rerollButton = html`<${Button}
    variant="secondary"
    size=${wide ? 'md' : 'lg'}
    icon="rotate-ccw"
    onClick=${reroll}
    disabled=${!snap.canReroll}
    data-testid="reroll"
    class="draft-bar__reroll"
    >${
      rerollsLeft > 0
        ? html`Re-roll<span class="draft-bar__count num">${rerollsLeft} left</span>`
        : 'No re-rolls left'
    }<//
  >`;
  const doneButton = html`<${Button}
    variant="primary"
    size=${wide ? 'lg' : 'xl'}
    block
    iconEnd="arrow-right"
    onClick=${() => setCompleteOpen(true)}
    data-testid="draft-done"
    >Continue<//
  >`;
  // Desktop: the stage carries its own buttons; phones: the sticky action bar does.
  const stageActions =
    wide &&
    (snap.complete
      ? doneButton
      : animating
        ? null
        : snap.phase === 'spin'
          ? spinButton
          : html`<div class="stage__row">
              <p class="stage__hint">
                Select a player: the pitch lights up where he fits. Double-click drafts him to his
                best slot.
              </p>
              ${rerollButton}
            </div>`);
  const stage = html`<${SpinStage}
    snap=${snap}
    animate=${animating ? animate : null}
    onLanded=${onLanded}
    onAutoPick=${doAutoPick}
    turnName=${turnName}
    actions=${stageActions}
  />`;
  const pool =
    snap.phase === 'pick' &&
    !animating &&
    html`<${PoolPanel}
      pool=${snap.pool}
      spinId=${spinId}
      toView=${entryView}
      hideRatings=${hide}
      selectedId=${entry?.profileId}
      onSelect=${select}
      onDraft=${wide ? quickDraft : undefined}
      heading=${versus ? `${team.name}: pick a player` : 'Pick a player'}
    />`;

  let bar = null;
  if (wide)
    bar =
      entry &&
      html`<${PickDock}
        entry=${entry}
        view=${entryView(entry)}
        team=${team}
        highlights=${highlights}
        options=${placement.options}
        auto=${placement.auto}
        target=${target}
        onTarget=${slot => setSel(s => ({ ...s, target: slot }))}
        onConfirm=${confirm}
        onCancel=${() => setSel(null)}
        preview=${preview}
        hideRatings=${hide}
      />`;
  else if (snap.complete) bar = doneButton;
  else if (animating)
    bar = html`<${Button} variant="secondary" size="xl" block disabled loading>Spinning<//>`;
  else if (snap.phase === 'spin') bar = spinButton;
  else bar = rerollButton;

  const head = html`<header class="draft-head">
    <div class="draft-head__titles">
      <p class="eyebrow">${eyebrow}</p>
      <h1 class="draft-head__title sr-only-mobile">${KIND_TITLE[context.kind] || 'Draft'}</h1>
    </div>
    <div class="draft-head__progress">
      <span class="draft-head__count num">${team.filled}<small>/11</small></span>
      <${Progress} filled=${team.filled} label=${`${team.name}: ${team.filled} of 11 picked`} />
    </div>
  </header>`;
  const vstrip =
    versus &&
    html`<${VersusStrip}
      teams=${snap.teams}
      turn=${snap.turn}
      shown=${shownSide}
      onShow=${setShownSide}
      complete=${snap.complete}
      hideRatings=${hide}
    />`;
  const xiLabel = `${xiOpen ? 'Hide' : 'Show'} ${versus ? `${shownTeam.name}’s` : 'your'} XI`;

  return html`<div
    class=${cx('screen draft', wide && 'is-wide', versus && 'is-versus')}
    data-screen="draft"
    data-phase=${phase}
  >
    <div class="container draft__layout">
      ${head}
      ${
        wide
          ? html`<aside class="draft__team" aria-label="Your XI">
                ${vstrip} ${summary} ${pitch}
                <${LineMeters} team=${shownTeam} hideRatings=${hide} />
              </aside>
              <div class="draft__play">
                ${stage} ${pool}
                ${snap.phase !== 'pick' && html`<${History} entries=${history} hideRatings=${hide} />`}
                ${bar && html`<div class="action-bar draft__bar">${bar}</div>`}
              </div>`
          : html`${vstrip} ${summary} ${stage}
              ${
                snap.phase === 'pick' && !animating
                  ? html`<button
                        type="button"
                        class="xi-toggle"
                        aria-expanded=${String(xiOpen)}
                        onClick=${() => setXiOpen(!xiOpen)}
                      >
                        <span>${xiLabel}</span>
                        <${Progress} filled=${shownTeam.filled} />
                      </button>
                      ${xiOpen && pitch} ${pool}`
                  : html`${pitch} <${LineMeters} team=${shownTeam} hideRatings=${hide} />`
              }
              <div class="action-bar draft__bar">${bar}</div>`
      }
    </div>
    ${
      !wide &&
      html`<${PickSheet}
        open=${!!entry}
        onClose=${() => setSel(null)}
        entry=${entry}
        view=${entry ? entryView(entry) : null}
        team=${team}
        teamPlayers=${teamPlayers[side]}
        highlights=${highlights || {}}
        options=${placement?.options || []}
        auto=${placement?.auto}
        target=${target}
        onTarget=${onSlot}
        onConfirm=${confirm}
        preview=${preview}
        hideRatings=${hide}
        eyebrow=${`${turnName ? `${turnName} · ` : ''}Pick ${team.filled + 1} of 11`}
      />`
    }
    ${
      snap.complete &&
      html`<${CompleteSheet}
        open=${completeOpen}
        onClose=${() => setCompleteOpen(false)}
        snap=${snap}
        context=${context}
        teamPlayers=${teamPlayers}
        onContinue=${onContinue}
        busy=${busy}
      />`
    }
    ${
      versus &&
      html`<${PassDevice}
        open=${needPass}
        team=${team}
        first=${snap.pickIndex === 0}
        pickIndex=${snap.pickIndex}
        totalPicks=${snap.totalPicks}
        onSpin=${spin}
        onView=${() => setPassAck(snap.pickIndex)}
      />`
    }
    <${PickMoment} moment=${moment} view=${momentView} />
    <p class="visually-hidden" aria-live="polite" aria-atomic="true">${announcement}</p>
  </div>`;
}

function idlePreload(paths) {
  const idle = globalThis.requestIdleCallback || (fn => setTimeout(fn, 300));
  idle(() => preloadRoutes(paths));
}
