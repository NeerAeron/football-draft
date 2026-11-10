// World Cup Run hub (#/run): arrival after the draft (the group draw), the path G1…F, the
// next fixture with odds and stakes, the live group table and matchday results, the knockout
// path, the four ways to play the next match — watch the highlights or the full match (→
// pre-match with that view → match → back here), simulate this match, simulate the whole cup
// (results ticker) — and the end screen. Rules: core/competition/cup.js; persistence: lib/run-store.js.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { href, navigate } from '../../lib/router.js';
import { isReducedMotion } from '../../lib/motion.js';
import { playCue } from '../../lib/audio.js';
import { loadWarmCatalog, warmOpponents } from '../../lib/catalog-warm.js';
import { Button } from '../../components/button.js';
import { Chip } from '../../components/chip.js';
import { Icon } from '../../components/icon.js';
import { Modal } from '../../components/modal.js';
import { PitchView } from '../../components/pitch-view.js';
import { EmptyState } from '../../components/empty-state.js';
import { Skeleton } from '../../components/skeleton.js';
import { toast } from '../../components/toast.js';
import { completedDraft, clearDraft, loadDraft } from '../../lib/draft-store.js';
import { openPrematch, engineCompetition } from '../../lib/prematch-store.js';
import {
  buildMatchConfig,
  readMatchResult,
  runResultFor,
  clearMatch,
  matchStore,
} from '../../lib/match-store.js';
import {
  createRunFromDraft,
  loadRun,
  saveRun,
  patchRunState,
  clearRun,
  matchSideFor,
  fixtureId,
  fixtureOdds,
  groupStakes,
  THIRD_PLACE_RULE,
  logEntry,
  withLog,
  roundLabel,
  roundName,
  userTeamName,
} from '../../lib/run-store.js';
import { readSavedRun } from '../../lib/saved.js';
import { useSimTicker } from './sim-ticker.js';
import {
  PathStrip,
  OddsBar,
  StakesRow,
  GroupTable,
  MatchdayList,
  KnockoutPath,
  ResultsTicker,
  TeamMark,
  FlagMosaic,
  OutcomeChip,
  opponentTeam,
  teamOf,
  wonResult,
} from './run-parts.js';
import { RunEnd } from './run-end.js';
import { xiViews, nationList, modeLabel, levelLabel } from './team-view.js';
import { formationLabel } from '../../../core/players/formations.js';
import { fmt1 } from '../../lib/format.js';

/** The finished match for a pending fixture (by id, or the same seed in a run context). */
function pendingResult(pending) {
  const byId = readMatchResult(pending.id);
  if (byId) return byId;
  const state = matchStore.get();
  if (
    state?.result &&
    state.request?.seed === pending.seed &&
    state.request?.meta?.context === 'run'
  )
    return state.result;
  return null;
}
function matchInProgress(pending) {
  const state = matchStore.get();
  return (
    !!pending &&
    !!state?.request &&
    !state.result &&
    (state.request.id === pending.id || state.request.seed === pending.seed)
  );
}
/** Engine config for a run fixture (auto-sim; the match screen builds the same via prematch). */
export function fixtureConfig(m, difficulty, tuning) {
  return buildMatchConfig({
    sides: [matchSideFor(m.home, { kind: 'user' }), matchSideFor(m.away)],
    // Same engine competition as the pre-match screen builds (AI coach level by difficulty).
    competition: engineCompetition({
      sides: [{ kind: 'user' }, { kind: 'ai' }],
      competition: { mode: 'ai', difficulty, knockout: m.knockout },
    }),
    ...(tuning ? { tuning } : {}),
  });
}
const positions = snapshot =>
  Object.fromEntries(snapshot.group.table.map(r => [r.key, r.position]));
/** The other group fixture of a matchday (AI v AI). */
const elsewhereOf = (snapshot, md) =>
  snapshot.group.fixtures.find(f => f.md === md && f.home !== 'user' && f.away !== 'user');
const scorerLine = (entry, side = 0) =>
  (entry?.goals || [])
    .filter(g => g.team === side)
    .map(g => `${g.name ? g.name.replace(/^(?:\p{L}\.\s*)+/u, '') : 'OG'} ${g.minute || ''}`.trim())
    .join(', ');

// ---------------------------------------------------------------------------------------------

function RunHeader({ snapshot, meta, nations }) {
  const r = snapshot.record;
  return html`<header class="run-head">
    <div class="run-head__id">
      <${FlagMosaic} nations=${nations} size=${30} max=${6} class="run-head__flags" />
      <div class="run-head__titles">
        <p class="eyebrow">
          ${`World Cup Run · ${modeLabel(snapshot.mode)} · ${levelLabel(snapshot.difficulty)}${meta.challenge ? ' · Challenge' : ''}`}
        </p>
        <h1 class="run-head__title">
          <span class="visually-hidden">World Cup Run: </span>${userTeamName(snapshot.user.name)}
        </h1>
        <p class="run-head__meta">
          ${
            meta.hideRatings
              ? 'Ratings hidden'
              : [
                  html`<b class="num" key="o">${fmt1(snapshot.user.rating)}</b>`,
                  ' OVR',
                  meta.links?.total != null ? ' · Boosts ' : '',
                  meta.links?.total != null
                    ? html`<b class="num" key="l">+${meta.links.total}</b>`
                    : '',
                  ` · ${formationLabel(meta.formation || '433')}`,
                ]
          }
        </p>
      </div>
    </div>
    <div class="run-head__record" aria-label=${`Record ${r.w} won, ${r.d} drawn, ${r.l} lost`}>
      <span class="run-head__wdl num">${r.w}–${r.d}–${r.l}</span>
      <span class="run-head__stage"
        >${snapshot.complete ? 'Final record' : snapshot.stageLabel}</span
      >
      ${
        meta.challenge?.by &&
        html`<${Chip} tone="gold" size="sm" icon="swords" class="run-head__target"
          >${`To beat: ${meta.challenge.by}`}<//
        >`
      }
    </div>
  </header>`;
}

function DrawBanner({ snapshot, hideRatings }) {
  const group = snapshot.rounds.slice(0, 3).map(r => r.opponent);
  const [shown, setShown] = useState(isReducedMotion() ? 3 : 0);
  useEffect(() => {
    if (shown >= 3) return undefined;
    const t = setTimeout(() => {
      setShown(n => n + 1);
      playCue('reveal');
    }, 520);
    return () => clearTimeout(t);
  }, [shown]);
  return html`<section
    class="run-flash run-flash--draw card card--hero card--pad-md"
    aria-labelledby="draw-title"
  >
    <p class="eyebrow">The draw</p>
    <h2 id="draw-title" class="run-flash__title">Welcome to Group A</h2>
    <ul class="draw-list" role="list">
      ${group.map(
        (o, i) =>
          html`<li key=${o.key} class=${cx('draw-team', i < shown && 'is-shown')}>
            <span class="draw-team__pot">Pot ${o.pot}</span>
            <${TeamMark} team=${opponentTeam(o)} size=${44} />
            <span class="draw-team__name">${o.name}</span>
            ${!hideRatings && html`<span class="draw-team__rating num">${fmt1(o.rating)}</span>`}
          </li>`,
      )}
    </ul>
    <p class="run-flash__note text-3">
      ${`Top two go through to the Round of 32. ${THIRD_PLACE_RULE} Then five knockout matches: win them all for the trophy, or play for third place after a lost semi-final.`}
    </p>
  </section>`;
}

function ResultBanner({ snapshot, before, round, entry }) {
  const r = snapshot.rounds[round];
  const res = r.result;
  const md = round + 1;
  const other = round < 3 ? elsewhereOf(snapshot, md) : null;
  const [revealed, setRevealed] = useState(isReducedMotion() || !other);
  useEffect(() => {
    if (revealed) return undefined;
    const t = setTimeout(() => {
      setRevealed(true);
      playCue('tick');
    }, 1400);
    return () => clearTimeout(t);
  }, []);
  const won = wonResult(res);
  const team = opponentTeam(r.opponent);
  const groupDone = round === 2;
  const userPos = snapshot.group.table.find(t => t.user)?.position;
  const headline =
    round >= 3
      ? r.id === 'third'
        ? won
          ? 'Third place!'
          : 'Fourth place'
        : won
          ? r.id === 'final'
            ? 'Champions!'
            : `Through to the ${roundLabel(snapshot.rounds[round + 1]).toLowerCase()}`
          : r.id === 'sf'
            ? 'Beaten. Third place is still to play for'
            : r.id === 'final'
              ? 'Runners-up'
              : 'Knocked out'
      : groupDone
        ? snapshot.status !== 'eliminated'
          ? userPos <= 2
            ? `Through as group ${userPos === 1 ? 'winners' : 'runners-up'}`
            : 'Through as one of the best thirds'
          : 'Out of the group'
        : res.outcome === 'W'
          ? 'Three points'
          : res.outcome === 'D'
            ? 'A point on the board'
            : 'Defeat';
  const ours = scorerLine(entry, 0),
    theirs = scorerLine(entry, 1);
  return html`<section
    class=${cx('run-flash run-flash--result card card--pad-md', won ? 'is-win' : res.outcome === 'D' ? 'is-draw' : 'is-loss')}
    aria-labelledby="ft-title"
    data-testid="result-banner"
  >
    <div class="ft">
      <p class="eyebrow">${`Full time · ${roundLabel(r)}`}</p>
      <h2 class="run-flash__title" id="ft-title">${headline}</h2>
      <div class="ft__score">
        <span class="ft__team"
          ><${TeamMark} team=${{ user: true }} size=${36} /><span
            >${userTeamName(snapshot.user.name)}</span
          ></span
        >
        <span class="ft__nums num"
          >${res.goalsFor}<span class="ft__dash">–</span>${res.goalsAgainst}</span
        >
        <span class="ft__team is-away"
          ><span>${team.name}</span><${TeamMark} team=${team} size=${36}
        /></span>
      </div>
      ${
        res.shootout &&
        html`<p class="ft__pens">
          ${`${res.shootout.winner === 'user' ? 'Won' : 'Lost'} on penalties${res.shootout.score ? ` ${res.shootout.score[0]}–${res.shootout.score[1]}` : ''}`}
        </p>`
      }
      ${
        (ours || theirs) &&
        html`<p class="ft__scorers">
          <span>${ours}</span>
          ${ours && theirs && html`<${Icon} name="goal" size=${14} />`}
          <span class="is-away">${theirs}</span>
        </p>`
      }
    </div>
    ${
      other &&
      html`<div class=${cx('elsewhere', revealed && 'is-revealed')} aria-live="polite">
        <span class="elsewhere__label">Elsewhere in Group A</span>
        <span class="elsewhere__fixture">
          <span class="truncate">${teamOf(snapshot, other.home).name}</span>
          <span class="elsewhere__score num"
            >${revealed ? `${other.score[0]}–${other.score[1]}` : html`<span class="elsewhere__dots" aria-label="Result coming in">•••</span>`}</span
          >
          <span class="truncate">${teamOf(snapshot, other.away).name}</span>
        </span>
      </div>`
    }
  </section>`;
}

/**
 * The four ways to play the next match. `view`: the pre-match opens with it selected ('key' =
 * highlights, 'full'); `sim`: 'match' (this fixture only) or 'cup' (every remaining match).
 */
export const PLAY_OPTIONS = [
  { id: 'key', view: 'key', icon: 'play', title: 'Watch highlights', hint: '1 min', primary: true },
  { id: 'full', view: 'full', icon: 'tv', title: 'Watch full match', hint: '3 min' },
  { id: 'sim-match', sim: 'match', icon: 'zap', title: 'Simulate this match', hint: 'Result now' },
  {
    id: 'sim-cup',
    sim: 'cup',
    icon: 'fast-forward',
    title: 'Simulate the whole cup',
    hint: 'To the end',
  },
];
const OPTION_TESTID = {
  key: 'play-fixture',
  full: 'play-full',
  'sim-match': 'sim-match',
  'sim-cup': 'sim-rest',
};

function PlayOptions({ onPlay, onSim, onResume, busy, inProgress }) {
  return html`<div class="play-options" role="group" aria-label="How to play this match">
    ${
      inProgress &&
      html`<${Button}
        variant="primary"
        size="lg"
        block
        iconEnd="arrow-right"
        onClick=${onResume}
        data-testid="resume-fixture"
        class="play-options__resume"
        >Resume match<//
      >`
    }
    ${PLAY_OPTIONS.map(
      o =>
        html`<button
          key=${o.id}
          type="button"
          class=${cx('play-option', o.primary && !inProgress && 'is-primary')}
          disabled=${busy}
          onClick=${() => (o.view ? onPlay(o.view) : onSim(o.sim))}
          data-testid=${OPTION_TESTID[o.id]}
          data-option=${o.id}
        >
          <span class="play-option__icon" aria-hidden="true"
            ><${Icon} name=${o.icon} size=${20}
          /></span>
          <span class="play-option__text">
            <span class="play-option__title">${o.title}</span>
            <span class="play-option__hint">${o.hint}</span>
          </span>
        </button>`,
    )}
  </div>`;
}

function FixtureCard({ snapshot, meta, onPlay, onSim, onResume, busy, inProgress }) {
  const round = snapshot.round;
  const r = snapshot.rounds[round];
  const team = opponentTeam(r.opponent);
  const odds = useMemo(
    () => fixtureOdds(snapshot.user.effective, r.opponent.effective),
    [round, r.opponent.key, snapshot.user.effective],
  );
  const stakes = groupStakes(snapshot);
  const diff = snapshot.user.rating - r.opponent.rating;
  return html`<section
    class="fixture card card--raised card--pad-md"
    aria-labelledby="fixture-title"
    data-testid="next-fixture"
    data-round=${r.id}
  >
    <div class="fixture__top">
      <p class="eyebrow">
        ${round < 3 ? 'Next up · Group A' : r.id === 'third' ? 'Next up · For third place' : 'Next up · Knockout'}
      </p>
      ${r.opponent.pot && html`<${Chip} size="sm" variant="outline">Pot ${r.opponent.pot}<//>`}
    </div>
    <h2 class="fixture__title" id="fixture-title">${roundName(r)}</h2>
    <div class="fixture__vs">
      <div class="fixture__side">
        <${TeamMark} team=${{ user: true }} size=${64} />
        <span class="fixture__name">${userTeamName(snapshot.user.name)}</span>
        ${!meta.hideRatings && html`<span class="fixture__rating num">${fmt1(snapshot.user.rating)}</span>`}
      </div>
      <span class="fixture__v" aria-hidden="true">v</span>
      <div class="fixture__side">
        <${TeamMark} team=${team} size=${64} />
        <span class="fixture__name">${team.name}</span>
        ${!meta.hideRatings && html`<span class="fixture__rating num">${fmt1(r.opponent.rating)}</span>`}
      </div>
    </div>
    ${
      !meta.hideRatings &&
      html`<p class="fixture__edge">
        ${
          Math.abs(diff) < 0.5
            ? 'Evenly matched'
            : diff > 0
              ? `You are ${fmt1(diff)} stronger on paper`
              : `${team.name} are ${fmt1(-diff)} stronger on paper`
        }
      </p>`
    }
    ${!meta.hideRatings && html`<${OddsBar} odds=${odds} />`}
    <${StakesRow} stakes=${stakes} knockout=${r.knockout} round=${r.id} />
    <${PlayOptions}
      onPlay=${onPlay}
      onSim=${onSim}
      onResume=${onResume}
      busy=${busy}
      inProgress=${inProgress}
    />
  </section>`;
}

function SimPanel({ snapshot, sim, single, onSkip, onStop }) {
  const done = sim.items.filter(i => i.status === 'done').length;
  return html`<section
    class="sim card card--hero card--pad-md"
    aria-labelledby="sim-title"
    data-testid="sim-panel"
  >
    <div class="sim__head">
      <div>
        <p class="eyebrow">
          ${sim.finished ? (single ? 'Full time' : 'All played') : 'Simulating'}
        </p>
        <h2 class="run-flash__title" id="sim-title">
          ${single ? 'This match' : sim.finished ? 'The cup is decided' : 'The whole cup'}
        </h2>
      </div>
      <span class="sim__count num" aria-hidden="true">${done}/${sim.items.length}</span>
    </div>
    <div class="sim__progress" aria-hidden="true">
      <span style=${{ width: `${Math.round(sim.progress * 100)}%` }}></span>
    </div>
    <${ResultsTicker} items=${sim.items} snapshot=${snapshot} />
    <p class="visually-hidden" aria-live="polite">${sim.announce}</p>
    <div class="sim__actions">
      ${
        !sim.finished &&
        html`<${Button}
            variant="secondary"
            icon="skip-forward"
            onClick=${onSkip}
            disabled=${sim.skip}
            data-testid="sim-skip"
            >${sim.skip ? 'Skipping…' : 'Skip to result'}<//
          >
          ${
            !single &&
            html`<${Button} variant="ghost" onClick=${onStop} disabled=${sim.stop}
              >${sim.stop ? 'Stopping after this match' : 'Stop after this match'}<//
            >`
          }`
      }
    </div>
  </section>`;
}

function TeamPanel({ views, nations, meta, formation, snapshot }) {
  return html`<section class="card card--pad-md run-xi" aria-labelledby="run-xi-title">
    <div class="spread">
      <h2 class="section-title" id="run-xi-title">Your XI</h2>
      <${FlagMosaic} nations=${nations} size=${22} max=${5} />
    </div>
    <${PitchView}
      formation=${formation}
      players=${views.map(v => v.view)}
      hideRatings=${meta.hideRatings}
      label="Your XI"
    />
    ${
      !meta.hideRatings &&
      html`<p class="run-xi__foot text-3 text-sm">
        ${`Team OVR ${fmt1(snapshot.user.rating)} · ${fmt1(snapshot.user.effective)} with boosts`}
      </p>`
    }
  </section>`;
}

// ---------------------------------------------------------------------------------------------

export default function RunScreen() {
  const [state, setState] = useState({ phase: 'loading' });
  const ctx = useRef(null); // { catalog, run, meta, log, pending }
  const ticker = useSimTicker();
  const sim = ticker.state;
  const [confirm, setConfirm] = useState(false);

  const refresh = (patch = {}) =>
    setState(s => ({
      ...s,
      snapshot: ctx.current.run.snapshot(),
      phase: ctx.current.run.complete && !patch.keepHub ? 'end' : 'hub',
      ...patch,
    }));

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const catalog = await loadWarmCatalog().then(warmOpponents);
        if (!live) return;
        let saved = loadRun(catalog);
        let flash = null;
        // In memory right after the draft; restored from storage after a reload.
        const draft = completedDraft() ?? (await loadDraft());
        if (draft?.session?.complete && draft.context?.kind === 'run') {
          const { run, meta } = createRunFromDraft(catalog, draft);
          saveRun(run, meta, { pending: null, log: [] });
          clearDraft();
          saved = { run, meta, pending: null, log: [] };
          flash = { kind: 'draw' };
        }
        if (!saved) {
          setState({ phase: 'empty', last: readSavedRun() });
          return;
        }
        if (saved.pending && !saved.run.complete) {
          const result = pendingResult(saved.pending);
          if (result && saved.run.round === saved.pending.round) {
            const before = saved.run.snapshot();
            const round = saved.pending.round;
            const input = runResultFor(result, 0);
            if (!input.shootout && result.winner != null && input.goalsFor === input.goalsAgainst)
              input.shootout = { winner: result.winner === 0 ? 'user' : 'opponent', score: null };
            saved.run.recordResult(input);
            const entry = logEntry(round, result);
            saved.log = withLog(saved.log, entry);
            saved.pending = null;
            saveRun(saved.run, saved.meta, { pending: null, log: saved.log });
            clearMatch(result.id);
            flash = { kind: 'result', round, before, entry };
            playCue(input.outcome === 'L' ? 'full' : 'goal');
          } else if (saved.pending.round !== saved.run.round) {
            saved.pending = null;
            patchRunState({ pending: null });
          }
        }
        ctx.current = { catalog, ...saved };
        setState({
          phase: saved.run.complete ? 'end' : 'hub',
          snapshot: saved.run.snapshot(),
          flash,
          inProgress: matchInProgress(saved.pending),
        });
      } catch (error) {
        console.error('[run] could not load the run', error);
        if (live) setState({ phase: 'error', error });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (state.phase === 'end' || state.phase === 'sim') globalThis.scrollTo?.({ top: 0 });
  }, [state.phase]);

  const views = useMemo(
    () => (ctx.current ? xiViews(ctx.current.catalog, ctx.current.run.userSide()) : []),
    [state.phase === 'loading' ? null : ctx.current?.run],
  );
  const nations = useMemo(() => nationList(views), [views]);

  // Watch the next match: the pre-match opens with the chosen view ('key' = highlights, 'full').
  const play = view => {
    const { run, meta } = ctx.current;
    const m = run.nextMatch();
    if (!m) return;
    const id = fixtureId(meta, m.round);
    patchRunState({ pending: { id, round: m.round, seed: m.seed } });
    ctx.current.pending = { id, round: m.round, seed: m.seed };
    openPrematch({
      id,
      seed: m.seed,
      sides: [
        // The formation chosen before the draft is played in the first match; it can change
        // from the second one on.
        {
          ...matchSideFor(m.home, { kind: 'user', editable: true }),
          formationLocked: m.round === 0,
        },
        matchSideFor(m.away, { kind: 'ai', editable: false }),
      ],
      competition: { mode: 'ai', difficulty: run.difficulty, knockout: m.knockout },
      hideRatings: !!meta.hideRatings,
      ...(view ? { view } : {}),
      meta: {
        context: 'run',
        title: `${roundName(m)} · ${m.away.name}`,
        returnTo: '/run',
        fixture: id,
      },
    });
  };

  // Simulate with the engine: 'match' = the next fixture only (then its result banner),
  // 'cup' = every remaining match.
  const simulate = async what => {
    const c = ctx.current;
    const single = what === 'match';
    const before = c.run.snapshot();
    let flash = null;
    patchRunState({ pending: null });
    c.pending = null;
    setState(s => ({ ...s, phase: 'sim', single, flash: null, inProgress: false }));
    try {
      await ticker.start(c.run, {
        limit: single ? 1 : Infinity,
        configFor: m => fixtureConfig(m, c.run.difficulty),
        idFor: m => fixtureId(c.meta, m.round),
        onDone: (m, result, snapshot) => {
          const entry = result ? logEntry(m.round, result) : null;
          c.log = withLog(c.log, entry);
          saveRun(c.run, c.meta, { pending: null, log: c.log });
          if (single) flash = { kind: 'result', round: m.round, before, entry };
          setState(s => ({ ...s, snapshot }));
        },
      });
    } catch (error) {
      console.error('[run] simulation failed', error);
      toast({
        title: 'Simulation stopped',
        message: String(error.message || error),
        tone: 'warning',
      });
    }
    ticker.clear();
    refresh({ flash });
  };

  const abandon = () => {
    clearRun();
    setConfirm(false);
    navigate(href('/play/:mode', { mode: 'run' }, { type: ctx.current?.meta?.type || 'nations' }));
  };

  if (state.phase === 'loading')
    return html`<div class="screen container run" data-screen="run" aria-busy="true">
      <h1 class="visually-hidden">World Cup Run</h1>
      <${Skeleton} variant="rect" height=${120} label="Loading your run" />
      <div class="run-grid"><${Skeleton} variant="card" /><${Skeleton} variant="card" /></div>
    </div>`;

  if (state.phase === 'error')
    return html`<div class="screen container-narrow run" data-screen="run">
      <${EmptyState}
        icon="triangle-alert"
        tone="coral"
        level=${1}
        title="This run could not be loaded"
        message="The saved run does not match the player database. Start a new one."
        action=${html`<${Button} variant="primary" href=${href('/play/:mode', { mode: 'run' })}>New World Cup Run<//>`}
      />
    </div>`;

  if (state.phase === 'empty')
    return html`<div class="screen container-narrow run" data-screen="run">
      <${EmptyState}
        icon="trophy"
        tone="gold"
        size="lg"
        level=${1}
        title="No run in progress"
        message="Draft an XI one spin at a time, then take it through the group and five knockout matches."
        action=${html`<${Button}
          variant="primary"
          size="lg"
          iconEnd="arrow-right"
          href=${href('/play/:mode', { mode: 'run' })}
          data-testid="start-run"
          >Start a World Cup Run<//
        >`}
      />
    </div>`;

  const { run, meta, catalog } = ctx.current;
  const snapshot = state.snapshot;

  if (state.phase === 'end')
    return html`<div class="screen container run" data-screen="run">
      <${RunEnd}
        catalog=${catalog}
        run=${run}
        snapshot=${snapshot}
        meta=${meta}
        onCelebrated=${() => {
          ctx.current.meta = { ...meta, celebrated: true };
          saveRun(run, ctx.current.meta);
        }}
      />
    </div>`;

  const inGroup = !snapshot.complete && snapshot.round < 3;
  const flash = state.flash;
  const moves =
    flash?.kind === 'result' && flash.round < 3
      ? (() => {
          const a = positions(flash.before),
            b = positions(snapshot);
          return Object.fromEntries(Object.keys(b).map(k => [k, a[k] - b[k]]));
        })()
      : {};
  const groupSection = html`<section
    class="card card--pad-md run-group"
    aria-labelledby="group-title"
  >
    <div class="spread">
      <h2 class="section-title" id="group-title">Group A</h2>
      <span class="text-3 text-sm">Top two + best thirds</span>
    </div>
    <${GroupTable} snapshot=${snapshot} moves=${moves} />
    <p class="run-group__rule text-3 text-xs">${THIRD_PLACE_RULE}</p>
    <${MatchdayList} snapshot=${snapshot} live=${sim ? null : null} />
  </section>`;

  return html`<div class="screen container run" data-screen="run" data-phase=${state.phase}>
    <${RunHeader} snapshot=${snapshot} meta=${meta} nations=${nations} />
    <${PathStrip} snapshot=${snapshot} class="run-strip" />
    <div class="run-grid">
      <div class="run-main stack stack-lg">
        ${
          state.phase === 'sim' && sim
            ? html`<${SimPanel}
                snapshot=${snapshot}
                sim=${sim}
                single=${state.single}
                onSkip=${ticker.skip}
                onStop=${ticker.stop}
              />`
            : html`
                ${flash?.kind === 'draw' && html`<${DrawBanner} snapshot=${snapshot} hideRatings=${meta.hideRatings} />`}
                ${
                  flash?.kind === 'result' &&
                  html`<${ResultBanner}
                    snapshot=${snapshot}
                    before=${flash.before}
                    round=${flash.round}
                    entry=${flash.entry}
                  />`
                }
                <${FixtureCard}
                  snapshot=${snapshot}
                  meta=${meta}
                  onPlay=${play}
                  onSim=${simulate}
                  onResume=${() => navigate('/match')}
                  busy=${false}
                  inProgress=${state.inProgress}
                />
              `
        }
        ${inGroup || (state.phase === 'sim' && !state.single) ? groupSection : null}
      </div>
      <aside class="run-side stack stack-lg">
        <section class="card card--pad-md run-ko" aria-labelledby="ko-title">
          <h2 class="section-title" id="ko-title">Knockouts</h2>
          <${KnockoutPath} snapshot=${snapshot} />
        </section>
        ${!inGroup && !(state.phase === 'sim' && !state.single) ? groupSection : null}
        <${TeamPanel}
          views=${views}
          nations=${nations}
          meta=${meta}
          formation=${run.user.formation}
          snapshot=${snapshot}
        />
        <${Button}
          variant="ghost"
          size="sm"
          icon="trash"
          onClick=${() => setConfirm(true)}
          class="run-abandon"
          >Abandon this run<//
        >
      </aside>
    </div>
    <${Modal}
      open=${confirm}
      onClose=${() => setConfirm(false)}
      title="Abandon this run?"
      description="Your record and results are lost. You will draft a new XI."
      size="sm"
      footer=${html`<${Button} variant="ghost" onClick=${() => setConfirm(false)}>Keep playing<//>
        <${Button} variant="danger" onClick=${abandon} data-testid="confirm-abandon"
          >Abandon run<//
        >`}
    />
  </div>`;
}

// Re-exported for the daily screen and tests.
export { OutcomeChip };
