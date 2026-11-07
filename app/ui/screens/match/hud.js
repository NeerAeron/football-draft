// Match HUD pieces: team marks, momentum chart, stats table, key moments, ticker, shootout
// panel and the goal celebration overlay. Presentational: data comes from the controller's
// HUD store (controller.js) or from a stored result (result.js).
import { useEffect, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { teamStyle } from '../../lib/color.js';
import { Flag, Crest, Icon, Confetti } from '../../components/index.js';

/** matchMedia as state (e.g. a smaller score bug on phones). */
export function useMedia(query) {
  const get = () => !!globalThis.matchMedia?.(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    const m = globalThis.matchMedia?.(query);
    if (!m) return;
    const sync = () => setOn(m.matches);
    sync();
    m.addEventListener('change', sync);
    return () => m.removeEventListener('change', sync);
  }, [query]);
  return on;
}

export function teamColors(team = {}) {
  return team.colors?.length ? team.colors : [team.color, team.secondary].filter(Boolean);
}

/** Flag for nations (flagCode), crest in kit colours otherwise. */
export function TeamMark({ team = {}, size = 32 }) {
  return team.flagCode
    ? html`<${Flag} code=${team.flagCode} name=${team.name} size=${size} decorative />`
    : html`<${Crest} name=${team.name} colors=${teamColors(team)} size=${size} decorative />`;
}

/**
 * Momentum (FotMob-style): one bar per match minute, home up / away down, on a fixed
 * 90-minute axis (longer once extra time starts).
 */
export function MomentumChart({
  samples = [],
  teams = [],
  height = 56,
  label = 'Momentum',
  final = false,
}) {
  const n = Math.max(90, samples.length),
    w = 100 / n,
    mid = height / 2;
  const home = teamStyle(teamColors(teams[0]))['--team'],
    away = teamStyle(teamColors(teams[1]))['--team'];
  const lead = (final ? samples : samples.slice(-5)).reduce((a, b) => a + b, 0);
  const even = Math.abs(lead) < (final ? 2 : 0.25);
  const top = (lead > 0 ? teams[0] : teams[1])?.name || '';
  const summary = !samples.length
    ? 'No momentum yet'
    : final
      ? even
        ? 'Evenly matched over the game'
        : `${top} had the upper hand`
      : even
        ? 'Even contest right now'
        : `${top} on top right now`;
  return html`<figure class="momentum" aria-label=${`${label}: ${summary}`}>
    <svg
      class="momentum__svg"
      viewBox=${`0 0 100 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="50" x2="50" y1="0" y2=${height} class="momentum__half" />
      <line x1="0" x2="100" y1=${mid} y2=${mid} class="momentum__axis" />
      ${samples.map((v, i) => {
        const h = Math.min(1, Math.abs(v) * 1.6) * (mid - 2);
        if (h < 0.4) return null;
        return html`<rect
          key=${i}
          x=${i * w + w * 0.12}
          width=${w * 0.76}
          y=${v > 0 ? mid - h : mid}
          height=${h}
          fill=${v > 0 ? home : away}
          rx="0.3"
        />`;
      })}
    </svg>
    <figcaption class="momentum__caption">
      <span>${label}</span><span class="momentum__summary">${summary}</span>
    </figcaption>
  </figure>`;
}

const STAT_ROWS = [
  ['possession', 'Possession', v => `${v}%`],
  ['xg', 'Expected goals (xG)', v => v.toFixed(2)],
  ['shots', 'Shots'],
  ['onTarget', 'On target'],
  ['bigChances', 'Big chances'],
  ['passes', 'Passes'],
  ['passAccuracy', 'Pass accuracy', v => `${v}%`],
  ['saves', 'Saves'],
  ['corners', 'Corners'],
  ['tackles', 'Tackles'],
  ['fouls', 'Fouls'],
  ['yellowCards', 'Yellow cards'],
  ['redCards', 'Red cards'],
  ['offsides', 'Offsides'],
];

/** Team stats head-to-head with split bars. */
export function StatsTable({ stats, teams = [], compact = false }) {
  if (!stats) return html`<p class="match-empty">Stats appear once the ball is rolling.</p>`;
  const rows = STAT_ROWS.filter(
    ([key]) =>
      stats[0][key] != null &&
      (!compact || !['tackles', 'offsides', 'redCards', 'bigChances', 'corners'].includes(key)),
  );
  return html`<table class="mstats">
    <caption class="visually-hidden">
      Team statistics
    </caption>
    <thead class="visually-hidden">
      <tr>
        <th scope="col">${teams[0]?.name}</th>
        <th scope="col">Statistic</th>
        <th scope="col">${teams[1]?.name}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(([key, label, fmt = v => String(v)]) => {
        const a = stats[0][key] ?? 0,
          b = stats[1][key] ?? 0,
          total = a + b,
          share = total > 0 ? (a / total) * 100 : 50;
        return html`<tr key=${key} class="mstats__row">
          <td class=${cx('mstats__v num', a > b && 'is-lead')}>${fmt(a)}</td>
          <th scope="row" class="mstats__label">
            <span>${label}</span>
            <span class="mstats__bar" aria-hidden="true"
              ><span class="mstats__bar-home" style=${{ width: `${share}%` }}></span
              ><span class="mstats__bar-away" style=${{ width: `${100 - share}%` }}></span
            ></span>
          </th>
          <td class=${cx('mstats__v num', b > a && 'is-lead')}>${fmt(b)}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

function MomentIcon({ line }) {
  if (line.icon === 'card-yellow' || line.icon === 'card-red')
    return html`<span
      class=${cx('mcard', line.icon === 'card-red' && 'is-red')}
      aria-hidden="true"
    ></span>`;
  return html`<${Icon} name=${line.icon || 'circle-dot'} size=${16} />`;
}

/** Key moments, newest first (goals highlighted). */
export function MomentsList({
  moments = [],
  teams = [],
  empty = 'Waiting for the first big moment.',
}) {
  if (!moments.length) return html`<p class="match-empty">${empty}</p>`;
  return html`<ol class="moments">
    ${[...moments].reverse().map(
      line =>
        html`<li
          key=${line.id}
          class=${cx('moment', `moment--${line.tone}`, line.team != null && `moment--side${line.team}`)}
          style=${line.team != null ? teamStyle(teamColors(teams[line.team])) : null}
        >
          <span class="moment__min num">${line.minute}</span>
          <span class="moment__icon"><${MomentIcon} line=${line} /></span>
          <span class="moment__text">${line.text}</span>
        </li>`,
    )}
  </ol>`;
}

/** Commentary feed (newest first). */
export function Feed({ feed = [] }) {
  if (!feed.length) return html`<p class="match-empty">Commentary starts at kick-off.</p>`;
  return html`<ol class="feed">
    ${feed.map(
      line =>
        html`<li key=${line.id} class=${cx('feed__item', `feed__item--${line.tone}`)}>
          <span class="feed__min num">${line.minute}</span>
          <span>${line.text}</span>
        </li>`,
    )}
  </ol>`;
}

/** One-line lower third with the latest commentary. */
export function Ticker({ line, fallback }) {
  return html`<div class=${cx('ticker', line && `ticker--${line.tone}`)} aria-hidden="true">
    ${
      line
        ? html`<span class="ticker__min num">${line.minute}</span>
            <span class="ticker__text" key=${line.id}>${line.text}</span>`
        : html`<span class="ticker__text is-muted">${fallback || ' '}</span>`
    }
  </div>`;
}

function KickDots({ kicks, team, total }) {
  const mine = kicks.filter(k => k.team === team);
  const slots = Math.max(5, total);
  return html`<ol class="pens__dots" aria-hidden="true">
    ${Array.from({ length: slots }, (_, i) => {
      const k = mine[i];
      return html`<li key=${i} class=${cx('pens__dot', k && (k.scored ? 'is-goal' : 'is-miss'))}>
        ${k && html`<${Icon} name=${k.scored ? 'check' : 'x'} size=${12} strokeWidth=${3} />`}
      </li>`;
    })}
  </ol>`;
}

/** Penalty shootout scoreboard: kick-by-kick dots, the taker and the keeper. */
export function ShootoutPanel({ shootout, teams = [], fixed = false }) {
  if (!shootout) return null;
  const rounds = Math.max(5, ...[0, 1].map(t => shootout.kicks.filter(k => k.team === t).length));
  const decided = shootout.winner != null;
  const label = `Penalties ${shootout.score[0]}–${shootout.score[1]}`;
  return html`<section
    class=${cx('pens', decided && 'is-decided', fixed && 'pens--static')}
    aria-label=${label}
  >
    <header class="pens__head">
      <span class="eyebrow"
        >${shootout.suddenDeath && !decided ? 'Sudden death' : 'Penalty shootout'}</span
      >
      <span class="pens__score num">${shootout.score[0]}–${shootout.score[1]}</span>
    </header>
    ${[0, 1].map(
      t =>
        html`<div
          key=${t}
          class=${cx('pens__row', shootout.kicking === t && 'is-kicking', shootout.winner === t && 'is-winner')}
          style=${teamStyle(teamColors(teams[t]))}
        >
          <span class="pens__team"
            ><${TeamMark} team=${teams[t]} size=${20} /><span class="truncate"
              >${teams[t]?.short || teams[t]?.name}</span
            ></span
          >
          <${KickDots} kicks=${shootout.kicks} team=${t} total=${rounds} />
        </div>`,
    )}
    <p class="pens__now">
      ${
        decided
          ? html`<strong>${teams[shootout.winner]?.name}</strong> win on penalties`
          : shootout.taker
            ? [
                html`<strong>${shootout.taker}</strong>`,
                html`<span class="text-3"> vs </span>`,
                shootout.keeper || 'the keeper',
              ]
            : html`<span class="text-3">Next kick…</span>`
      }
    </p>
  </section>`;
}

const STORY_LABELS = {
  'late winner': 'Late winner',
  winner: 'Winner',
  'hat-trick': 'Hat-trick',
  haul: 'Four-goal haul',
  comeback: 'Comeback',
  equaliser: 'Equaliser',
  brace: 'Brace',
  'go-ahead': 'Go-ahead goal',
  opener: 'Opener',
  stoppage: 'Stoppage time',
  late: 'Late goal',
};
const STORY_ORDER = Object.keys(STORY_LABELS);

export function storyTag(story = []) {
  const tag = STORY_ORDER.find(s => story.includes(s));
  if (!tag) return null;
  if (tag === 'late' && story.includes('equaliser')) return 'Late equaliser';
  return STORY_LABELS[tag];
}

/** Goal celebration banner over the pitch (+ team-colour confetti, off with reduced motion). */
export function GoalOverlay({ goal, teams = [], replay = false, onSkip }) {
  if (!goal) return null;
  const team = teams[goal.team] || {},
    colors = teamColors(team),
    tag = storyTag(goal.story);
  return html`<div
    class=${cx('goal', replay && 'is-replay')}
    style=${teamStyle(colors)}
    data-testid="goal-overlay"
  >
    <${Confetti}
      fire=${goal.id}
      count=${140}
      colors=${[...colors, '#ffffff', '#cdf545'].filter(Boolean)}
      origin=${{ x: 0.5, y: 0.35 }}
    />
    ${
      replay
        ? html`<div class="goal__replay">
            <span class="goal__replay-badge"><${Icon} name="rotate-ccw" size=${14} /> Replay</span>
            <span class="goal__replay-who">${goal.scorer || team.name} ${goal.minute}</span>
          </div>`
        : html`<div class="goal__banner">
            <span class="goal__word"
              >${goal.kind === 'shootout' ? 'Winners' : goal.ownGoal ? 'Own goal' : 'Goal'}</span
            >
            <div class="goal__line">
              <${TeamMark} team=${team} size=${28} />
              <span class="goal__score num"
                >${goal.score[0]}<span class="goal__dash">–</span>${goal.score[1]}</span
              >
              ${goal.kind === 'shootout' && html`<span class="goal__pens">pens</span>`}
            </div>
            <p class="goal__who">
              <strong>${goal.scorer || team.name}</strong>
              <span class=${goal.kind === 'shootout' ? 'goal__how' : 'num'}>${goal.minute}</span>
              ${goal.penalty && html`<span class="goal__pen">(pen)</span>`}
            </p>
            ${goal.assist && html`<p class="goal__assist">Assist ${goal.assist}</p>`}
            ${tag && html`<span class="goal__tag">${tag}</span>`}
          </div>`
    }
    ${
      onSkip &&
      html`<button type="button" class="goal__skip" onClick=${onSkip}>
        ${replay ? 'Skip replay' : 'Continue'} <${Icon} name="skip-forward" size=${14} />
      </button>`
    }
  </div>`;
}
