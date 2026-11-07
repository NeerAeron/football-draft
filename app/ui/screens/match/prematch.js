// Pre-kickoff: the match-up (crests/flags, formations, OVR by line), line-ups, the view choice
// (Key Moments / Full / Instant), mentality + tactics for user sides, and Kick off.
import { useMemo } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { useStore, shallowEqual } from '../../lib/store.js';
import { teamStyle } from '../../lib/color.js';
import { Button, Segmented, IconButton } from '../../components/index.js';
import { formationLabel } from '../../../core/players/formations.js';
import { overallRating, teamRatings } from '../../../core/players/ratings.js';
import { commonName } from '../../../core/players/player-labels.js';
import { TeamMark, teamColors } from './hud.js';
import { MentalityControl } from './tactics.js';

export const VIEW_OPTIONS = [
  { value: 'key', label: 'Key Moments', hint: '~1 min · highlights', icon: 'sparkles' },
  { value: 'full', label: 'Full match', hint: '3 min · live coaching', icon: 'play' },
  { value: 'instant', label: 'Instant', hint: 'straight to the result', icon: 'zap' },
];
const LINE_ORDER = ['GK', 'RB', 'CB', 'LB', 'DM', 'RM', 'CM', 'LM', 'AM', 'RW', 'ST', 'LW'];

function sideSummary(match, t) {
  const players = match.players.filter(p => p.team === t);
  const ovr = players.reduce((s, p) => s + overallRating(p, false), 0) / players.length;
  return { ovr: Math.round(ovr), lines: teamRatings(match.players, t), players };
}

function SideCard({ team, side, summary, formation, hideRatings, align }) {
  return html`<div class=${cx('mu-side', `mu-side--${align}`)} style=${teamStyle(teamColors(team))}>
    <div class="mu-side__mark"><${TeamMark} team=${team} size=${64} /></div>
    <div class="mu-side__text">
      <span class="mu-side__kind eyebrow"
        >${side.kind === 'user' ? 'You' : side.kind === 'p2' ? 'Player 2' : 'Opponent'}</span
      >
      <h2 class="mu-side__name">${team.name}</h2>
      <span class="mu-side__formation">${formationLabel(formation)}</span>
    </div>
    ${
      !hideRatings &&
      html`<div class="mu-side__ratings">
        <span class="mu-side__ovr num" aria-label=${`Team rating ${summary.ovr}`}
          >${summary.ovr}</span
        >
        <span class="mu-side__lines">
          ${['att', 'mid', 'def'].map(
            k =>
              html`<span key=${k}
                ><b>${k.toUpperCase()}</b> <span class="num">${summary.lines[k] ?? '–'}</span></span
              >`,
          )}
        </span>
      </div>`
    }
  </div>`;
}

function Lineup({ team, players }) {
  const sorted = [...players].sort(
    (a, b) => LINE_ORDER.indexOf(a.role) - LINE_ORDER.indexOf(b.role) || a.slot - b.slot,
  );
  return html`<div class="lineup" style=${teamStyle(teamColors(team))}>
    <h3 class="lineup__title">
      <span class="lineup__swatch" aria-hidden="true"></span>${team.name}
    </h3>
    <ol class="lineup__list">
      ${sorted.map(
        p =>
          html`<li key=${p.id} class="lineup__row">
            <span class="lineup__num num">${p.number}</span>
            <span class="lineup__name truncate">${commonName(p) || p.name}</span>
            <span class="lineup__role">${p.role}</span>
          </li>`,
      )}
    </ol>
  </div>`;
}

export function PreMatch({ controller, onExit, onTactics }) {
  const request = controller.request;
  const meta = request.meta;
  const { view, tactics, access } = useStore(
    controller.hud,
    s => ({ view: s.view, tactics: s.tactics, access: s.access }),
    shallowEqual,
  );
  const preview = controller.preview;
  const teams = meta.sides.map((s, i) => ({ ...s, name: s.name || preview.teams[i].name }));
  const summaries = useMemo(() => [0, 1].map(t => sideSummary(preview, t)), [preview]);
  const users = meta.userSides;
  return html`<div class="prematch">
    <header class="match-top">
      <${IconButton} icon="arrow-left" label="Leave match" onClick=${onExit} />
      <p class="match-top__title eyebrow">${meta.title || 'Match day'}</p>
      <span class="match-top__spacer"></span>
    </header>
    <section class="matchup" aria-labelledby="matchup-title">
      <h1 id="matchup-title" class="visually-hidden">${teams[0].name} vs ${teams[1].name}</h1>
      <${SideCard}
        team=${teams[0]}
        side=${meta.sides[0]}
        summary=${summaries[0]}
        formation=${tactics[0].formation}
        hideRatings=${meta.hideRatings}
        align="home"
      />
      <span class="matchup__vs" aria-hidden="true">VS</span>
      <${SideCard}
        team=${teams[1]}
        side=${meta.sides[1]}
        summary=${summaries[1]}
        formation=${tactics[1].formation}
        hideRatings=${meta.hideRatings}
        align="away"
      />
    </section>
    <div class="prematch__grid">
      <section class="prematch__setup" aria-label="Match options">
        <div class="prematch__block">
          <h2 class="prematch__h">How do you want to watch?</h2>
          <${Segmented}
            class="prematch__views"
            label="Match view"
            options=${VIEW_OPTIONS}
            value=${view}
            onChange=${v => controller.setView(v)}
            size="lg"
            block
          />
        </div>
        ${users.map(
          t =>
            html`<div class="prematch__block" key=${t}>
              <div class="prematch__row">
                <h2 class="prematch__h">
                  ${users.length > 1 ? `${teams[t].name} mentality` : 'Mentality'}
                </h2>
                <${Button}
                  size="sm"
                  variant="ghost"
                  icon="sliders-horizontal"
                  onClick=${() => onTactics(t)}
                  >Tactics<//
                >
              </div>
              <${MentalityControl}
                team=${t}
                name=${teams[t].name}
                value=${tactics[t].mentality}
                onChange=${(team, v) => controller.setTactic(team, 'mentality', v)}
                disabled=${!access[t]?.mentality}
                size="md"
                block
              />
            </div>`,
        )}
        <${Button}
          variant="primary"
          size="xl"
          block
          icon="whistle"
          data-testid="kickoff"
          onClick=${() => controller.kickoff()}
          >Kick off<//
        >
      </section>
      <section class="prematch__lineups" aria-label="Line-ups">
        ${[0, 1].map(t => html`<${Lineup} key=${t} team=${teams[t]} players=${summaries[t].players} />`)}
      </section>
    </div>
  </div>`;
}
