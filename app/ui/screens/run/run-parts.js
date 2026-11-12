// Building blocks of the World Cup Run hub (also used by the Daily Challenge): team marks,
// the G1…F path, the next-fixture card, the group table, matchday results, the knockout
// path and the results ticker. Props are plain data from CupRun.snapshot().
import { html, cx } from '../../lib/html.js';
import { Flag } from '../../components/flag.js';
import { Crest } from '../../components/crest.js';
import { Icon } from '../../components/icon.js';
import { Chip } from '../../components/chip.js';
import { userTeamName, roundShort, roundLabel, THIRD_PLACE_RULE } from '../../lib/run-store.js';
import { sideColors } from '../../lib/kits.js';
import { Prize } from '../../components/cup.js';
import { Trophy } from './trophy.js';

// ---- teams ---------------------------------------------------------------------------------
/** { key, name, code, colors, user, kind, rating, pot } for a group key or a round's opponent. */
export function teamOf(snapshot, key) {
  if (key === 'user')
    return {
      key,
      name: userTeamName(snapshot.user?.name),
      user: true,
      rating: snapshot.user?.rating,
    };
  const o = snapshot.rounds.find(r => r.opponent?.key === key)?.opponent;
  return o ? opponentTeam(o) : { key, name: key, code: null, colors: null };
}
export const opponentTeam = o => ({
  key: o.key,
  name: o.name,
  code: o.code,
  colors: sideColors(o),
  kind: o.kind,
  rating: o.rating,
  effective: o.effective,
  pot: o.pot,
});

export function TeamMark({ team, size = 28, class: className }) {
  if (!team) return null;
  if (team.user)
    return html`<span
      class=${cx('user-mark', className)}
      style=${{ '--mark': `${size}px` }}
      aria-hidden="true"
      >XI</span
    >`;
  if (team.code)
    return html`<${Flag}
      code=${team.code}
      name=${team.name}
      size=${size}
      decorative
      class=${className}
    />`;
  return html`<${Crest} name=${team.name} colors=${team.colors} size=${size} decorative />`;
}

/** Overlapping flags of the XI's nations (most common first). */
export function FlagMosaic({ nations = [], size = 28, max = 6, class: className }) {
  const shown = nations.slice(0, max),
    more = nations.length - shown.length;
  return html`<span
    class=${cx('flag-mosaic', className)}
    style=${{ '--mark': `${size}px` }}
    role="img"
    aria-label=${`Nations: ${nations.map(n => n.name).join(', ')}`}
  >
    ${shown.map(
      n =>
        html`<span class="flag-mosaic__item" key=${n.code || n.name}
          ><${Flag} code=${n.code} name=${n.name} size=${size} decorative
        /></span>`,
    )}
    ${more > 0 && html`<span class="flag-mosaic__more num">+${more}</span>`}
  </span>`;
}

// ---- results -------------------------------------------------------------------------------
const OUTCOME_LABEL = { W: 'Won', D: 'Drew', L: 'Lost' };
export const scoreText = r =>
  r ? `${r.goalsFor}–${r.goalsAgainst}${r.shootout ? ' (p)' : r.extraTime ? ' (aet)' : ''}` : '';
/** W/D/L chip (a knockout draw won on penalties reads as a win "on pens"). */
/** Did the user get through this result: a win, or a knockout draw won on penalties. */
export const wonResult = result =>
  !!result && (result.outcome === 'W' || result.shootout?.winner === 'user');
export function OutcomeChip({ result, size = 'md' }) {
  if (!result) return null;
  const pens = result.shootout;
  const won = result.outcome === 'W' || pens?.winner === 'user';
  const tone =
    result.outcome === 'W' ? 'w' : result.outcome === 'L' ? 'l' : pens ? (won ? 'w' : 'l') : 'd';
  return html`<span
    class=${cx('outcome', `outcome--${tone}`, `outcome--${size}`)}
    title=${pens ? (won ? 'Won on penalties' : 'Lost on penalties') : OUTCOME_LABEL[result.outcome] + (result.extraTime ? ' after extra time' : '')}
    >${result.outcome}</span
  >`;
}

// ---- path G1 … F -----------------------------------------------------------------------------
export function PathStrip({ snapshot, class: className }) {
  const current = snapshot.complete ? -1 : snapshot.round;
  const lastPlayed = snapshot.rounds.filter(r => r.result).length - 1;
  return html`<ol class=${cx('run-path-strip', className)} role="list" aria-label="Your path">
    ${snapshot.rounds.map((r, i) => {
      const result = r.result;
      // The match that ended the title hopes: a lost knockout tie, or the last group match of
      // a group exit. (A lost semi-final still leads to the third-place play-off.)
      const out =
        result && r.knockout && !wonResult(result)
          ? 'is-out'
          : snapshot.status === 'eliminated' && i === lastPlayed && !r.knockout
            ? 'is-out'
            : snapshot.status === 'eliminated' && i > lastPlayed
              ? 'is-void'
              : null;
      const state = result ? 'is-played' : i === current ? 'is-current' : 'is-todo';
      const revealed = result || i <= Math.max(current, 2);
      return html`<li
        key=${r.id}
        class=${cx('path-node', state, out, i === 3 && 'is-ko-start', (r.id === 'final' || r.id === 'third') && 'is-final')}
        aria-label=${`${roundLabel(r)}${
          result
            ? `: ${OUTCOME_LABEL[result.outcome]} ${scoreText(result)} vs ${r.opponent.name}`
            : i === current
              ? `, next: ${r.opponent.name}`
              : ''
        }`}
      >
        <span class="path-node__label">${roundShort(r)}</span>
        <span class="path-node__disc">
          ${
            result
              ? html`<span class=${cx('path-node__res', `is-${result.outcome.toLowerCase()}`)}
                  >${result.outcome}</span
                >`
              : revealed && r.opponent
                ? html`<${TeamMark} team=${opponentTeam(r.opponent)} size=${30} />`
                : r.id === 'final' || r.id === 'third'
                  ? html`<${Icon} name=${r.id === 'final' ? 'trophy' : 'award'} size=${16} />`
                  : html`<span class="path-node__q" aria-hidden="true">?</span>`
          }
        </span>
        <span class="path-node__score num">${result ? scoreText(result) : ''}</span>
      </li>`;
    })}
  </ol>`;
}

// ---- odds & stakes ---------------------------------------------------------------------------
export function OddsBar({ odds }) {
  if (!odds) return null;
  return html`<div
    class="odds"
    aria-label=${`Win ${odds.win}%, draw ${odds.draw}%, loss ${odds.loss}%`}
  >
    <div class="odds__bar" aria-hidden="true">
      <span class="odds__w" style=${{ flexGrow: odds.win }}></span>
      <span class="odds__d" style=${{ flexGrow: odds.draw }}></span>
      <span class="odds__l" style=${{ flexGrow: odds.loss }}></span>
    </div>
    <div class="odds__legend" aria-hidden="true">
      <span><b class="num">${odds.win}%</b> win</span>
      <span><b class="num">${odds.draw}%</b> draw</span>
      <span><b class="num">${odds.loss}%</b> loss</span>
    </div>
  </div>`;
}

const STAKE_TEXT = { through: 'Through', out: 'Out', depends: 'Depends' };
const STAKE_TONE = { through: 'green', out: 'coral', depends: 'amber' };
const KNOCKOUT_STAKES = {
  final: 'One match from glory. A draw goes to penalties.',
  sf: 'Win and you are in the final. Lose and you play for third place.',
  third: 'Third place is at stake: the winner takes bronze. A draw goes to penalties.',
};
export function StakesRow({ stakes, knockout, round }) {
  if (stakes)
    return html`<ul class="stakes" role="list" aria-label="What this match means">
      ${['W', 'D', 'L'].map(
        o =>
          html`<li key=${o} class=${cx('stakes__item', `is-${stakes[o]}`)}>
            <span class="stakes__if">${o === 'W' ? 'Win' : o === 'D' ? 'Draw' : 'Lose'}</span>
            <${Chip} tone=${STAKE_TONE[stakes[o]]} size="sm">${STAKE_TEXT[stakes[o]]}<//>
          </li>`,
      )}
      ${
        Object.values(stakes).includes('depends') &&
        html`<li class="stakes__note">
          ${`Depends on ${stakes.other.home} v ${stakes.other.away} and goal difference.`}
        </li>`
      }
      ${stakes.third && html`<li class="stakes__note">${THIRD_PLACE_RULE}</li>`}
    </ul>`;
  if (knockout)
    return html`<p class="stakes stakes--ko">
      <${Icon} name="swords" size=${16} />
      <span
        >${
          KNOCKOUT_STAKES[round] || 'Knockout: lose and you are out. A draw goes to penalties.'
        }</span
      >
    </p>`;
  return null;
}

// ---- group table -------------------------------------------------------------------------------
const TIEBREAK = {
  goalDifference: 'on goal difference',
  goalsFor: 'on goals scored',
  headToHead: 'on head-to-head',
  lots: 'by drawing of lots',
};
/**
 * Group table. moves: { [key]: +n | −n } position change to show (after a result).
 * Rows marked as advancing: the top two and a third that goes through on the best-thirds rule
 * (row.qualifies, as the table stands).
 */
export function GroupTable({ snapshot, moves = {}, compact = false, label = 'Group A' }) {
  const started = snapshot.group.table.some(r => r.played);
  // Before a ball is kicked the table follows the draw (you, then pots 4, 3, 2).
  const rows = started
    ? snapshot.group.table
    : snapshot.group.teams.map(
        (t, i) =>
          snapshot.group.table.find(r => r.key === t.key) && {
            ...snapshot.group.table.find(r => r.key === t.key),
            position: i + 1,
            decidedBy: null,
          },
      );
  const done = rows.every(r => r.played === 3);
  const advancing = (r, i) => (started ? (r.qualifies ?? i < 2) : i < 2);
  return html`<table class=${cx('group-table', compact && 'is-compact')}>
    <caption class="visually-hidden">
      ${label} standings
    </caption>
    <thead>
      <tr>
        <th scope="col" class="gt-pos"><span class="visually-hidden">Position</span>#</th>
        <th scope="col" class="gt-team">Team</th>
        <th scope="col" title="Played">P</th>
        ${!compact && html`<th scope="col" title="Won">W</th>`}
        ${!compact && html`<th scope="col" title="Drawn">D</th>`}
        ${!compact && html`<th scope="col" title="Lost">L</th>`}
        <th scope="col" title="Goal difference">GD</th>
        <th scope="col" class="gt-pts" title="Points">Pts</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r, i) => {
        const team = teamOf(snapshot, r.key);
        const move = moves[r.key] || 0;
        const tie = !!(i < rows.length - 1 && r.decidedBy && r.decidedBy !== 'points' && r.played);
        return html`<tr
          key=${r.key}
          class=${cx(
            'gt-row',
            advancing(r, i) && 'is-qualifying',
            done && advancing(r, i) && 'is-through',
            r.user && 'is-user',
            move > 0 && 'is-up',
            move < 0 && 'is-down',
          )}
        >
          <td class="gt-pos num">${r.position}</td>
          <th scope="row" class="gt-team">
            <span class="gt-team__inner">
              <${TeamMark} team=${team} size=${22} />
              <span class="gt-team__name truncate">${team.name}</span>
              ${
                move !== 0 &&
                html`<span class=${cx('gt-move', move > 0 ? 'is-up' : 'is-down')}
                  ><${Icon} name=${move > 0 ? 'chevron-up' : 'chevron-down'} size=${14} /><span
                    class="visually-hidden"
                    >${move > 0 ? 'up' : 'down'}</span
                  ></span
                >`
              }
              ${
                tie &&
                html`<span class="gt-tie" title=${`Ahead ${TIEBREAK[r.decidedBy]}`}
                  ><${Icon} name="info" size=${12} /><span class="visually-hidden"
                    >${`Ahead ${TIEBREAK[r.decidedBy]}`}</span
                  ></span
                >`
              }
            </span>
          </th>
          <td class="num">${r.played}</td>
          ${!compact && html`<td class="num">${r.won}</td>`}
          ${!compact && html`<td class="num">${r.drawn}</td>`}
          ${!compact && html`<td class="num">${r.lost}</td>`}
          <td class="num">${r.gd > 0 ? `+${r.gd}` : r.gd}</td>
          <td class="gt-pts num">${r.points}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

// ---- matchday results ----------------------------------------------------------------------------
/** Fixtures by matchday. */
export function MatchdayList({ snapshot }) {
  const byMd = [1, 2, 3].map(md => snapshot.group.fixtures.filter(f => f.md === md));
  return html`<div class="matchdays">
    ${byMd.map(
      (fixtures, i) =>
        html`<section class="matchday" key=${i} aria-label=${`Matchday ${i + 1}`}>
          <h3 class="matchday__title">Matchday ${i + 1}</h3>
          <ul class="matchday__list" role="list">
            ${fixtures.map(f => {
              const key = `${f.md}:${f.home}:${f.away}`;
              const score = f.score;
              const home = teamOf(snapshot, f.home),
                away = teamOf(snapshot, f.away);
              return html`<li
                key=${key}
                class=${cx(
                  'fixture-row',
                  (home.user || away.user) && 'is-user',
                  f.score && 'is-final',
                )}
              >
                <span class="fixture-row__team is-home">
                  <span class="truncate">${home.name}</span>
                  <${TeamMark} team=${home} size=${20} />
                </span>
                <span class="fixture-row__score num"
                  >${score ? `${score[0]}–${score[1]}` : 'v'}</span
                >
                <span class="fixture-row__team is-away">
                  <${TeamMark} team=${away} size=${20} />
                  <span class="truncate">${away.name}</span>
                </span>
              </li>`;
            })}
          </ul>
        </section>`,
    )}
  </div>`;
}

// ---- knockout path -------------------------------------------------------------------------------
export function KnockoutPath({ snapshot }) {
  const current = snapshot.complete ? -1 : snapshot.round;
  const champion = snapshot.status === 'champion';
  // The last node is what the run won: the cup, a medal, or the trophy still to play for.
  const medal = snapshot.medal && snapshot.medal !== 'gold' ? snapshot.medal : null;
  return html`<ol class="ko-path" role="list" aria-label="Knockout rounds">
    ${snapshot.rounds.slice(3).map((r, k) => {
      const i = k + 3,
        result = r.result;
      const revealed = !!result || i === current;
      const state = result
        ? result.outcome === 'W' || result.shootout?.winner === 'user'
          ? 'is-won'
          : 'is-lost'
        : i === current
          ? 'is-current'
          : snapshot.status === 'eliminated'
            ? 'is-void'
            : 'is-todo';
      return html`<li key=${r.id} class=${cx('ko-node', state)}>
        <span class="ko-node__stage">${roundLabel(r)}</span>
        ${
          revealed
            ? html`<span class="ko-node__tie">
                <${TeamMark} team=${{ user: true }} size=${24} />
                <span class="ko-node__score num">${result ? scoreText(result) : 'v'}</span>
                <${TeamMark} team=${opponentTeam(r.opponent)} size=${24} />
                <span class="ko-node__name truncate">${r.opponent.name}</span>
              </span>`
            : html`<span class="ko-node__tbd">${state === 'is-void' ? '—' : 'To be decided'}</span>`
        }
        ${
          result?.shootout &&
          html`<span class="ko-node__pens"
            >${`${result.shootout.winner === 'user' ? 'Won' : 'Lost'} on penalties${
              result.shootout.score
                ? ` ${result.shootout.score[0]}–${result.shootout.score[1]}`
                : ''
            }`}</span
          >`
        }
      </li>`;
    })}
    <li class=${cx('ko-node', 'ko-node--cup', (champion || medal) && 'is-won')}>
      ${
        medal
          ? html`<${Prize} medal=${medal} size=${44} />`
          : html`<${Trophy} size=${44} glow=${champion} />`
      }
      <span class="ko-node__stage"
        >${champion ? 'Champions' : medal ? snapshot.placeLabel : 'The trophy'}</span
      >
    </li>
  </ol>`;
}

// ---- results ticker (Sim rest of run / Daily) ----------------------------------------------------
/**
 * items: [{ round, short?: 'SF' (the round's short label once known: the eighth match is the
 *           final or the play-off), opponent (snapshot opponent), status: 'queued' | 'live' | 'done',
 *           live?: { minute, score, shootout }, result?: snapshot round result,
 *           elsewhere?: { home, away, score } (the other group match), scorers?: string }]
 */
export function ResultsTicker({ items, snapshot }) {
  return html`<ol class="ticker" role="list">
    ${items.map(it => {
      // Knockout opponents stay hidden until their tie kicks off.
      const hidden = it.status === 'queued' && it.round >= 3;
      const team = hidden
        ? { key: '?', name: 'To be decided', code: null, colors: ['#223050', '#8592ad'] }
        : opponentTeam(it.opponent);
      const res = it.result;
      const score = res ? scoreText(res) : it.live ? `${it.live.score[0]}–${it.live.score[1]}` : '';
      return html`<li
        key=${it.round}
        class=${cx('ticker__item', `is-${it.status}`, res && `is-${res.outcome.toLowerCase()}`)}
      >
        <span class="ticker__stage">${it.short ?? roundShort(it.round)}</span>
        <span class="ticker__match">
          <span class="ticker__vs">
            ${
              hidden
                ? html`<span class="ticker__q" aria-hidden="true">?</span>`
                : html`<${TeamMark} team=${team} size=${26} />`
            }
            <span class="ticker__name truncate">${team.name}</span>
          </span>
          ${it.scorers && html`<span class="ticker__scorers truncate">${it.scorers}</span>`}
          ${
            it.elsewhere &&
            html`<span class="ticker__elsewhere truncate"
              >${`Elsewhere: ${teamOf(snapshot, it.elsewhere.home).name} ${it.elsewhere.score[0]}–${it.elsewhere.score[1]} ${teamOf(snapshot, it.elsewhere.away).name}`}</span
            >`
          }
        </span>
        <span class="ticker__clock num"
          >${it.status === 'live' ? it.live?.minute || "0'" : it.status === 'queued' ? '' : 'FT'}</span
        >
        <span class=${cx('ticker__score num', score && 'is-pop')} key=${`${it.round}:${score}`}
          >${score}</span
        >
        ${res ? html`<${OutcomeChip} result=${res} size="sm" />` : html`<span class="outcome outcome--sm outcome--q" aria-hidden="true"></span>`}
      </li>`;
    })}
  </ol>`;
}
