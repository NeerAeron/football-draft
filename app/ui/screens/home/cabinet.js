// The trophy cabinet on Home (lib/records.js): one slot per difficulty with the best finish —
// the gold cup, a silver or bronze medal, or the round reached — and its medal counts; the
// Budget-mode trophies (their own, green kind) alongside; and the ultimate achievement, a
// perfect Legendary run in Budget mode. Legendary is the game's main challenge: the centre and
// largest slot. Each slot starts a run on its difficulty.
import { html, cx } from '../../lib/html.js';
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

function Slot({ level }) {
  const main = level.id === MAIN;
  const b = level.budget;
  return html`<li class=${cx('cabinet__item', main && 'is-main')}>
    <a
      class=${cx(
        'cabinet__slot',
        main && 'is-main',
        level.medal && `is-${level.medal}`,
        level.perfect > 0 && 'is-perfect',
      )}
      href=${href('/play/:mode', { mode: 'run' }, { difficulty: level.id })}
      aria-label=${`${level.label}: ${said(level)}. Budget mode: ${said(b)}. Start a ${level.label} run`}
      data-level=${level.id}
      data-best=${level.runs ? level.best : ''}
    >
      ${main && html`<span class="cabinet__tag">${level.gold ? 'Conquered' : 'The big one'}</span>`}
      <span class="cabinet__prize" aria-hidden="true">
        <${Prize}
          medal=${level.medal}
          size=${main ? 84 : 56}
          glow=${main && level.medal === 'gold'}
        />
        ${
          level.perfect > 0 &&
          html`<span class="cabinet__star" title="Perfect run: eight wins out of eight"
            ><${Icon} name="star" size=${11}
          /></span>`
        }
      </span>
      <span class="cabinet__level">${level.label}</span>
      <span class="cabinet__best">${bestText(level)}</span>
      ${
        level.runs > 0 &&
        html`<span class="cabinet__medals num" aria-hidden="true">
          <span class="is-gold">${int(level.gold)}</span>
          <span class="is-silver">${int(level.silver)}</span>
          <span class="is-bronze">${int(level.bronze)}</span>
        </span>`
      }
      <span
        class=${cx('cabinet__budget', b.runs > 0 && 'is-played', b.medal && 'is-won')}
        aria-hidden="true"
      >
        <${Prize} medal=${b.medal} size=${20} budget />
        <span
          ><span class="cabinet__budget-word">Budget</span
          >${b.runs ? ` ${b.gold > 1 ? `Won ×${int(b.gold)}` : b.bestShort}` : ''}</span
        >
      </span>
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
      <p class="eyebrow">
        ${done ? 'The ultimate achievement · unlocked' : 'The ultimate achievement · locked'}
      </p>
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
  const main = byId[MAIN];
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
    <p class="cabinet__lead">
      ${
        records.ultimate.done
          ? 'Legendary, Budget mode, eight out of eight. There is nothing harder in this game, and you did it.'
          : main?.gold
            ? 'You have won the World Cup on Legendary. One thing is left: do it in Budget mode, eight out of eight.'
            : 'Three World Cups to win. Legendary is the one that counts: the hardest cup in the game.'
      }
    </p>
    <ul class="cabinet__shelf" role="list">
      ${shelf.map(level => html`<${Slot} key=${level.id} level=${level} />`)}
    </ul>
    <${Ultimate} ultimate=${records.ultimate} />
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
