// The trophy cabinet on Home (lib/records.js): one slot per difficulty with the best finish —
// the gold cup, a silver or bronze medal, or the round reached — and its medal counts; the
// Budget-mode trophies (their own, green kind) alongside; and the ultimate achievement, a
// perfect Legendary run in Budget mode. Legendary is the game's main challenge: the centre and
// largest slot. Each slot starts a run on its difficulty.
import { useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { Segmented } from '../../components/segmented.js';
import { href } from '../../lib/router.js';
import { Icon } from '../../components/icon.js';
import { Prize, Cup } from '../../components/cup.js';
import { int } from '../../lib/format.js';

const MAIN = 'legendary';
const plural = (n, one, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
/** "Champions ×2", "Runners-up", "Quarter-finals", "Not played". */
const bestText = tally =>
  !tally.runs ? 'Not played' : tally.gold > 1 ? `Champions ×${int(tally.gold)}` : tally.bestLabel;
const said = tally =>
  !tally.runs
    ? 'not played yet'
    : `best finish ${tally.bestLabel}, ${plural(tally.gold, 'gold')}, ${int(tally.silver)} silver, ${int(tally.bronze)} bronze${tally.perfect ? ', with a perfect run' : ''}`;

function Slot({ level, budget }) {
  const main = level.id === MAIN;
  // The Budget cabinet is the same shelf with the Budget-mode results (their own green trophies).
  const tally = budget ? level.budget : level;
  return html`<li class=${cx('cabinet__item', main && 'is-main')}>
    <a
      class=${cx(
        'cabinet__slot',
        main && 'is-main',
        tally.medal && `is-${tally.medal}`,
        tally.perfect > 0 && 'is-perfect',
      )}
      href=${href(
        '/play/:mode',
        { mode: 'run' },
        { difficulty: level.id, ...(budget ? { budget: 1 } : {}) },
      )}
      aria-label=${`${level.label}${budget ? ', Budget mode' : ''}: ${said(tally)}. Start a ${level.label} run`}
      data-level=${level.id}
      data-best=${tally.runs ? tally.best : ''}
    >
      <span class="cabinet__prize" aria-hidden="true">
        <${Prize}
          medal=${tally.medal}
          size=${main ? 84 : 56}
          glow=${main && tally.medal === 'gold'}
          budget=${budget}
        />
        ${
          tally.perfect > 0 &&
          html`<span class="cabinet__star" title="Perfect run: eight wins out of eight"
            ><${Icon} name="star" size=${11}
          /></span>`
        }
      </span>
      <span class="cabinet__level">${level.label}</span>
      <span class="cabinet__best">${bestText(tally)}</span>
      ${
        tally.runs > 0 &&
        html`<span class="cabinet__medals num" aria-hidden="true">
          <span class="is-gold">${int(tally.gold)}</span>
          <span class="is-silver">${int(tally.silver)}</span>
          <span class="is-bronze">${int(tally.bronze)}</span>
        </span>`
      }
    </a>
  </li>`;
}

function Ultimate({ ultimate }) {
  const done = ultimate.done;
  const first = ultimate.first ? new Date(ultimate.first) : null;
  const when =
    first && !Number.isNaN(first.getTime())
      ? first.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : null;
  return html`<div
    class=${cx('cabinet__ultimate', done ? 'is-done' : 'is-locked')}
    data-testid="ultimate"
    data-done=${done ? '1' : '0'}
  >
    <span class="cabinet__ultimate-mark" aria-hidden="true">
      ${
        done
          ? html`<${Cup} metal="holo" emblem="crown" size=${60} glow />`
          : html`<${Icon} name="lock" size=${22} />`
      }
    </span>
    <div class="cabinet__ultimate-text">
      <h3 class="cabinet__ultimate-name">${ultimate.name}</h3>
      <p class="cabinet__ultimate-how">
        ${
          done
            ? `Legendary, Budget mode, eight wins out of eight${ultimate.count > 1 ? ` — ${int(ultimate.count)} times` : ''}${when ? `. First on ${when}.` : '.'}`
            : ultimate.requirement
        }
      </p>
    </div>
  </div>`;
}

export function Cabinet({ records }) {
  // The shelf is a podium: Legendary in the middle.
  const byId = Object.fromEntries(records.levels.map(l => [l.id, l]));
  const shelf = [byId.pro, byId[MAIN], byId.worldclass].filter(Boolean);
  const [mode, setMode] = useState('normal');
  const budget = mode === 'budget';
  return html`<section
    class="cabinet card card--pad-md"
    aria-labelledby="records-title"
    data-testid="cabinet"
  >
    <div class="cabinet__head">
      <div>
        <p class="eyebrow">World Cup Runs</p>
        <h2 class="section-title" id="records-title">Trophy cabinet</h2>
      </div>
      <p
        class="cabinet__count num"
        aria-label=${`${records.won} of ${records.levels.length} World Cups won`}
      >
        <b>${records.won}</b>/${records.levels.length}
      </p>
    </div>
    <${Ultimate} ultimate=${records.ultimate} />
    <${Segmented}
      label="Which trophies"
      options=${[
        { value: 'normal', label: 'Classic' },
        { value: 'budget', label: 'Budget' },
      ]}
      value=${mode}
      onChange=${setMode}
      block
      size="sm"
      class="cabinet__mode"
    />
    <ul class="cabinet__shelf" role="list" data-mode=${mode}>
      ${shelf.map(level => html`<${Slot} key=${level.id} level=${level} budget=${budget} />`)}
    </ul>
    ${
      records.runs > 0 &&
      html`<p class="cabinet__foot">
        ${[
          plural(records.runs, 'run'),
          plural(records.titles, 'title'),
          records.medals.silver > 0 && `${int(records.medals.silver)} silver`,
          records.medals.bronze > 0 && `${int(records.medals.bronze)} bronze`,
          records.perfect > 0 && plural(records.perfect, 'perfect run'),
        ]
          .filter(Boolean)
          .map(text => html`<span key=${text}>${text}</span>`)}
      </p>`
    }
  </section>`;
}
