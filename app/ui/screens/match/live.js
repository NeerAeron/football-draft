// The live match view: header with the score bug, the pitch canvas with its overlays
// (goal celebration, replay, shootout, half-time, loading, pause), the control bar and the
// side panel (momentum, xG, commentary, key moments, stats).
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { useStore, shallowEqual } from '../../lib/store.js';
import { soundStore, toggleSound, getAudio } from '../../lib/audio.js';
import { useReducedMotion } from '../../lib/motion.js';
import {
  Button,
  IconButton,
  Icon,
  ScoreBug,
  Segmented,
  Tabs,
  Meter,
} from '../../components/index.js';
import {
  MomentumChart,
  StatsTable,
  MomentsList,
  Feed,
  Ticker,
  ShootoutPanel,
  GoalOverlay,
  TeamMark,
  teamColors,
  useMedia,
} from './hud.js';
import { MentalityControl } from './tactics.js';
import { fmt2 } from '../../lib/format.js';
import { teamStyle } from '../../lib/color.js';
import { formationLabel } from '../../../core/players/formations.js';
import { commonName } from '../../../core/players/player-labels.js';

const SPEED_OPTIONS = [1, 2, 4].map(v => ({ value: String(v), label: `${v}×` }));

function bugTeam(team, score) {
  return {
    name: team.name,
    short: team.short,
    code: team.flagCode || undefined,
    colors: teamColors(team),
    score,
  };
}

function useFullscreen(ref) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => {
      if (document.fullscreenElement !== ref.current && on && !ref.current?.dataset.fallback)
        setOn(false);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [on]);
  const toggle = async () => {
    const el = ref.current;
    if (!el) return;
    if (on) {
      delete el.dataset.fallback;
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setOn(false);
      return;
    }
    try {
      if (!el.requestFullscreen) throw new Error('no fullscreen');
      await el.requestFullscreen();
    } catch {
      el.dataset.fallback = '1'; // CSS-only TV mode (iOS Safari, iframes)
    }
    setOn(true);
  };
  return [on, toggle];
}

function Scoreline({ controller, teams }) {
  const s = useStore(
    controller.hud,
    h => ({
      score: h.score,
      clock: h.clock,
      period: h.period,
      pens: h.pens,
      phase: h.phase,
      goal: !!h.goal && !h.replay,
    }),
    shallowEqual,
  );
  const small = useMedia('(max-width: 559px)');
  return html`<${ScoreBug}
    class=${cx('match-bug', s.goal && 'is-flash')}
    size=${small ? 'sm' : 'md'}
    home=${bugTeam(teams[0], s.score[0])}
    away=${bugTeam(teams[1], s.score[1])}
    clock=${s.period === 'PENS' || s.period === 'HT' ? null : s.clock}
    period=${s.pens ? null : s.period}
    pens=${s.pens}
    live=${s.phase === 'playing'}
  />`;
}

function XgLine({ controller, teams }) {
  const xg = useStore(controller.hud, h => h.xg);
  const total = xg[0] + xg[1];
  return html`<div class="xgline" aria-label=${`Expected goals ${fmt2(xg[0])} to ${fmt2(xg[1])}`}>
    <span class="xgline__v num">${fmt2(xg[0])}</span>
    <span class="xgline__bar" aria-hidden="true">
      <span
        style=${{ width: `${total > 0 ? (xg[0] / total) * 100 : 50}%`, background: 'var(--home)' }}
      ></span>
      <span style=${{ flex: 1, background: 'var(--away)' }}></span>
    </span>
    <span class="xgline__label">xG</span>
    <span class="xgline__v num">${fmt2(xg[1])}</span>
  </div>`;
}

function SidePanel({ controller, teams }) {
  const [tab, setTab] = useState('moments');
  const h = useStore(
    controller.hud,
    s => ({ momentum: s.momentum, moments: s.moments, feed: s.feed, stats: s.stats }),
    shallowEqual,
  );
  const goals = h.moments.filter(m => m.level >= 3).length;
  return html`<aside class="match-side" aria-label="Match centre">
    <div class="match-side__top">
      <${MomentumChart} samples=${h.momentum.samples} teams=${teams} />
      <${XgLine} controller=${controller} teams=${teams} />
    </div>
    <${Tabs}
      label="Match centre"
      class="match-side__tabs"
      variant="pill"
      block
      tabs=${[
        { id: 'moments', label: 'Moments', badge: goals || null },
        { id: 'feed', label: 'Commentary' },
        { id: 'stats', label: 'Stats' },
      ]}
      value=${tab}
      onChange=${setTab}
    >
      ${id =>
        id === 'moments'
          ? html`<${MomentsList} moments=${h.moments} teams=${teams} />`
          : id === 'feed'
            ? html`<${Feed} feed=${h.feed} />`
            : html`<${StatsTable} stats=${h.stats} teams=${teams} compact />`}
    <//>
  </aside>`;
}

function Halftime({ controller, teams, onTactics }) {
  const h = useStore(
    controller.hud,
    s => ({
      halftime: s.halftime,
      tactics: s.tactics,
      effective: s.effective,
      access: s.access,
      phase: s.phase,
    }),
    shallowEqual,
  );
  if (h.phase !== 'halftime' || !h.halftime) return null;
  const users = controller.userSides;
  const st = h.halftime.stats;
  return html`<div
    class="stage-panel halftime"
    role="dialog"
    aria-labelledby="ht-title"
    data-testid="halftime"
  >
    <p class="eyebrow">Half-time</p>
    <h2 id="ht-title" class="halftime__score num">
      <span class="truncate">${teams[0].short}</span> ${h.halftime.score[0]}–${h.halftime.score[1]}
      <span class="truncate">${teams[1].short}</span>
    </h2>
    <dl class="halftime__stats">
      <div>
        <dt>Possession</dt>
        <dd class="num">${st[0].possession}% – ${st[1].possession}%</dd>
      </div>
      <div>
        <dt>Shots</dt>
        <dd class="num">${st[0].shots} – ${st[1].shots}</dd>
      </div>
      <div>
        <dt>xG</dt>
        <dd class="num">${fmt2(st[0].xg)} – ${fmt2(st[1].xg)}</dd>
      </div>
    </dl>
    ${users.map(
      t =>
        html`<div class="halftime__team" key=${t}>
          <span class="halftime__label">${users.length > 1 ? teams[t].name : 'Team talk'}</span>
          <${MentalityControl}
            team=${t}
            name=${teams[t].name}
            value=${h.tactics[t].mentality}
            effective=${h.effective[t]}
            onChange=${(team, v) => controller.setTactic(team, 'mentality', v)}
            disabled=${!h.access[t]?.mentality}
            size="md"
            block
          />
        </div>`,
    )}
    <div class="halftime__actions">
      ${
        users.length > 0 &&
        html`<${Button}
          variant="secondary"
          icon="sliders-horizontal"
          onClick=${() => onTactics(users[0])}
          >Tactics<//
        >`
      }
      <${Button}
        variant="primary"
        size="lg"
        icon="whistle"
        data-testid="second-half"
        onClick=${() => controller.secondHalf()}
        >Second half<//
      >
    </div>
  </div>`;
}

const LINE_ORDER = ['GK', 'RB', 'CB', 'LB', 'DM', 'RM', 'CM', 'LM', 'AM', 'RW', 'ST', 'LW'];

/**
 * Key Moments kick-off: the first half simulates in a worker for a second or two — show the
 * line-ups walking out (a TV-style team sheet) instead of a bare progress bar.
 */
function WalkOut({ controller, teams, progress }) {
  const m = controller.preview;
  const title = controller.request.meta?.title;
  return html`<div class="stage-panel walkout" aria-busy="true">
    <p class="eyebrow walkout__eyebrow">${title || 'Kick-off'} · Line-ups</p>
    <div class="walkout__teams">
      ${[0, 1].map(t => {
        const team = teams[t] || {};
        const xi = m.players
          .filter(p => p.team === t)
          .sort(
            (a, b) => LINE_ORDER.indexOf(a.role) - LINE_ORDER.indexOf(b.role) || a.slot - b.slot,
          );
        return html`<section
          key=${t}
          class=${cx('walkout__team', t === 1 && 'is-away')}
          style=${teamStyle(teamColors(team))}
          aria-label=${`${team.name} line-up`}
        >
          <header class="walkout__head">
            <${TeamMark} team=${team} size=${36} />
            <span class="walkout__names">
              <span class="walkout__name truncate">${team.name}</span>
              <span class="walkout__formation"
                >${formationLabel(m.teams[t]?.tactics?.formation || '433').split(' · ')[0]}</span
              >
            </span>
          </header>
          <ol class="walkout__xi" role="list">
            ${xi.map(
              (p, i) =>
                html`<li key=${p.id} class="walkout__row" style=${`--i:${i}`}>
                  <span class="walkout__num num">${p.number}</span>
                  <span class="walkout__player truncate">${commonName(p) || p.name}</span>
                  <span class="walkout__role">${p.role}</span>
                </li>`,
            )}
          </ol>
        </section>`;
      })}
    </div>
    <div class="walkout__foot">
      <span class="loading__ball" aria-hidden="true"><${Icon} name="ball" size=${18} /></span>
      <span class="walkout__status">The teams are walking out…</span>
      <${Meter}
        label="Simulation progress"
        value=${Math.round(progress * 100)}
        valueText=${`${Math.round(progress * 100)}%`}
        showValue=${false}
        size="sm"
      />
    </div>
  </div>`;
}

function Loading({ controller, teams }) {
  const h = useStore(
    controller.hud,
    s => ({ phase: s.phase, progress: s.progress, view: s.view, error: s.error }),
    shallowEqual,
  );
  if (h.phase === 'error')
    return html`<div class="stage-panel loading" role="alert">
      <${Icon} name="triangle-alert" size=${28} />
      <p>The match could not be simulated.</p>
      <${Button} variant="primary" onClick=${() => location.reload()}>Try again<//>
    </div>`;
  if (h.phase !== 'loading') return null;
  if (h.view === 'key' && teams)
    return html`<${WalkOut} controller=${controller} teams=${teams} progress=${h.progress} />`;
  return html`<div class="stage-panel loading" aria-busy="true">
    <span class="loading__ball" aria-hidden="true"><${Icon} name="ball" size=${36} /></span>
    <p class="loading__text">
      ${h.view === 'instant' ? 'Playing the full match…' : 'Finding the moments that matter…'}
    </p>
    <${Meter}
      label="Simulation progress"
      value=${Math.round(h.progress * 100)}
      valueText=${`${Math.round(h.progress * 100)}%`}
      size="sm"
    />
  </div>`;
}

function StageChips({ controller }) {
  const h = useStore(
    controller.hud,
    s => ({
      clip: s.clip,
      skipping: s.skipping,
      presenting: s.presenting,
      paused: s.paused,
      phase: s.phase,
    }),
    shallowEqual,
  );
  return html`<div class="stage-chips" aria-hidden="true">
    ${h.clip && html`<span class="stage-chip">Clip ${h.clip.n}/${h.clip.total}</span>`}
    ${h.skipping && html`<span class="stage-chip is-ff"><${Icon} name="fast-forward" size=${14} /> Fast-forward</span>`}
    ${h.presenting === 'rewind' && html`<span class="stage-chip">Build-up</span>`}
  </div>`;
}

/** Action camera (follow the ball) ↔ full pitch; there is no camera under reduced motion. */
function CameraToggle({ controller }) {
  const h = useStore(
    controller.hud,
    s => ({ camera: s.camera, phase: s.phase, shootout: !!s.shootout }),
    shallowEqual,
  );
  const reduced = useReducedMotion();
  if (reduced) return null;
  const on = h.camera === 'action';
  return html`<${IconButton}
    icon=${on ? 'crosshair' : 'maximize'}
    label=${on ? 'Action camera on: show the full pitch' : 'Full pitch: switch to the action camera'}
    variant="secondary"
    pressed=${on}
    disabled=${h.phase !== 'playing' || h.shootout}
    aria-keyshortcuts="C"
    data-testid="camera-toggle"
    onClick=${() => controller.toggleCamera()}
  />`;
}

function Controls({ controller, teams, onTactics }) {
  const h = useStore(
    controller.hud,
    s => ({
      phase: s.phase,
      paused: s.paused,
      speed: s.speed,
      presenting: s.presenting,
      tactics: s.tactics,
      effective: s.effective,
      access: s.access,
      view: s.view,
      shootout: !!s.shootout,
    }),
    shallowEqual,
  );
  const playing = h.phase === 'playing';
  const full = h.view === 'full';
  const users = controller.userSides;
  const showMentality = full && users.length > 0 && !h.shootout;
  return html`<div class="match-controls" role="toolbar" aria-label="Match controls">
    <div class="match-controls__main">
      <${IconButton}
        icon=${h.paused ? 'play' : 'pause'}
        label=${h.paused ? 'Play' : 'Pause'}
        variant="secondary"
        disabled=${!playing}
        aria-keyshortcuts="Space"
        data-testid="play-pause"
        onClick=${() => controller.togglePause()}
      />
      <${Segmented}
        class="match-speed"
        label="Playback speed"
        options=${SPEED_OPTIONS}
        value=${String(h.speed)}
        onChange=${v => controller.setSpeed(Number(v))}
        size="sm"
      />
      ${
        full
          ? html`<${Button}
              size="sm"
              variant="secondary"
              icon="skip-forward"
              disabled=${!playing}
              aria-keyshortcuts="N"
              data-testid="skip-moment"
              onClick=${() => controller.skipToMoment()}
              >Next<span class="match-controls__word"> moment</span><//
            >`
          : html`<${Button}
              size="sm"
              variant="secondary"
              icon="skip-forward"
              disabled=${!playing}
              aria-keyshortcuts="N"
              data-testid="next-clip"
              onClick=${() => controller.nextClip()}
              >Next<span class="match-controls__word"> clip</span><//
            >`
      }
    </div>
    ${
      showMentality &&
      html`<div class="match-controls__mentality">
        ${users.map(
          t =>
            html`<div key=${t} class="match-controls__side">
              ${users.length > 1 && html`<span class="match-controls__team">${teams[t].short}</span>`}
              <${MentalityControl}
                team=${t}
                name=${teams[t].name}
                value=${h.tactics[t].mentality}
                effective=${h.effective[t]}
                onChange=${(team, v) => controller.setTactic(team, 'mentality', v)}
                disabled=${!h.access[t]?.mentality}
              />
            </div>`,
        )}
      </div>`
    }
    <div class="match-controls__end">
      <${CameraToggle} controller=${controller} />
      ${
        users.length > 0 &&
        html`<${IconButton}
          icon="sliders-horizontal"
          label="Tactics"
          variant="secondary"
          data-testid="open-tactics"
          onClick=${() => onTactics(users[0])}
        />`
      }
    </div>
  </div>`;
}

function Overlays({ controller, teams }) {
  const h = useStore(
    controller.hud,
    s => ({
      goal: s.goal,
      replay: s.replay,
      paused: s.paused,
      phase: s.phase,
      presenting: s.presenting,
    }),
    shallowEqual,
  );
  return html`
    <${GoalOverlay}
      goal=${h.goal}
      teams=${teams}
      replay=${h.replay}
      onSkip=${() => controller.endCelebration(true)}
    />
    ${
      h.paused &&
      h.phase === 'playing' &&
      html`<button
        type="button"
        class="stage-play"
        aria-label="Resume"
        onClick=${() => controller.togglePause()}
      >
        <${Icon} name="play" size=${34} />
      </button>`
    }
  `;
}

function FullTime({ controller, teams }) {
  const h = useStore(controller.hud, s => ({ phase: s.phase, result: s.result }), shallowEqual);
  if (h.phase !== 'fulltime' || !h.result) return null;
  const r = h.result;
  return html`<div class="stage-panel fulltime" role="status">
    <p class="eyebrow">Full time</p>
    <p class="fulltime__score num">
      <span>${teams[0].short}</span> ${r.score[0]}–${r.score[1]} <span>${teams[1].short}</span>
    </p>
    ${r.shootout && html`<p class="fulltime__pens">${r.shootout.score[0]}–${r.shootout.score[1]} on penalties</p>`}
  </div>`;
}

function Cut({ controller }) {
  const cut = useStore(controller.hud, s => s.cut);
  return cut ? html`<span key=${cut} class="stage-cut" aria-hidden="true"></span>` : null;
}

function Shootout({ controller, teams }) {
  const shootout = useStore(controller.hud, s => s.shootout);
  return html`<${ShootoutPanel} shootout=${shootout} teams=${teams} />`;
}

function TickerLine({ controller }) {
  const h = useStore(
    controller.hud,
    s => ({
      ticker: s.ticker,
      skipping: s.skipping,
      clip: s.clip,
      period: s.period,
      rewind: s.presenting === 'rewind',
    }),
    shallowEqual,
  );
  const fallback = h.skipping
    ? 'Fast-forwarding to the next moment…'
    : h.rewind
      ? 'The build-up…'
      : h.clip
        ? `${h.period === '1H' ? 'First-half' : h.period === 'PENS' ? 'Shootout' : 'Second-half'} highlights · clip ${h.clip.n} of ${h.clip.total}`
        : '';
  return html`<${Ticker} line=${h.skipping ? null : h.ticker} fallback=${fallback} />`;
}

function Announcer({ controller }) {
  const announce = useStore(controller.hud, s => s.announce);
  return html`<p class="visually-hidden" aria-live="polite" aria-atomic="true">${announce}</p>`;
}

/** Keyboard: Space play/pause, ←/→ (↓/↑) speed, N next moment/clip, C camera. */
function useMatchKeys(controller) {
  useEffect(() => {
    const onKey = e => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = document.activeElement;
      const typing = el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable);
      if (typing || document.querySelector('dialog[open]')) return;
      if (e.code === 'Space') {
        if (el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName)) return; // native activation
        e.preventDefault();
        if (!e.repeat) controller.togglePause();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        controller.stepSpeed(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        controller.stepSpeed(-1);
      } else if (e.key === 'n' || e.key === 'N') {
        if (controller.request.view === 'full') controller.skipToMoment();
        else controller.nextClip();
      } else if (e.key === 'c' || e.key === 'C') controller.toggleCamera();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [controller]);
}

export function LiveMatch({ controller, teams, onExit, onTactics }) {
  const canvas = useRef(null);
  const pitch = useRef(null);
  const pitchZoom = useRef(null);
  const root = useRef(null);
  const [tv, toggleTv] = useFullscreen(root);
  getAudio();
  const sound = useStore(soundStore);
  useEffect(() => {
    controller.attach(canvas.current, pitch.current, pitchZoom.current);
  }, [controller]);
  useMatchKeys(controller);
  const meta = controller.request.meta;
  const colors = teams.map(t => teamColors(t)[0]);
  return html`<div
    ref=${root}
    class=${cx('live', tv && 'is-tv')}
    style=${{ '--home': controller.kits[0].primary, '--away': controller.kits[1].primary }}
    data-colors=${colors.join(',')}
  >
    <header class="match-top">
      <${IconButton} icon="arrow-left" label="Leave match" onClick=${onExit} />
      <p class="match-top__title eyebrow">${meta.title || 'Live'}</p>
      <div class="match-top__bug"><${Scoreline} controller=${controller} teams=${teams} /></div>
      <div class="match-top__actions">
        <${IconButton}
          icon=${sound.on ? 'volume-2' : 'volume-x'}
          label=${sound.available ? (sound.on ? 'Mute sound' : 'Turn sound on') : 'Sound unavailable'}
          pressed=${sound.on}
          disabled=${!sound.available}
          onClick=${toggleSound}
        />
        <${IconButton}
          icon=${tv ? 'minimize' : 'tv'}
          label=${tv ? 'Exit TV mode' : 'TV mode'}
          pressed=${tv}
          onClick=${toggleTv}
        />
      </div>
    </header>
    <h1 class="visually-hidden">${teams[0].name} vs ${teams[1].name}</h1>
    <div class="live__main">
      <div class="live__stage-col">
        <div class="match-stage">
          <div class="match-stage__scene">
            <canvas ref=${pitch} class="match-stage__pitch" aria-hidden="true"></canvas>
            <canvas
              ref=${pitchZoom}
              class="match-stage__pitch match-stage__pitch--zoom"
              aria-hidden="true"
            ></canvas>
            <canvas
              ref=${canvas}
              class="match-stage__canvas"
              aria-label="Match pitch"
              role="img"
            ></canvas>
          </div>
          <${StageChips} controller=${controller} />
          <${Overlays} controller=${controller} teams=${teams} />
          <${Halftime} controller=${controller} teams=${teams} onTactics=${onTactics} />
          <${Cut} controller=${controller} />
          <${Shootout} controller=${controller} teams=${teams} />
          <${FullTime} controller=${controller} teams=${teams} />
          <${Loading} controller=${controller} teams=${teams} />
        </div>
        <${TickerLine} controller=${controller} />
        <${Controls} controller=${controller} teams=${teams} onTactics=${onTactics} />
      </div>
      <${SidePanel} controller=${controller} teams=${teams} />
    </div>
    <${Announcer} controller=${controller} />
  </div>`;
}
