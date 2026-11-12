// A finished tournament's honours, shared by the run's end screen and the Daily's result: the
// three awards over every team (Golden Boot, Golden Ball, Golden Glove — CupRun.awardsSteps(),
// computed in slices after the screen has painted) and the squad's table (CupRun.squadStats():
// matches, goals, assists, clean sheets, average rating — however the matches were played).
import { useEffect, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { stepped } from '../../../services/catalog.js';
import { Flag } from '../../components/flag.js';
import { Icon } from '../../components/icon.js';
import { surname } from '../../lib/player-view.js';
import { fmt1 } from '../../lib/format.js';

const AWARDS = [
  {
    id: 'boot',
    label: 'Golden Boot',
    value: a => a.goals,
    unit: a => (a.goals === 1 ? 'goal' : 'goals'),
  },
  { id: 'ball', label: 'Golden Ball', value: a => fmt1(a.average), unit: () => 'rating' },
  {
    id: 'glove',
    label: 'Golden Glove',
    value: a => a.cleanSheets,
    unit: a => (a.cleanSheets === 1 ? 'clean sheet' : 'clean sheets'),
  },
];

/** The awards of a finished run, or null until they are computed (and for a run still on). */
export function useAwards(run) {
  const [awards, setAwards] = useState(null);
  useEffect(() => {
    let live = true;
    setAwards(null);
    if (run?.complete)
      stepped(run.awardsSteps()).then(
        a => live && setAwards(a),
        () => {},
      );
    return () => (live = false);
  }, [run, run?.complete]);
  return awards;
}

/** The share text's line for them (core's shareText `honours`): names and the winning numbers. */
export function honoursFor(run, awards) {
  const top = run
    .squadStats()
    .filter(r => r.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists)[0];
  const short = a => a && { name: surname(a.name), goals: a.goals };
  return {
    scorer: short(top),
    boot: short(awards?.boot),
    ball: short(awards?.ball),
    glove: short(awards?.glove),
  };
}

function nationOf(catalog, award) {
  const name = award.nation ?? (award.team.kind === 'nation' ? award.team.name : null),
    nation = name && catalog.nations?.find(n => n.name === name);
  return nation ? { code: nation.code, name } : { code: null, name: award.team.name };
}

/** Three compact cards; a winner from the user's XI is lit. Keeps its height while loading. */
export function Awards({ catalog, awards, class: className }) {
  return html`<section class=${cx('run-awards', className)} aria-label="Tournament awards">
    ${AWARDS.map(({ id, label, value, unit }) => {
      const a = awards?.[id];
      const nation = a && nationOf(catalog, a);
      return html`<div
        key=${id}
        class=${cx('run-award', a?.user && 'is-yours', !a && 'is-pending')}
        data-testid=${`award-${id}`}
        data-yours=${a?.user ? '1' : null}
      >
        <p class="run-award__label"><${Icon} name="trophy" size=${12} /> ${label}</p>
        <p class="run-award__name truncate" title=${a?.name}>${a ? surname(a.name) : ' '}</p>
        <p class="run-award__team">
          ${
            a &&
            html`${nation.code && html`<${Flag} code=${nation.code} name=${nation.name} size=${16} />`}
              <span class="truncate">${nation.name}</span>`
          }
        </p>
        <p class="run-award__value">
          <b class="num">${a ? value(a) : '–'}</b>
          <span>${a ? unit(a) : ' '}</span>
        </p>
      </div>`;
    })}
  </section>`;
}

const COLUMNS = [
  { id: 'matches', short: 'M', label: 'Matches' },
  { id: 'goals', short: 'G', label: 'Goals' },
  { id: 'assists', short: 'A', label: 'Assists' },
  { id: 'cleanSheets', short: 'CS', label: 'Clean sheets' },
  { id: 'average', short: 'Rtg', label: 'Average match rating' },
];

/** The XI's tournament: one row per player, slot order. `rows`: CupRun.squadStats(). */
export function SquadTable({ rows, class: className }) {
  const most = Math.max(1, ...rows.map(r => r.goals));
  const cell = (r, id) =>
    id === 'average'
      ? r.average === null
        ? '–'
        : fmt1(r.average)
      : id === 'cleanSheets'
        ? r.role === 'GK'
          ? r.cleanSheets
          : ''
        : r[id];
  return html`<table class=${cx('run-squad', className)} data-testid="squad-stats">
    <thead>
      <tr>
        <th scope="col" class="run-squad__player">Player</th>
        ${COLUMNS.map(
          c => html`<th scope="col" key=${c.id}><abbr title=${c.label}>${c.short}</abbr></th>`,
        )}
      </tr>
    </thead>
    <tbody>
      ${rows.map(
        r =>
          html`<tr key=${r.profileId}>
            <th scope="row" class="run-squad__player">
              <span class="run-squad__role">${r.role}</span>
              <span class="truncate">${surname(r.name)}</span>
            </th>
            ${COLUMNS.map(
              c =>
                html`<td
                  key=${c.id}
                  class=${cx(
                    'num',
                    c.id === 'average' && 'run-squad__rating',
                    c.id === 'goals' && r.goals === most && 'is-top',
                    !r[c.id] && c.id !== 'average' && 'is-zero',
                  )}
                >
                  ${cell(r, c.id)}
                </td>`,
            )}
          </tr>`,
      )}
    </tbody>
  </table>`;
}
