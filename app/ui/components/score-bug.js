/**
 * ScoreBug — broadcast-style score strip.
 *   home, away  { name, short?: 'BRA', code?: flag code, flagSrc?, colors?: [p, s], score,
 *                 reds?: number of players sent off (a red card by the name, as on TV) }
 *               (a flag when code/flagSrc is given, otherwise a club Crest in its colours)
 *   clock       "67'" or '67:12' (string);  period  '1H' | '2H' | 'HT' | 'FT' | 'ET1' | 'ET2' |
 *               'AET' (after extra time) | 'PENS'
 *   live        red pulsing dot
 *   pens        [home, away] shoot-out score, shown under the clock
 *   size        'sm' (overlay) | 'md' (default) | 'lg' (result header, full names)
 */
import { html, cx } from '../lib/html.js';
import { teamStyle } from '../lib/color.js';
import { Flag } from './flag.js';
import { Crest, clubInitials } from './crest.js';

const MARK = { sm: 20, md: 28, lg: 40 };

function Side({ team = {}, side, size }) {
  const mark = MARK[size] || 28;
  const short = team.short || clubInitials(team.name || '', 3);
  return html`<div
    class=${cx('scorebug__team', `scorebug__team--${side}`)}
    style=${teamStyle(team.colors)}
  >
    <span class="scorebug__stripe" aria-hidden="true"></span>
    ${
      team.code || team.flagSrc
        ? html`<${Flag}
            code=${team.code}
            src=${team.flagSrc}
            name=${team.name}
            size=${mark}
            decorative
          />`
        : html`<${Crest} name=${team.name} colors=${team.colors} size=${mark} decorative />`
    }
    <span class="scorebug__name">
      <span class="scorebug__short">${short}</span>
      ${size === 'lg' && html`<span class="scorebug__full">${team.name}</span>`}
    </span>
    ${
      team.reds > 0 &&
      html`<span class="scorebug__reds" data-testid="scorebug-reds">
        ${Array.from(
          { length: Math.min(team.reds, 3) },
          (_, i) => html`<span class="scorebug__red" key=${i}></span>`,
        )}
      </span>`
    }
  </div>`;
}

export function ScoreBug({
  home = {},
  away = {},
  clock,
  period,
  live = false,
  pens,
  size = 'md',
  class: className,
}) {
  const sentOff = t => (t.reds > 0 ? ` (${t.reds} sent off)` : '');
  const label = `${home.name}${sentOff(home)} ${home.score ?? 0}, ${away.name}${sentOff(away)} ${away.score ?? 0}${
    clock ? `, ${clock}` : ''
  }${period ? `, ${period}` : ''}${pens ? `, penalties ${pens[0]}–${pens[1]}` : ''}`;
  return html`<div
    class=${cx('scorebug', `scorebug--${size}`, live && 'is-live', className)}
    role="group"
    aria-label=${label}
  >
    <div class="scorebug__bar" aria-hidden="true">
      <${Side} team=${home} side="home" size=${size} />
      <div class="scorebug__score num">
        <span>${home.score ?? 0}</span><span class="scorebug__dash">–</span
        ><span>${away.score ?? 0}</span>
      </div>
      <${Side} team=${away} side="away" size=${size} />
    </div>
    ${
      (clock || period || pens) &&
      html`<div class="scorebug__meta" aria-hidden="true">
        ${live && html`<span class="scorebug__live"></span>`}
        ${clock && html`<span class="num">${clock}</span>`}
        ${period && html`<span class="scorebug__period">${period}</span>`}
        ${pens && html`<span class="scorebug__pens num">(${pens[0]}–${pens[1]} pens)</span>`}
      </div>`
    }
  </div>`;
}
