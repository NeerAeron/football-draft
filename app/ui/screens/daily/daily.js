// Daily Challenge (#/daily): today's rules, group and streak → the scheduled Nations draft
// (DRAFT-UI, returns here) → the whole World Cup simulated with the engine, live ticker + Skip
// → result card (points, grade, % of the perfect XI, streak, share). One attempt per UTC day;
// afterwards the day's result, a countdown and replays of your matches.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { href } from '../../lib/router.js';
import { useStore } from '../../lib/store.js';
import { prefs } from '../../lib/prefs.js';
import { isReducedMotion } from '../../lib/motion.js';
import { loadCatalog } from '../../../services/catalog.js';
import { DEFAULT_CONFIG } from '../../../core/config/config.js';
import { createCupRun, restoreCupRun } from '../../../core/competition/cup.js';
import {
  dailyChallenge,
  perfectXI,
  perfectPercent,
  dailyScore,
} from '../../../core/competition/daily.js';
import { shareText } from '../../../core/competition/share.js';
import { formationLabel } from '../../../core/players/formations.js';
import { Button } from '../../components/button.js';
import { Icon } from '../../components/icon.js';
import { GradeBadge } from '../../components/grade-badge.js';
import { StatTile } from '../../components/meter.js';
import { PitchView } from '../../components/pitch-view.js';
import { EmptyState } from '../../components/empty-state.js';
import { Skeleton } from '../../components/skeleton.js';
import { Confetti } from '../../components/confetti.js';
import { completedDraft, clearDraft, startDraft } from '../../lib/draft-store.js';
import { buildMatchConfig, requestMatch, clearMatch, matchStore } from '../../lib/match-store.js';
import {
  readDaily,
  beginDailyAttempt,
  saveDailyProgress,
  finishDailyAttempt,
  displayStreak,
  streakAtRisk,
  todayDailyId,
  msUntilNextDaily,
  countdownText,
  challengeLink,
  matchSideFor,
  logEntry,
  withLog,
  roundLabel,
  roundShort,
} from '../../lib/run-store.js';
import { useSimTicker } from '../run/sim-ticker.js';
import {
  PathStrip,
  GroupTable,
  ResultsTicker,
  TeamMark,
  OutcomeChip,
  opponentTeam,
  scoreText,
} from '../run/run-parts.js';
import { SharePanel } from '../run/share-panel.js';
import { xiViews, shareCardFor } from '../run/team-view.js';

const dateLabel = id =>
  new Date(id + 'T12:00:00Z').toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

/** Daily engine config: DEFAULT_CONFIG tuning so every device plays the same matches. */
function dailyConfig(m) {
  return buildMatchConfig({
    sides: [matchSideFor(m.home, { kind: 'user' }), matchSideFor(m.away)],
    competition: { mode: 'ai', difficulty: 'medium', knockout: m.knockout },
    tuning: DEFAULT_CONFIG,
  });
}
const dailyMatchId = (id, round) => `daily:${id}:${round}`;

function useCountdown() {
  const [ms, setMs] = useState(() => msUntilNextDaily());
  useEffect(() => {
    const t = setInterval(() => setMs(msUntilNextDaily()), 1000);
    return () => clearInterval(t);
  }, []);
  return countdownText(ms);
}

function Countdown({ label = 'Next challenge in' }) {
  const text = useCountdown();
  return html`<p class="daily-countdown">
    <${Icon} name="hourglass" size=${16} />
    <span>${label}</span>
    <b class="num" aria-live="off">${text}</b>
  </p>`;
}

function Streak({ state, today, bump = false }) {
  const current = displayStreak(state, today);
  return html`<div class=${cx('daily-streak', bump && 'is-bump', current > 0 && 'is-alive')}>
    <span class="daily-streak__flame" aria-hidden="true"><${Icon} name="flame" size=${26} /></span>
    <span class="daily-streak__n num">${current}</span>
    <span class="daily-streak__text">
      <span>day streak</span>
      <span class="text-3">${`best ${Math.max(state.streakState.best, current)}`}</span>
    </span>
  </div>`;
}

// ---- intro ------------------------------------------------------------------------------------
function Intro({ catalog, day, state, today, onStart, starting }) {
  const group = day.opponents.slice(0, 3).map(key => {
    const [, id] = key.split(':');
    const n = catalog.nations?.find(x => x.name === id);
    return { key, name: id, code: n?.code || null };
  });
  const atRisk = streakAtRisk(state, today);
  return html`<div class="daily-intro">
    <section class="daily-hero card card--gold card--pad-lg" aria-labelledby="daily-title">
      <div class="daily-hero__top">
        <p class="eyebrow is-gold">${`Daily Challenge #${day.number}`}</p>
        <p class="daily-hero__date">${dateLabel(today)}</p>
      </div>
      <h1 class="daily-hero__title" id="daily-title"><span>Today's</span> <em>World Cup</em></h1>
      <p class="daily-hero__lead">
        Everyone gets the same eleven nation spins today. Draft your XI and the whole tournament is
        simulated — one attempt.
      </p>
      <ul class="daily-rules" role="list">
        <li>
          <${Icon} name="globe" size=${18} /><span>Nations draft · same spins for everyone</span>
        </li>
        <li>
          <${Icon} name="shuffle" size=${18} /><span
            >${`${day.rerolls} re-rolls, each to that round's fixed alternate`}</span
          >
        </li>
        <li>
          <${Icon} name="layout-grid" size=${18} /><span
            >${`Formation ${formationLabel(day.formation)} · Pro opponents`}</span
          >
        </li>
        <li><${Icon} name="zap" size=${18} /><span>All seven matches auto-simulated</span></li>
      </ul>
      <div class="daily-group">
        <span class="daily-group__label">Your group</span>
        <ul class="daily-group__teams" role="list">
          ${group.map(
            t =>
              html`<li key=${t.key}>
                <${TeamMark} team=${t} size=${28} />
                <span>${t.name}</span>
              </li>`,
          )}
        </ul>
      </div>
      <${Button}
        variant="primary"
        size="lg"
        block
        iconEnd="arrow-right"
        onClick=${onStart}
        loading=${starting}
        data-testid="start-daily"
        >Start today's draft<//
      >
    </section>
    <aside class="daily-side stack stack-md">
      <section class="card card--pad-md daily-side__streak" aria-label="Streak">
        <${Streak} state=${state} today=${today} />
        <p class="text-3 text-sm">
          ${
            atRisk
              ? 'Play today to keep your streak alive.'
              : 'Play every day to build a streak. Miss a day and it resets.'
          }
        </p>
      </section>
      <section class="card card--pad-md daily-points" aria-labelledby="points-title">
        <h2 class="section-title" id="points-title">Scoring</h2>
        <dl class="daily-points__list">
          <div>
            <dt>Win · Draw</dt>
            <dd class="num">100 · 40</dd>
          </div>
          <div>
            <dt>Shoot-out won</dt>
            <dd class="num">+20</dd>
          </div>
          <div>
            <dt>Stage bonus</dt>
            <dd class="num">20 → 200</dd>
          </div>
          <div>
            <dt>Team OVR above 70</dt>
            <dd class="num">10 / pt</dd>
          </div>
          <div>
            <dt>% of perfect XI above 80</dt>
            <dd class="num">10 / %</dd>
          </div>
        </dl>
      </section>
      <${Countdown} />
    </aside>
  </div>`;
}

// ---- simulation ------------------------------------------------------------------------------
function SimView({ day, snapshot, ticker }) {
  const sim = ticker.state;
  return html`<div class="daily-sim">
    <section
      class="sim card card--hero card--pad-md"
      aria-labelledby="daily-sim-title"
      data-testid="daily-sim"
    >
      <div class="sim__head">
        <div>
          <p class="eyebrow is-gold">${`Daily #${day.number}`}</p>
          <h1 class="run-flash__title" id="daily-sim-title">
            ${sim?.finished ? 'Final whistle' : 'Your World Cup is on'}
          </h1>
        </div>
        <span class="sim__count num" aria-hidden="true"
          >${`${snapshot.record.w}–${snapshot.record.d}–${snapshot.record.l}`}</span
        >
      </div>
      <div class="sim__progress" aria-hidden="true">
        <span style=${{ width: `${Math.round((sim?.progress || 0) * 100)}%` }}></span>
      </div>
      ${sim && html`<${ResultsTicker} items=${sim.items} snapshot=${snapshot} />`}
      <p class="visually-hidden" aria-live="polite">${sim?.announce || ''}</p>
      ${
        sim &&
        !sim.finished &&
        html`<div class="sim__actions">
          <${Button}
            variant="secondary"
            icon="skip-forward"
            onClick=${ticker.skip}
            disabled=${sim.skip}
            data-testid="sim-skip"
            >${sim.skip ? 'Skipping…' : 'Skip to result'}<//
          >
        </div>`
      }
    </section>
    <section class="card card--pad-md run-group" aria-labelledby="daily-group-title">
      <h2 class="section-title" id="daily-group-title">Group A</h2>
      <${GroupTable} snapshot=${snapshot} compact />
    </section>
  </div>`;
}

// ---- result ----------------------------------------------------------------------------------
function CountUp({ value, duration = 1200 }) {
  const [n, setN] = useState(isReducedMotion() ? value : 0);
  useEffect(() => {
    if (isReducedMotion()) return setN(value);
    const t0 = performance.now();
    let raf;
    const tick = now => {
      const k = Math.min(1, (now - t0) / duration);
      setN(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return html`<span class="num">${n.toLocaleString()}</span>`;
}

function Result({ catalog, day, entry, state, today, fresh }) {
  const hide = !!entry.hideRatings;
  const run = useMemo(() => rebuildRun(catalog, day, entry), [catalog, day, entry]);
  const snapshot = useMemo(() => run?.snapshot() ?? null, [run]);
  const views = useMemo(() => (run ? xiViews(catalog, run.userSide()) : []), [run]);
  const link = challengeLink(
    {
      kind: 'daily',
      daily: day.number,
      mode: 'nations',
      formation: day.formation,
      difficulty: 'pro',
      hideRatings: hide,
    },
    { record: entry.record, grade: entry.grade },
  );
  const text = useMemo(
    () =>
      snapshot
        ? shareText(snapshot, {
            daily: { number: day.number, id: day.id },
            rating: hide ? null : entry.rating,
            perfectPct: entry.perfect,
            points: entry.points,
            hideRatings: hide,
            url: link,
          })
        : entry.share,
    [snapshot],
  );
  const card = useMemo(
    () =>
      snapshot &&
      shareCardFor({
        snapshot,
        views,
        formation: entry.formation,
        title: `Daily #${day.number}`,
        hideRatings: hide,
        stats: [
          { label: 'Points', value: entry.points.toLocaleString() },
          { label: 'Of perfect XI', value: `${entry.perfect.toFixed(1)}%` },
          { label: 'Team OVR', value: hide ? '??' : entry.rating.toFixed(1) },
        ],
      }),
    [snapshot, views],
  );
  const [fire, setFire] = useState(0);
  useEffect(() => {
    if (fresh && snapshot?.status === 'champion') setFire(1);
  }, []);
  const watch = round => {
    const m = matchFor(run, round);
    requestMatch({
      id: dailyMatchId(day.id, round),
      seed: m.seed,
      view: 'key',
      config: dailyConfig(m),
      meta: {
        context: 'daily',
        title: `Daily #${day.number} · ${roundLabel(round).replace('Group · ', '')}`,
        returnTo: '#/daily',
        userSides: [0],
      },
    });
  };
  return html`<div class="daily-result" data-testid="daily-result">
    <${Confetti} fire=${fire} count=${200} />
    <section class="daily-card card card--gold card--pad-lg" aria-labelledby="daily-result-title">
      <div class="daily-hero__top">
        <p class="eyebrow is-gold">${`Daily Challenge #${day.number}`}</p>
        <p class="daily-hero__date">${dateLabel(day.id)}</p>
      </div>
      <h1 class="visually-hidden" id="daily-result-title">${`Daily #${day.number} result`}</h1>
      <div class="daily-card__score">
        <div class="daily-card__points">
          <span class="daily-card__pts"><${CountUp} value=${entry.points} /></span>
          <span class="daily-card__label">points</span>
        </div>
        <${GradeBadge}
          grade=${entry.grade}
          size="lg"
          verdict=${entry.verdict}
          detail=${`${entry.record.w}–${entry.record.d}–${entry.record.l} · ${entry.stageLabel}`}
        />
      </div>
      ${snapshot && html`<${PathStrip} snapshot=${snapshot} />`}
      <div class="daily-card__stats">
        <${StatTile} label="Of perfect XI" value=${`${entry.perfect.toFixed(1)}%`} tone="gold" />
        <${StatTile} label="Team OVR" value=${hide ? '??' : entry.rating.toFixed(1)} tone="volt" />
        <${StatTile} label="Goals" value=${`${entry.record.gf}–${entry.record.ga}`} />
      </div>
      ${
        entry.parts &&
        html`<p class="daily-card__parts text-3 text-sm">
          ${`Matches ${entry.parts.matches} · stage ${entry.parts.stage} · OVR ${entry.parts.ovr} · perfection ${entry.parts.perfection}`}
        </p>`
      }
      <div class="daily-card__foot">
        <${Streak} state=${state} today=${today} bump=${fresh} />
        <${Countdown} />
      </div>
    </section>
    <div class="daily-result__grid">
      <div class="daily-result__main stack stack-lg">
        <${SharePanel}
          text=${text}
          card=${card}
          link=${link}
          heading="Share your Daily"
          title=${`Daily #${day.number}`}
          filename=${`football-draft-daily-${day.number}.png`}
        />
        ${
          snapshot &&
          html`<section
            class="card card--pad-md daily-matches"
            aria-labelledby="daily-matches-title"
          >
            <h2 class="section-title" id="daily-matches-title">Your matches</h2>
            <ul class="daily-matches__list" role="list">
              ${snapshot.rounds
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.result)
                .map(
                  ({ r, i }) =>
                    html`<li key=${r.id} class="daily-match">
                      <span class="daily-match__stage">${roundShort(i)}</span>
                      <${TeamMark} team=${opponentTeam(r.opponent)} size=${24} />
                      <span class="daily-match__name truncate">${r.opponent.name}</span>
                      <span class="daily-match__score num">${scoreText(r.result)}</span>
                      <${OutcomeChip} result=${r.result} size="sm" />
                      <${Button}
                        size="sm"
                        variant="ghost"
                        icon="play"
                        onClick=${() => watch(i)}
                        aria-label=${`Watch ${roundLabel(i)} against ${r.opponent.name}`}
                        ><span class="daily-match__watch">Watch</span><//
                      >
                    </li>`,
                )}
            </ul>
          </section>`
        }
      </div>
      ${
        views.length > 0 &&
        html`<section class="card card--pad-md daily-xi" aria-labelledby="daily-xi-title">
          <h2 class="section-title" id="daily-xi-title">Your XI</h2>
          <${PitchView}
            formation=${entry.formation}
            players=${views.map(v => v.view)}
            hideRatings=${hide}
            label="Your XI"
          />
        </section>`
      }
    </div>
  </div>`;
}

/** Rebuild a finished daily run from the stored XI (deterministic: same opponents and results). */
function rebuildRun(catalog, day, entry) {
  try {
    if (entry.run) return restoreCupRun(catalog, entry.run);
  } catch {
    /* fall through */
  }
  return null;
}
function matchFor(run, round) {
  const home = run.userSide(),
    away = run.opponentSide(round);
  return { round, seed: run.matchSeed(round), home, away, knockout: round >= 3 };
}

// ---------------------------------------------------------------------------------------------

export default function DailyScreen() {
  const [s, setS] = useState({ phase: 'loading' });
  const hideRatings = useStore(prefs, p => p.hideRatings);
  const ticker = useSimTicker();

  const finish = (ctx, run) => {
    const snapshot = run.snapshot();
    const { rating, perfect } = ctx.state.current;
    const score = dailyScore(snapshot, { rating, perfect });
    const entry = {
      id: ctx.day.id,
      number: ctx.day.number,
      record: snapshot.record,
      results: snapshot.results,
      stage: snapshot.stage,
      stageLabel: snapshot.stageLabel,
      status: snapshot.status,
      grade: snapshot.grade?.grade || 'F',
      verdict: snapshot.grade?.verdict || '',
      points: score.total,
      parts: {
        matches: score.matches,
        stage: score.stage,
        ovr: score.ovr,
        perfection: score.perfection,
      },
      rating,
      perfect,
      formation: ctx.state.current.formation,
      hideRatings: !!ctx.state.current.hideRatings,
      run: run.serialize(),
      finishedAt: new Date().toISOString(),
    };
    const state = finishDailyAttempt(ctx.state, entry);
    setS({ ...ctx, phase: 'result', state, entry, fresh: true });
  };

  const simulate = async (ctx, run) => {
    setS({ ...ctx, phase: 'sim', snapshot: run.snapshot() });
    let log = ctx.state.current?.log || [];
    const ok = await ticker.start(run, {
      configFor: dailyConfig,
      idFor: m => dailyMatchId(ctx.day.id, m.round),
      pace: 700,
      onDone: (m, result, snapshot) => {
        log = withLog(log, result ? logEntry(m.round, result) : null);
        ctx.state = saveDailyProgress(ctx.state, run, log);
        setS(prev => ({ ...prev, snapshot }));
      },
    });
    if (ok && run.complete) finish(ctx, run);
  };

  const alive = useRef(true);
  const boot = async () => {
    const live = () => alive.current;
    {
      try {
        const catalog = await loadCatalog();
        if (!live()) return;
        const today = todayDailyId();
        const day = dailyChallenge(catalog, today);
        let state = readDaily();
        // Coming back from watching a replay: forget that match.
        const held = matchStore.get()?.request;
        if (held?.id?.startsWith('daily:')) clearMatch(held.id);
        const ctx = { catalog, day, today, state };
        const draft = completedDraft();
        if (
          draft?.context?.kind === 'daily' &&
          (draft.context.daily ?? today) === today &&
          !state.results[today] &&
          state.current?.id !== today
        ) {
          const user = draft.session.matchSide(0);
          const run = createCupRun(catalog, { ...day.cup, user });
          const optimum = perfectXI(catalog, day, { formation: user.formation });
          const perfect = perfectPercent(user.rating, optimum);
          ctx.state = beginDailyAttempt(state, {
            id: today,
            number: day.number,
            run,
            rating: user.rating,
            perfect,
            formation: user.formation,
          });
          ctx.state = {
            ...ctx.state,
            current: { ...ctx.state.current, hideRatings: !!draft.session.options?.hideRatings },
          };
          clearDraft();
          simulate(ctx, run);
          return;
        }
        if (draft?.context?.kind === 'daily') clearDraft();
        if (state.current?.id === today) {
          const run = restoreCupRun(catalog, state.current.run);
          if (run.complete) finish(ctx, run);
          else simulate(ctx, run);
          return;
        }
        if (state.results[today])
          return setS({ ...ctx, phase: 'result', entry: state.results[today], fresh: false });
        if (state.current && state.current.id !== today) {
          // An unfinished attempt from another day cannot be resumed: drop it.
          state = { ...state, current: null };
          ctx.state = state;
        }
        setS({ ...ctx, phase: state.lastPlayed === today ? 'used' : 'intro' });
      } catch (error) {
        console.error('[daily] could not load', error);
        if (live()) setS({ phase: 'error', error });
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    boot();
    return () => {
      alive.current = false;
    };
  }, []);

  const start = async () => {
    setS(prev => ({ ...prev, starting: true }));
    const { day } = s;
    await startDraft({
      kind: 'daily',
      type: 'nations',
      difficulty: day.difficulty,
      formation: day.formation,
      seed: day.seed,
      schedule: day.draft,
      rerolls: day.rerolls,
      daily: day.id,
      useDefaultRules: true,
      options: { hideRatings, uniqueNations: false },
      returnTo: '/daily',
    });
    // A draft that finishes without leaving this route (no draft screen in between): reload.
    if (alive.current && globalThis.location.hash.startsWith('#/daily')) boot();
  };

  let body;
  if (s.phase === 'loading')
    body = html`<h1 class="visually-hidden">Daily Challenge</h1>
      <${Skeleton} variant="rect" height=${360} label="Loading today's challenge" />`;
  else if (s.phase === 'error')
    body = html`<${EmptyState}
      icon="triangle-alert"
      tone="coral"
      level=${1}
      title="The Daily Challenge could not load"
      message="Check your connection and try again."
      action=${html`<${Button} variant="primary" onClick=${() => location.reload()}>Retry<//>`}
    />`;
  else if (s.phase === 'intro')
    body = html`<${Intro} ...${s} onStart=${start} starting=${!!s.starting} />`;
  else if (s.phase === 'sim')
    body = html`<${SimView} day=${s.day} snapshot=${s.snapshot} ticker=${ticker} />`;
  else if (s.phase === 'result') body = html`<${Result} ...${s} />`;
  else
    body = html`<${EmptyState}
      icon="calendar-days"
      tone="gold"
      level=${1}
      title="Today's attempt is used"
      message="Come back tomorrow for a new Daily Challenge."
      action=${html`<${Countdown} />`}
    />`;

  return html`<div class="screen container daily" data-screen="daily" data-phase=${s.phase}>
    ${body}
    ${
      s.phase === 'intro' || s.phase === 'result'
        ? html`<p class="daily-foot text-3 text-xs">
            <a href=${href('/')}>Home</a> · Daily resets at 00:00 UTC
          </p>`
        : null
    }
  </div>`;
}
