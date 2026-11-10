// Home: one big World Cup Run CTA with a draft-type quick switch, the Daily Challenge,
// a continue-run card when a run is saved, and the other modes.
import { useEffect, useMemo } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { useStore } from '../../lib/store.js';
import { href } from '../../lib/router.js';
import { prefs, setPref } from '../../lib/prefs.js';
import { readSavedRun, readDailyStatus, readSavedDraft, STAGES } from '../../lib/saved.js';
import { readRecords } from '../../lib/records.js';
import { Button, IconButton } from '../../components/button.js';
import { Card } from '../../components/card.js';
import { Chip } from '../../components/chip.js';
import { Icon } from '../../components/icon.js';
import { Segmented } from '../../components/segmented.js';
import { HowToSteps } from '../../shell/how-to-play.js';
import { preloadRoutes } from '../../lib/screen-loader.js';
import { HeroArt } from './hero-art.js';
import { int } from '../../lib/format.js';

export const DRAFT_TYPE_OPTIONS = [
  { value: 'nations', label: 'Nations' },
  { value: 'leagues', label: 'Leagues' },
  { value: 'clubs', label: 'Clubs' },
  { value: 'club-country', label: 'Club & Country' },
];

const TYPE_HINT = {
  nations: 'Spin a nation, pick from its best 23 call-ups.',
  leagues: 'Spin a league, pick anyone who plays there.',
  clubs: 'One spin lands a league and a club — pick from that squad.',
  'club-country': 'Alternate nation and league spins. Overlaps link up.',
};

const TYPE_LABEL = Object.fromEntries(DRAFT_TYPE_OPTIONS.map(o => [o.value, o.label]));

const MODES = [
  {
    id: 'quick',
    icon: 'zap',
    title: 'Quick Match',
    text: 'Draft any way, then one match against the AI.',
    href: href('/play/:mode', { mode: 'quick' }),
  },
  {
    id: 'versus',
    icon: 'swords',
    title: 'Versus',
    text: 'Two players, one device. Alternate picks, then kick off.',
    href: href('/play/:mode', { mode: 'versus' }),
  },
  {
    id: 'exhibition',
    icon: 'tv',
    title: 'Exhibition',
    text: 'Any two real teams — clubs or national sides. No draft.',
    href: href('/exhibition'),
  },
];

function RunPath({ stage = null, record = null, perfect = true }) {
  const reached = stage ? STAGES.findIndex(s => s.id === stage) : -1;
  return html`<div class="run-path">
    <ol
      class="run-path__track"
      role="list"
      aria-label="Three group matches, then four knockout rounds"
    >
      ${STAGES.map((s, i) => {
        const state = i < reached ? 'done' : i === reached ? 'current' : 'todo';
        return html`<li
          key=${s.id}
          class=${cx('run-path__pip', `is-${state}`, s.id === 'F' && 'is-final', i === 3 && 'is-ko')}
          title=${s.label}
          aria-label=${`${s.label}${state === 'done' ? ', played' : state === 'current' ? ', next' : ''}`}
        >
          ${
            s.id === 'F'
              ? html`<${Icon} name="trophy" size=${15} />`
              : html`<span class="num" aria-hidden="true">${s.short}</span>`
          }
        </li>`;
      })}
    </ol>
    <div class="run-path__legend" aria-hidden="true">
      <span class="run-path__group">Group</span><span>Knockouts</span>
      ${perfect && html`<span class="run-path__perfect"><b class="num">7–0</b> perfect run</span>`}
      ${record && html`<span class="num run-path__record">${record.w}–${record.d}–${record.l}</span>`}
    </div>
  </div>`;
}

function Hero({ type }) {
  return html`<section class="home-hero card card--hero" aria-labelledby="home-hero-title">
    <div class="home-hero__art"><${HeroArt} /></div>
    <div class="home-hero__content">
      <div class="home-hero__intro">
        <p class="eyebrow">Spin · Pick · Lift the cup</p>
        <h1 class="home-hero__title" id="home-hero-title">
          <span>World</span> <span>Cup</span> <em>Run</em>
        </h1>
        <p class="home-hero__lead">
          Draft an XI one spin at a time, then take it through the group and four knockout rounds.
        </p>
      </div>
      <${RunPath} />
      <div class="home-hero__launch">
        <${Segmented}
          label="Draft from"
          options=${DRAFT_TYPE_OPTIONS}
          value=${type}
          onChange=${v => setPref('draftType', v)}
          block
          size="sm"
          class="home-hero__seg"
        />
        <p class="home-hero__hint" aria-live="polite">${TYPE_HINT[type]}</p>
        <${Button}
          variant="primary"
          size="xl"
          block
          iconEnd="arrow-right"
          href=${href('/play/:mode', { mode: 'run' }, { type })}
          class="home-hero__cta"
          data-testid="start-run"
          >Start World Cup Run<//
        >
      </div>
    </div>
  </section>`;
}

function ContinueCard({ run }) {
  const stage = STAGES.find(s => s.id === run.stage);
  const done = run.complete;
  return html`<${Card}
    variant="volt"
    class="continue"
    as="section"
    aria-labelledby="continue-title"
  >
    <div class="continue__head">
      <span class="continue__icon" aria-hidden="true"><${Icon} name="play" size=${18} /></span>
      <div class="continue__titles">
        <p class="eyebrow">${done ? 'Last run' : 'Run in progress'}</p>
        <h2 class="continue__title" id="continue-title">
          ${done ? run.verdict || (run.status === 'champion' ? 'Champions' : 'Run over') : stage?.label || 'World Cup Run'}
        </h2>
      </div>
      <span
        class="continue__record num"
        aria-label=${`Record ${run.record.w} won, ${run.record.d} drawn, ${run.record.l} lost`}
        >${run.record.w}–${run.record.d}–${run.record.l}</span
      >
    </div>
    ${!done && html`<${RunPath} stage=${run.stage} perfect=${false} />`}
    <div class="continue__foot">
      <span class="continue__meta"
        >${TYPE_LABEL[run.type] || 'Nations'} draft${run.team ? ` · ${run.team}` : ''}</span
      >
      <${Button}
        variant=${done ? 'secondary' : 'primary'}
        size="sm"
        iconEnd="arrow-right"
        href=${href('/run')}
        data-testid="continue-run"
        >${done ? 'Results' : 'Continue'}<//
      >
    </div>
  <//>`;
}

const DRAFT_KIND = {
  run: 'World Cup Run',
  daily: 'Daily Challenge',
  quick: 'Quick Match',
  versus: 'Versus',
};

/** The draft in progress (lib/saved.js readSavedDraft): back to the board in one tap. */
function DraftCard({ draft }) {
  const kind = DRAFT_KIND[draft.context.kind] || 'Draft';
  const type =
    TYPE_LABEL[draft.context.type === 'clubAndCountry' ? 'club-country' : draft.context.type];
  const total = draft.total || 11;
  const pct = Math.round((draft.picks / total) * 100);
  return html`<${Card}
    variant="volt"
    class="continue continue--draft"
    as="section"
    aria-labelledby="draft-resume-title"
    data-testid="resume-draft-card"
  >
    <div class="continue__head">
      <span class="continue__icon" aria-hidden="true"><${Icon} name="reel" size=${18} /></span>
      <div class="continue__titles">
        <p class="eyebrow">${draft.complete ? 'XI complete' : 'Draft in progress'}</p>
        <h2 class="continue__title" id="draft-resume-title">${kind}</h2>
      </div>
      <span class="continue__record num" aria-label=${`${draft.picks} of ${total} picks made`}
        >${draft.picks}<small>/${total}</small></span
      >
    </div>
    <div
      class="draft-resume__bar"
      role="progressbar"
      aria-label="Draft progress"
      aria-valuemin="0"
      aria-valuemax=${total}
      aria-valuenow=${draft.picks}
    >
      <span style=${`width:${pct}%`}></span>
    </div>
    <div class="continue__foot">
      <span class="continue__meta"
        >${type ? `${type} draft · ` : ''}${draft.complete ? 'ready for kick-off' : `pick ${draft.picks + 1} of ${total}`}</span
      >
      <${Button}
        variant="primary"
        size="sm"
        iconEnd="arrow-right"
        href=${href('/draft')}
        data-testid="resume-draft"
        >${draft.complete ? 'Continue' : 'Resume'}<//
      >
    </div>
  <//>`;
}

function DailyCard({ daily }) {
  const played = daily.playedToday;
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return html`<${Card} variant="gold" class="home-daily" as="section" aria-labelledby="daily-title">
    <div class="home-daily__head">
      <span class="home-daily__icon" aria-hidden="true"
        ><${Icon} name="calendar-days" size=${20}
      /></span>
      <div class="home-daily__titles">
        <p class="eyebrow is-gold">Daily Challenge</p>
        <h2 class="home-daily__title" id="daily-title">${date}</h2>
      </div>
      ${
        played
          ? html`<${Chip} tone="green" icon="check">Played<//>`
          : html`<${Chip} tone="gold" variant="outline">New<//>`
      }
    </div>
    <p class="home-daily__text">
      ${
        daily.todayResult
          ? `Today: ${int(daily.todayResult.points)} pts${daily.todayResult.grade ? ` · grade ${daily.todayResult.grade}` : ''}. New spins at 00:00 UTC.`
          : 'Same spins for everyone today. Nations draft, one attempt, auto-simmed.'
      }
    </p>
    <div class="home-daily__foot">
      <span class="home-daily__streak" title="Days in a row">
        <${Icon} name="flame" size=${18} />
        <b class="num">${daily.streak}</b>
        <span>day streak</span>
        ${daily.best > 0 && html`<span class="home-daily__best">· best ${daily.best}</span>`}
      </span>
      <${Button} variant="secondary" size="sm" iconEnd="arrow-right" href=${href('/daily')}
        >${played ? 'Results' : 'Play'}<//
      >
    </div>
  <//>`;
}

/**
 * The trophy cabinet (lib/records.js): one cup per difficulty, lit once a World Cup Run has
 * been won on it, starred after a perfect seven. Each slot starts a run on that difficulty.
 */
function Cabinet({ records }) {
  const plural = (n, one, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
  return html`<section class="home-records card card--pad-md" aria-labelledby="records-title">
    <div class="home-records__head">
      <div>
        <p class="eyebrow">World Cup Runs</p>
        <h2 class="section-title" id="records-title">Trophy cabinet</h2>
      </div>
      <p
        class="home-records__count num"
        aria-label=${`${records.won} of ${records.levels.length} trophies won`}
      >
        <b>${records.won}</b>/${records.levels.length}
      </p>
    </div>
    <ul class="home-records__shelf" role="list">
      ${records.levels.map(level => {
        const won = level.titles > 0,
          perfect = level.perfect > 0;
        const status = won
          ? perfect
            ? 'Perfect'
            : level.titles > 1
              ? `Won ×${int(level.titles)}`
              : 'Won'
          : level.bestShort || 'Not played';
        const said = won
          ? `won ${plural(level.titles, 'time')}${perfect ? ', with a perfect run' : ''}`
          : level.runs
            ? `best run: ${level.bestLabel}`
            : 'not played yet';
        return html`<li key=${level.id}>
          <a
            class=${cx('home-records__slot', won && 'is-won', perfect && 'is-perfect')}
            href=${href('/play/:mode', { mode: 'run' }, { difficulty: level.id })}
            aria-label=${`${level.label}: ${said}. Start a ${level.label} run`}
            data-level=${level.id}
          >
            <span class="home-records__cup" aria-hidden="true">
              <${Icon} name="trophy" size=${26} />
              ${perfect && html`<span class="home-records__star"><${Icon} name="star" size=${11} /></span>`}
            </span>
            <span class="home-records__text">
              <span class="home-records__level">${level.label}</span>
              <span class="home-records__best">${status}</span>
            </span>
          </a>
        </li>`;
      })}
    </ul>
    <p class="home-records__foot">
      ${[
        plural(records.runs, 'run'),
        plural(records.titles, 'title'),
        records.perfect > 0 && plural(records.perfect, 'perfect run'),
      ]
        .filter(Boolean)
        .map(text => html`<span key=${text}>${text}</span>`)}
    </p>
  </section>`;
}

function ModeTiles() {
  return html`<section class="home-modes" aria-labelledby="modes-title">
    <h2 class="section-title" id="modes-title">More ways to play</h2>
    <ul class="home-modes__list" role="list">
      ${MODES.map(
        m =>
          html`<li key=${m.id}>
            <${Card} href=${m.href} class="mode-tile" padding="sm" data-mode=${m.id}>
              <span class="mode-tile__icon" aria-hidden="true"
                ><${Icon} name=${m.icon} size=${22}
              /></span>
              <span class="mode-tile__text">
                <span class="mode-tile__title">${m.title}</span>
                <span class="mode-tile__desc">${m.text}</span>
              </span>
              <${Icon} name="chevron-right" size=${18} class="mode-tile__chevron" />
            <//>
          </li>`,
      )}
    </ul>
  </section>`;
}

function FirstRun() {
  return html`<section class="home-first card card--pad-md" aria-labelledby="first-title">
    <div class="home-first__head">
      <div>
        <p class="eyebrow">New here?</p>
        <h2 class="section-title" id="first-title">How it works</h2>
      </div>
      <${IconButton}
        icon="x"
        label="Hide how it works"
        size="sm"
        onClick=${() => setPref('onboarded', true)}
      />
    </div>
    <${HowToSteps} class="howto--row" />
  </section>`;
}

export default function Home() {
  const { draftType, onboarded } = useStore(
    prefs,
    p => p,
    (a, b) => a.draftType === b.draftType && a.onboarded === b.onboarded,
  );
  const run = useMemo(readSavedRun, []);
  const draft = useMemo(readSavedDraft, []);
  const daily = useMemo(readDailyStatus, []);
  const records = useMemo(readRecords, []);
  useEffect(() => {
    const idle = globalThis.requestIdleCallback || (fn => setTimeout(fn, 400));
    idle(() => preloadRoutes(['/play/:mode', '/settings']));
  }, []);
  return html`<div class="screen home" data-screen="home">
    <div class="container home__grid">
      <div class="home__main"><${Hero} type=${draftType} /></div>
      ${!onboarded && html`<div class="home__first"><${FirstRun} /></div>`}
      <div class="home__side">
        <div class="home__cards">
          ${draft && html`<${DraftCard} draft=${draft} />`}
          ${run && html`<${ContinueCard} run=${run} />`}
          <${DailyCard} daily=${daily} />
        </div>
        <${ModeTiles} />
      </div>
      ${records.runs > 0 && html`<div class="home__records"><${Cabinet} records=${records} /></div>`}
    </div>
    <footer class="container home__footer">
      <nav class="home__links" aria-label="More">
        <a href=${href('/settings', {}, { section: 'credits' })}>Credits & licences</a>
        <a href="./config.html">Advanced tuning</a>
      </nav>
      <p>Unofficial fan project. Player data: rovnez / Kaggle, CC BY 4.0.</p>
    </footer>
  </div>`;
}
