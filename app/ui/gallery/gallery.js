// Component gallery (app/gallery.html): every shared component in its variants with real
// catalog players, for design review and screenshot QA. ?only=<section-id> renders one section
// (e.g. gallery.html?only=player-card), which keeps screenshots focused.
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import '../lib/motion.js';
import { playCue } from '../lib/audio.js';
import { PLAYERS, LEAGUES, CLUBS, NATIONS } from './fixture.js';
import {
  Icon,
  ICON_NAMES,
  Button,
  IconButton,
  Chip,
  ToggleChip,
  ChipGroup,
  Segmented,
  Card,
  Panel,
  Flag,
  Crest,
  LeagueLogo,
  FitTag,
  PlayerCard,
  PlayerRow,
  PitchView,
  Meter,
  StatBar,
  StatTile,
  Reel,
  Modal,
  Sheet,
  Tabs,
  Toaster,
  toast,
  achievement,
  ScoreBug,
  GradeBadge,
  GRADES,
  Confetti,
  EmptyState,
  Skeleton,
  Switch,
  Range,
} from '../components/index.js';

const XI = PLAYERS.slice(0, 11);
const [, , , VVD, , RODRI, , BELLINGHAM, , HAALAND, SALAH] = XI;
const STAR = PLAYERS[11];
const STARTER = PLAYERS[12];
const NORMAL = PLAYERS[13];
const BENCH = PLAYERS[14];
const CLUBLESS = PLAYERS[15];
const TIER_ROW = [SALAH, STAR, STARTER, NORMAL, BENCH];

function Section({ id, title, note, children }) {
  return html`<section class="g-section" id=${id} aria-labelledby=${`${id}-title`}>
    <header class="g-section__head">
      <h2 id=${`${id}-title`}>${title}</h2>
      ${note && html`<p>${note}</p>`}
    </header>
    ${children}
  </section>`;
}

const Demo = ({ label, children, wide }) =>
  html`<div class=${wide ? 'g-demo g-demo--wide' : 'g-demo'}>
    ${label && html`<p class="g-label">${label}</p>`}
    <div class="g-demo__body">${children}</div>
  </div>`;

// ---------- Sections ----------

const SWATCHES = [
  ['--bg', 'bg'],
  ['--surface-1', 'surface-1'],
  ['--surface-2', 'surface-2'],
  ['--surface-3', 'surface-3'],
  ['--surface-4', 'surface-4'],
  ['--text-1', 'text-1'],
  ['--text-2', 'text-2'],
  ['--text-3', 'text-3'],
  ['--volt-400', 'volt'],
  ['--gold-400', 'gold'],
  ['--coral-400', 'coral'],
  ['--green-400', 'green'],
  ['--amber-400', 'amber'],
  ['--sky-400', 'sky'],
  ['--pitch-600', 'pitch'],
];
const FOILS = ['superstar', 'star', 'starter', 'normal', 'bench'];

function Tokens() {
  return html`<${Section} id="tokens" title="Tokens" note="app/ui/styles/tokens.css">
    <${Demo} label="Colour" wide>
      <div class="g-swatches">
        ${SWATCHES.map(
          ([v, name]) =>
            html`<div class="g-swatch" key=${v}>
              <span style=${`background:var(${v})`}></span><code>${name}</code>
            </div>`,
        )}
      </div>
    <//>
    <${Demo} label="Tier foils (OVR 85+ / 80–84 / 74–79 / 68–73 / below)" wide>
      <div class="g-swatches">
        ${FOILS.map(
          t =>
            html`<div class="g-swatch g-swatch--foil" key=${t}>
              <span style=${`background:var(--tier-${t}-frame)`}></span><code>${t}</code>
            </div>`,
        )}
      </div>
    <//>
    <${Demo} label="Type" wide>
      <div class="g-type">
        <p class="display display-2xl">7–0</p>
        <p class="display display-xl">World Cup Run</p>
        <h1>Display LG · h1</h1>
        <h2>Display MD · h2</h2>
        <h3>Display SM · h3</h3>
        <p class="eyebrow">Eyebrow label</p>
        <p class="lead">Lead text — Inter 17 for intros and hero copy.</p>
        <p>Body text — Inter 15/1.5. The quick winger skipped past two defenders.</p>
        <p class="text-sm text-3">Small muted text for captions and metadata.</p>
        <p class="num" style="font-size:40px">90 · 2–1 · 67'</p>
      </div>
    <//>
  <//>`;
}

function Buttons() {
  const [loading, setLoading] = useState(false);
  return html`<${Section} id="buttons" title="Button & IconButton">
    <${Demo} label="Variants">
      <${Button} variant="primary" icon="play">Primary<//>
      <${Button} variant="secondary">Secondary<//>
      <${Button} variant="ghost">Ghost<//>
      <${Button} variant="danger" icon="trash">Danger<//>
      <${Button} variant="primary" disabled>Disabled<//>
    <//>
    <${Demo} label="Sizes">
      <${Button} variant="secondary" size="sm" icon="shuffle">Small<//>
      <${Button} variant="secondary" size="md">Medium<//>
      <${Button} variant="secondary" size="lg">Large<//>
    <//>
    <${Demo} label="Hero CTA (xl, block) and loading" wide>
      <div class="g-col">
        <${Button} variant="primary" size="xl" block iconEnd="arrow-right">Start World Cup Run<//>
        <div class="cluster">
          <${Button}
            variant="primary"
            loading=${loading}
            onClick=${() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
            >${loading ? 'Simulating…' : 'Sim rest of run'}<//
          >
          <${Button} variant="secondary" loading>Loading<//>
          <${Button} variant="ghost" href="#buttons" iconEnd="chevron-right">Link button<//>
        </div>
      </div>
    <//>
    <${Demo} label="IconButton (ghost, secondary, primary, pressed, badge)">
      <${IconButton} icon="settings" label="Settings" />
      <${IconButton} icon="volume-2" label="Mute" pressed />
      <${IconButton} icon="share-2" label="Share" variant="secondary" />
      <${IconButton} icon="play" label="Play" variant="primary" size="lg" />
      <${IconButton} icon="bell" label="Notifications" badge=${3} />
      <${IconButton} icon="x" label="Close" size="sm" />
    <//>
  <//>`;
}

function Icons() {
  return html`<${Section}
    id="icons"
    title="Icons"
    note="Lucide 1.50 subset (ISC) + custom ball, pitch, reel"
  >
    <div class="g-icons">
      ${ICON_NAMES.map(
        n =>
          html`<div class="g-icon" key=${n} title=${n}>
            <${Icon} name=${n} size=${22} /><code>${n}</code>
          </div>`,
      )}
    </div>
  <//>`;
}

function Chips() {
  const [pos, setPos] = useState('all');
  const [multi, setMulti] = useState(['ATT', 'MID']);
  const [type, setType] = useState('nations');
  const [speed, setSpeed] = useState('2');
  const [pressed, setPressed] = useState(true);
  return html`<${Section} id="chips" title="Chip, ToggleChip, ChipGroup, Segmented">
    <${Demo} label="Chip tones (soft)">
      ${['neutral', 'volt', 'gold', 'coral', 'green', 'sky', 'amber', 'holo'].map(
        t => html`<${Chip} key=${t} tone=${t}>${t}<//>`,
      )}
    <//>
    <${Demo} label="Solid, outline, small, icon">
      <${Chip} tone="volt" variant="solid">Best fit<//>
      <${Chip} tone="gold" variant="outline">New<//>
      <${Chip} tone="coral" icon="triangle-alert">Held you back<//>
      <${Chip} tone="gold" size="sm">Clinical Finish<//>
      <${Chip} tone="green" icon="check" size="sm">Played<//>
    <//>
    <${Demo} label="ToggleChip + ChipGroup (single, with counts)" wide>
      <${ChipGroup}
        label="Position"
        value=${pos}
        onChange=${setPos}
        options=${[
          { value: 'all', label: 'All', count: 23 },
          { value: 'GK', label: 'GK', count: 3 },
          { value: 'DEF', label: 'DEF', count: 8 },
          { value: 'MID', label: 'MID', count: 7 },
          { value: 'ATT', label: 'ATT', count: 5 },
        ]}
      />
      <${ChipGroup}
        label="Lines"
        multiple
        size="sm"
        value=${multi}
        onChange=${setMulti}
        options=${['GK', 'DEF', 'MID', 'ATT'].map(v => ({ value: v, label: v }))}
      />
      <${ToggleChip} pressed=${pressed} onChange=${setPressed} icon="eye-off">Hide ratings<//>
    <//>
    <${Demo} label="Segmented" wide>
      <div class="g-col">
        <${Segmented}
          label="Draft from"
          block
          value=${type}
          onChange=${setType}
          options=${[
            { value: 'nations', label: 'Nations' },
            { value: 'leagues', label: 'Leagues' },
            { value: 'clubs', label: 'Clubs' },
            { value: 'club-country', label: 'Club & Country' },
          ]}
        />
        <div class="cluster">
          <${Segmented}
            label="Speed"
            size="sm"
            value=${speed}
            onChange=${setSpeed}
            options=${[
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
              { value: '4', label: '4×' },
            ]}
          />
          <${Segmented}
            label="Mentality"
            tone="gold"
            value="balanced"
            options=${[
              { value: 'hold', label: 'Hold', icon: 'shield' },
              { value: 'balanced', label: 'Balanced', icon: 'equal' },
              { value: 'push', label: 'Push', icon: 'zap' },
            ]}
          />
        </div>
      </div>
    <//>
  <//>`;
}

function Cards() {
  return html`<${Section} id="cards" title="Card & Panel">
    <div class="g-grid">
      ${['default', 'raised', 'outline', 'glass', 'hero', 'gold', 'volt'].map(
        v =>
          html`<${Card} key=${v} variant=${v}
            ><p class="eyebrow">${v}</p>
            <p class="text-sm text-2">Card variant="${v}"</p><//
          >`,
      )}
      <${Card} href="#cards"
        ><p class="eyebrow">interactive</p>
        <p class="text-sm text-2">href → hover lift + focus ring</p><//
      >
    </div>
    <${Panel}
      title="Squad strength"
      eyebrow="Panel"
      description="Titled section with actions"
      actions=${html`<${IconButton} icon="info" label="About" size="sm" />`}
    >
      <p class="text-2 text-sm">Panel body content.</p>
    <//>
  <//>`;
}

function Identity() {
  return html`<${Section} id="flags" title="Flag, Crest, LeagueLogo">
    <${Demo} label="Flag — circle tokens (24 / 32 / 44)">
      ${NATIONS.map(n => html`<${Flag} key=${n.code} code=${n.code} name=${n.name} size=${32} />`)}
      <${Flag} code="br" name="Brazil" size=${24} />
      <${Flag} code="ar" name="Argentina" size=${44} />
    <//>
    <${Demo} label="Flag — rectangles; fallbacks (no code / missing file)">
      ${NATIONS.slice(0, 5).map(
        n => html`<${Flag} key=${n.code} code=${n.code} name=${n.name} shape="rect" size=${24} />`,
      )}
      <${Flag} name="Atlantis" size=${32} />
      <${Flag} name="Republic of Nowhere" shape="rect" size=${24} />
    <//>
    <${Demo} label="Crest — club colours + initials (disc, shield)">
      ${CLUBS.map(c => html`<${Crest} key=${c.name} name=${c.name} colors=${c.colors} size=${40} />`)}
      ${CLUBS.slice(0, 3).map(
        c =>
          html`<${Crest}
            key=${`s-${c.name}`}
            name=${c.name}
            colors=${c.colors}
            size=${40}
            shape="shield"
          />`,
      )}
    <//>
    <${Demo} label="LeagueLogo (with tier tag) + fallback">
      ${LEAGUES.map(
        l =>
          html`<${LeagueLogo}
            key=${l.name}
            src=${l.logo}
            name=${l.name}
            tier=${l.tier}
            size=${40}
          />`,
      )}
      <${LeagueLogo} name="Unknown League" size=${40} />
    <//>
  <//>`;
}

function Cards2() {
  const [selected, setSelected] = useState(SALAH.id);
  return html`<${Section}
    id="player-card"
    title="PlayerCard"
    note="Tier foil frames: Superstar holo · Star gold · Starter silver · Normal bronze · Bench slate"
  >
    <${Demo} label="Tiers (size M)" wide>
      <div class="g-cards">
        ${TIER_ROW.map(p => html`<${PlayerCard} key=${p.id} player=${p} />`)}
      </div>
    <//>
    <${Demo} label="Sizes S / M / L" wide>
      <div class="g-cards g-cards--bottom">
        <${PlayerCard} player=${HAALAND} size="s" />
        <${PlayerCard} player=${HAALAND} size="m" />
        <${PlayerCard} player=${HAALAND} size="l" />
      </div>
    <//>
    <${Demo}
      label="States: selectable (tap), selected, disabled, hidden ratings, keeper, club-less"
      wide
    >
      <div class="g-cards">
        ${[BELLINGHAM, VVD].map(
          p =>
            html`<${PlayerCard}
              key=${p.id}
              player=${p}
              selected=${selected === p.id}
              onClick=${() => setSelected(selected === p.id ? null : p.id)}
            />`,
        )}
        <${PlayerCard} player=${SALAH} selected />
        <${PlayerCard} player=${RODRI} disabled />
        <${PlayerCard} player=${HAALAND} hideRatings />
        <${PlayerCard} player=${XI[0]} />
        <${PlayerCard} player=${CLUBLESS} />
      </div>
    <//>
    <${Demo} label="Small cards in a row (bench / picks)" wide>
      <div class="g-cards">
        ${XI.slice(0, 6).map(p => html`<${PlayerCard} key=${p.id} player=${p} size="s" />`)}
      </div>
    <//>
  <//>`;
}

const FITS = [
  { state: 'best', label: 'Best' },
  { state: 'ok', label: 'ST' },
  { state: 'penalty', from: 79, to: 75 },
  { state: 'swap' },
  { state: 'blocked', label: 'No slot' },
  { state: 'neutral', label: 'CM · DM · CB' },
];

function Rows() {
  const [selected, setSelected] = useState(1);
  const pool = [SALAH, HAALAND, STAR, STARTER, NORMAL, BENCH];
  return html`<${Section} id="player-row" title="PlayerRow & FitTag">
    <${Demo} label="FitTag states">
      ${FITS.map(f => html`<${FitTag} key=${f.state} fit=${f} />`)}
      <${FitTag} fit=${{ state: 'penalty', from: 79, to: 75 }} hideRatings />
    <//>
    <div class="g-split">
      <${Demo} label="Pool list (tap to select)" wide>
        <ul class="player-list" role="list">
          ${pool.map(
            (p, i) =>
              html`<li key=${p.id}>
                <${PlayerRow}
                  player=${p}
                  fit=${FITS[i]}
                  selected=${selected === i}
                  disabled=${i === 4}
                  onClick=${() => setSelected(i)}
                />
              </li>`,
          )}
        </ul>
      <//>
      <${Demo} label="Narrow container (stats hide), hidden ratings, rank" wide>
        <div class="g-narrow">
          <ul class="player-list" role="list">
            ${pool.slice(0, 3).map(
              (p, i) =>
                html`<li key=${p.id}>
                  <${PlayerRow} player=${p} rank=${i + 1} fit=${FITS[i + 1]} />
                </li>`,
            )}
            <li><${PlayerRow} player=${VVD} hideRatings fit=${FITS[2]} /></li>
          </ul>
        </div>
      <//>
    </div>
  <//>`;
}

function Pitches() {
  const [selected, setSelected] = useState(9);
  const partial = XI.map((p, i) => ([0, 3, 5, 9].includes(i) ? p : null));
  const highlights = {
    1: { state: 'blocked' },
    2: { state: 'penalty', from: 84, to: 76 },
    4: { state: 'blocked' },
    6: { state: 'ok', label: 'CM' },
    7: { state: 'best' },
    8: { state: 'penalty', from: 84, to: 79 },
    10: { state: 'penalty', from: 84, to: 80 },
    9: { state: 'swap' },
  };
  const links = [
    { from: 0, to: 3, strength: 3 },
    { from: 9, to: 10, strength: 1 },
    { from: 5, to: 6, strength: 2 },
    { from: 7, to: 8, strength: 3 },
    { from: 1, to: 4, strength: 1 },
    { from: 2, to: 3, strength: 1 },
  ];
  return html`<${Section}
    id="pitch"
    title="PitchView"
    note="Placing a CM (R. De Paul): slots light up with fit before the pick is locked. Arrow keys move between slots."
  >
    <div class="g-pitches">
      <${Demo} label="Placing a player — fit highlights" wide>
        <${PitchView}
          formation="433"
          players=${partial}
          highlights=${highlights}
          selected=${selected}
          onSelect=${setSelected}
          label="Your XI"
        />
      <//>
      <${Demo} label="Full XI with link lines (club gold, nation volt, league dashed)" wide>
        <${PitchView} formation="433" players=${XI} links=${links} label="Superstar XI" />
      <//>
      <${Demo} label="4-2-3-1 empty · hidden ratings · mini" wide>
        <div class="g-mini-pitches">
          <${PitchView} formation="4231-wide" players=${[]} label="Empty 4-2-3-1" />
          <${PitchView} formation="352" players=${XI} hideRatings label="Hidden ratings" />
          <div class="g-mini">
            <${PitchView} formation="442" players=${XI} names=${false} label="Mini" />
          </div>
        </div>
      <//>
    </div>
  <//>`;
}

function Meters() {
  return html`<${Section} id="meters" title="Meter, StatBar, StatTile">
    <div class="g-split">
      <${Demo} label="Meters" wide>
        <div class="g-col">
          <${Meter} label="Team OVR" value=${86} delta=${2} size="lg" />
          <${Meter} label="Attack" value=${88} tone="auto" compare=${82} />
          <${Meter} label="Midfield" value=${77} tone="auto" />
          <${Meter} label="Defence" value=${66} tone="auto" delta=${-3} />
          <${Meter} label="Links" value=${7} max=${10} valueText="7/10" tone="gold" />
          <${Meter}
            label="Stamina"
            value=${41}
            tone="coral"
            size="sm"
            hint="Tiring — consider Hold"
          />
        </div>
      <//>
      <${Demo} label="StatBar (player detail)" wide>
        <div class="g-col">
          ${SALAH.stats.map(s => html`<${StatBar} key=${s.key} label=${s.key} value=${s.value} />`)}
        </div>
      <//>
    </div>
    <${Demo} label="StatTile (season / run summary)" wide>
      <div class="g-tiles">
        <${StatTile} label="Won" value=${6} tone="green" />
        <${StatTile} label="Drew" value=${1} tone="muted" />
        <${StatTile} label="Lost" value=${0} tone="coral" />
        <${StatTile} label="Scored" value=${19} tone="gold" />
        <${StatTile} label="Conceded" value=${4} />
        <${StatTile} label="Proj. round" value="QF" tone="volt" />
      </div>
    <//>
  <//>`;
}

function ReelDemo() {
  const items = NATIONS.map(n => ({ id: n.code, label: n.name, sub: 'Pot 1', flag: n }));
  const [spin, setSpin] = useState({ key: null, land: 2 });
  const [skip, setSkip] = useState(false);
  const [landed, setLanded] = useState(null);
  const leagueItems = LEAGUES.map(l => ({
    id: l.name,
    label: l.name,
    sub: `Tier ${l.tier}`,
    logo: { src: l.logo, name: l.name },
  }));
  return html`<${Section}
    id="reel"
    title="Reel"
    note="Honest reel: the landing index is decided first; the reel travels whole loops plus the offset. Tap the reel or Skip to land now. Reduced motion lands instantly."
  >
    <div class="g-split">
      <${Demo} label="Nation reel" wide>
        <div class="g-col">
          <${Reel}
            items=${items}
            landIndex=${spin.land}
            spinKey=${spin.key}
            skip=${skip}
            onTick=${() => playCue('tick')}
            onLand=${item => {
              setLanded(item.label);
              setSkip(false);
              playCue('reveal');
            }}
            label="Nation reel"
          />
          <div class="cluster">
            <${Button}
              variant="primary"
              icon="reel"
              onClick=${() => {
                setSkip(false);
                setSpin(s => ({
                  key: (s.key || 0) + 1,
                  land: Math.floor(Math.random() * items.length),
                }));
              }}
              >Spin<//
            >
            <${Button} variant="ghost" onClick=${() => setSkip(true)}>Skip<//>
            <span class="text-sm text-3" aria-live="polite"
              >${landed ? `Landed: ${landed}` : 'Ready'}</span
            >
          </div>
        </div>
      <//>
      <${Demo} label="League reel (small)" wide>
        <${Reel} items=${leagueItems} landIndex=${0} size="sm" label="League reel" />
      <//>
    </div>
  <//>`;
}

function Overlays() {
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState('xi');
  const [fire, setFire] = useState(0);
  return html`<${Section} id="overlays" title="Modal, Sheet, Tabs, Toast, Confetti">
    <${Demo} label="Dialogs and notifications">
      <${Button} onClick=${() => setModal(true)} data-testid="open-modal">Open modal<//>
      <${Button} onClick=${() => setSheet(true)} data-testid="open-sheet">Open sheet<//>
      <${Button}
        data-testid="toast"
        onClick=${() =>
          toast({
            title: 'Saved to this device',
            message: 'Your XI is ready for the next match.',
            tone: 'success',
          })}
        >Toast<//
      >
      <${Button}
        data-testid="toast-warning"
        onClick=${() => toast({ title: 'Stamina low', message: 'Two players are tiring.', tone: 'warning' })}
        >Warning toast<//
      >
      <${Button}
        data-testid="achievement"
        onClick=${() => {
          achievement({ title: 'Perfect group', description: 'Win all three group matches.' });
          playCue('pick-star');
        }}
        >Achievement<//
      >
      <${Button} variant="primary" icon="party-popper" onClick=${() => setFire(f => f + 1)}
        >Confetti<//
      >
    <//>
    <${Demo} label="Tabs (underline + pill)" wide>
      <div class="g-col">
        <${Tabs}
          label="Match report"
          value=${tab}
          onChange=${setTab}
          tabs=${[
            { id: 'xi', label: 'Ratings', icon: 'star' },
            { id: 'stats', label: 'Stats', icon: 'chart-column' },
            { id: 'events', label: 'Key moments', badge: 7 },
          ]}
          >${id => html`<p class="text-2 text-sm">Panel for <b>${id}</b>.</p>`}<//
        >
        <${Tabs}
          label="Pool view"
          variant="pill"
          value=${tab}
          onChange=${setTab}
          tabs=${[
            { id: 'xi', label: 'List' },
            { id: 'stats', label: 'Cards' },
            { id: 'events', label: 'Pitch' },
          ]}
          >${id => html`<p class="text-2 text-sm">Pill tabs: ${id}</p>`}<//
        >
      </div>
    <//>
    <${Modal}
      open=${modal}
      onClose=${() => setModal(false)}
      eyebrow="Round of 16"
      title="Change mentality?"
      description="Your side is 1–0 up with 20 minutes to go."
      footer=${html`<${Button} variant="ghost" onClick=${() => setModal(false)}>Keep Balanced<//>
        <${Button} variant="primary" icon="shield" onClick=${() => setModal(false)}
          >Hold the lead<//
        >`}
    >
      <${Meter} label="Stamina" value=${58} tone="amber" />
    <//>
    <${Sheet}
      open=${sheet}
      onClose=${() => setSheet(false)}
      title="Pick a slot"
      description="M. Salah fits these positions."
      footer=${html`<${Button} variant="primary" block onClick=${() => setSheet(false)}>Place at RW<//>`}
    >
      <ul class="player-list" role="list">
        <li><${PlayerRow} player=${SALAH} fit=${{ state: 'best', label: 'RW' }} /></li>
      </ul>
    <//>
    <${Confetti} fire=${fire} />
  <//>`;
}

function Results() {
  return html`<${Section} id="results" title="ScoreBug & GradeBadge">
    <${Demo} label="ScoreBug sm / md (live) / lg (pens)" wide>
      <div class="g-col g-col--center">
        <${ScoreBug}
          size="sm"
          home=${{ name: 'Brazil', short: 'BRA', code: 'br', colors: ['#f7d117', '#009c3b'], score: 1 }}
          away=${{ name: 'France', short: 'FRA', code: 'fr', colors: ['#1e3a8a', '#ffffff'], score: 0 }}
          clock="23'"
          period="1H"
        />
        <${ScoreBug}
          live
          home=${{ name: 'Liverpool', colors: CLUBS[0].colors, score: 2 }}
          away=${{ name: 'Real Madrid', colors: CLUBS[1].colors, score: 1 }}
          clock="67'"
          period="2H"
        />
        <${ScoreBug}
          size="lg"
          home=${{ name: 'Argentina', short: 'ARG', code: 'ar', colors: ['#75aadb', '#ffffff'], score: 2 }}
          away=${{ name: 'England', short: 'ENG', code: 'gb-eng', colors: ['#ffffff', '#cf081f'], score: 2 }}
          period="PENS"
          pens=${[4, 3]}
        />
      </div>
    <//>
    <${Demo} label="Grades" wide>
      <div class="cluster">
        ${GRADES.map(g => html`<${GradeBadge} key=${g} grade=${g} size="sm" />`)}
      </div>
    <//>
    <${Demo} label="Grade + verdict" wide>
      <div class="g-grades">
        <${GradeBadge} grade="S+" size="lg" verdict="Perfect run" detail="7–0 · 1,048 pts" />
        <${GradeBadge}
          grade="B+"
          size="lg"
          verdict="Knockout heartbreak"
          detail="5–1–1 · out in the SF"
        />
        <${GradeBadge} grade="F" size="md" verdict="Group stage exit" detail="0–1–2" />
      </div>
    <//>
  <//>`;
}

function States() {
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(45);
  return html`<${Section} id="states" title="EmptyState, Skeleton, Switch, Range">
    <div class="g-split">
      <${Card} padding="none">
        <${EmptyState}
          icon="trophy"
          tone="gold"
          title="No runs yet"
          message="Finish a World Cup Run to see your record here."
          action=${html`<${Button} variant="primary" size="sm">Start a run<//>`}
        />
      <//>
      <${Demo} label="Skeleton" wide>
        <div class="g-col">
          <div class="row"><${Skeleton} variant="circle" /><${Skeleton} lines=${2} /></div>
          <${Skeleton} variant="row" />
          <div class="row"><${Skeleton} variant="card" /><${Skeleton} variant="card" /></div>
        </div>
      <//>
    </div>
    <${Demo} label="Form controls" wide>
      <div class="g-col g-form">
        <${Switch}
          label="Hide ratings"
          description="Ball Knower mode"
          checked=${on}
          onChange=${setOn}
        />
        <${Range} label="Volume" value=${vol} valueText=${`${vol}%`} onInput=${setVol} />
      </div>
    <//>
  <//>`;
}

const SECTIONS = [
  ['tokens', 'Tokens', Tokens],
  ['buttons', 'Buttons', Buttons],
  ['icons', 'Icons', Icons],
  ['chips', 'Chips & segmented', Chips],
  ['cards', 'Cards', Cards],
  ['flags', 'Flags & crests', Identity],
  ['player-card', 'PlayerCard', Cards2],
  ['player-row', 'PlayerRow', Rows],
  ['pitch', 'PitchView', Pitches],
  ['meters', 'Meters', Meters],
  ['reel', 'Reel', ReelDemo],
  ['overlays', 'Overlays', Overlays],
  ['results', 'Score & grades', Results],
  ['states', 'States & forms', States],
];

function Gallery() {
  const only = new URLSearchParams(location.search).get('only');
  const shown = SECTIONS.filter(([id]) => !only || id === only);
  return html`<div class="gallery">
    <header class="gallery__top">
      <div class="container gallery__bar">
        <a class="gallery__brand" href="./">Football Draft</a>
        <span class="gallery__name">Component gallery</span>
      </div>
    </header>
    <div class="container gallery__layout">
      <nav class="gallery__nav" aria-label="Sections">
        ${SECTIONS.map(([id, label]) => html`<a key=${id} href=${`?only=${id}`}>${label}</a>`)}
        <a href="?">All</a>
      </nav>
      <main class="gallery__main" id="main">
        ${shown.map(([id, , C]) => html`<${C} key=${id} />`)}
      </main>
    </div>
    <${Toaster} />
  </div>`;
}

render(html`<${Gallery} />`, document.getElementById('app'));
