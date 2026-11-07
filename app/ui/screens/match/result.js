// Full-time report: final score (+ penalties), scorers timeline, MOTM, "Held you back",
// analysis chips, team stats, ratings, the share line and Continue / Rematch / Home.
import { useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { teamStyle } from '../../lib/color.js';
import { Button, Chip, Icon, ScoreBug, Card, IconButton, toast } from '../../components/index.js';
import {
  MomentumChart,
  StatsTable,
  TeamMark,
  ShootoutPanel,
  teamColors,
  storyTag,
  useMedia,
} from './hud.js';
import { makeKits } from './renderer/kits.js';

const REMATCH_CONTEXTS = ['quick', 'versus', 'exhibition', 'demo'];

function headline(r) {
  const [a, b] = r.teams;
  if (r.abandoned != null) return `${r.teams[r.abandoned].name} abandoned`;
  if (r.shootout) return `${r.teams[r.shootout.winner].name} win on penalties`;
  if (r.winner == null) return 'Honours even';
  const w = r.winner === 0 ? a : b,
    margin = Math.abs(r.score[0] - r.score[1]);
  return margin >= 3 ? `${w.name} run riot` : `${w.name} win`;
}

function verdict(r) {
  const us = r.userSides?.[0];
  if (us == null || r.userSides.length > 1) return null;
  if (r.winner === us)
    return { tone: 'win', text: r.shootout ? 'Through on penalties' : 'Victory' };
  if (r.winner == null) return { tone: 'draw', text: 'Draw' };
  return { tone: 'loss', text: r.shootout ? 'Out on penalties' : 'Defeat' };
}

function Scorers({ r }) {
  if (!r.goals.length) return html`<p class="res-scorers__none">No goals — a goalless draw.</p>`;
  return html`<div class="res-scorers">
    ${[0, 1].map(
      t =>
        html`<ul key=${t} class=${cx('res-scorers__col', t && 'is-away')}>
          ${r.goals
            .filter(g => g.team === t)
            .map(
              g =>
                html`<li key=${g.id}>
                  <${Icon} name="ball" size=${14} />
                  <span class="truncate"
                    >${g.player || 'Own goal'}${g.ownGoal ? ' (og)' : ''}${g.penalty ? ' (pen)' : ''}</span
                  >
                  <span class="num res-scorers__min">${g.minute}</span>
                </li>`,
            )}
        </ul>`,
    )}
  </div>`;
}

function Timeline({ r }) {
  const end = Math.max(5400, ...r.events.map(e => e.time || 0));
  const items = r.events.filter(
    e => ['goal', 'red', 'post'].includes(e.type) || (e.type === 'save' && e.difficulty >= 0.7),
  );
  if (!items.length) return null;
  return html`<div class="res-timeline" aria-hidden="true">
    <span class="res-timeline__line"></span>
    <span class="res-timeline__ht" style=${{ left: `${(2700 / end) * 100}%` }}>HT</span>
    ${items.map(
      e =>
        html`<span
          key=${e.id}
          class=${cx('res-timeline__dot', `is-${e.type}`, e.team === 1 ? 'is-away' : 'is-home')}
          style=${{ left: `${Math.min(100, ((e.time || 0) / end) * 100)}%`, ...teamStyle(teamColors(r.teams[e.team] || {})) }}
          title=${`${e.minute} ${e.text}`}
        ></span>`,
    )}
  </div>`;
}

function PlayerSpot({ p, r, kind }) {
  const team = r.teams[p.team];
  const gold = kind === 'motm';
  return html`<${Card}
    variant=${gold ? 'gold' : 'outline'}
    class=${cx('res-spot', `res-spot--${kind}`)}
    style=${teamStyle(teamColors(team))}
  >
    <span class="eyebrow ${gold ? 'is-gold' : ''}"
      >${gold ? 'Player of the match' : 'Held you back'}</span
    >
    <div class="res-spot__body">
      <span class="res-spot__number num" aria-hidden="true">${p.number}</span>
      <div class="res-spot__who">
        <strong class="res-spot__name">${p.name}</strong>
        <span class="res-spot__meta"
          ><${TeamMark} team=${team} size=${16} /> ${team.short} · ${p.role}</span
        >
        <span class="res-spot__line">${kind === 'motm' ? p.line : p.reason}</span>
      </div>
      <span
        class=${cx('res-spot__rating num', p.rating >= 7.5 ? 'is-high' : p.rating < 6 ? 'is-low' : '')}
        aria-label=${`Rating ${p.rating.toFixed(1)}`}
        >${p.rating.toFixed(1)}</span
      >
    </div>
  <//>`;
}

function Ratings({ r }) {
  return html`<div class="res-ratings">
    ${[0, 1].map(
      t =>
        html`<div key=${t} class="res-ratings__team" style=${teamStyle(teamColors(r.teams[t]))}>
          <h3 class="res-ratings__title">
            <${TeamMark} team=${r.teams[t]} size=${18} /> ${r.teams[t].name}
          </h3>
          <ol>
            ${r.players
              .filter(p => p.team === t)
              .sort((a, b) => b.rating - a.rating)
              .map(
                p =>
                  html`<li
                    key=${p.id}
                    class=${cx('res-ratings__row', p.id === r.motm.id && 'is-motm')}
                  >
                    <span class="num res-ratings__no">${p.number}</span>
                    <span class="truncate">${p.name}</span>
                    <span class="res-ratings__icons">
                      ${
                        p.goals > 2
                          ? html`<${Icon} name="ball" size=${12} title="Goals" /><span class="num"
                                >×${p.goals}</span
                              >`
                          : Array.from(
                              { length: p.goals },
                              (_, i) =>
                                html`<${Icon}
                                  key=${`g${i}`}
                                  name="ball"
                                  size=${12}
                                  title="Goal"
                                />`,
                            )
                      }
                      ${p.yellowCards ? html`<span class="mcard" title="Booked"></span>` : null}
                      ${p.sentOff ? html`<span class="mcard is-red" title="Sent off"></span>` : null}
                    </span>
                    <span
                      class=${cx('num res-ratings__r', p.rating >= 7.5 ? 'is-high' : p.rating < 6 ? 'is-low' : '')}
                      >${p.rating.toFixed(1)}</span
                    >
                  </li>`,
              )}
          </ol>
        </div>`,
    )}
  </div>`;
}

export function ResultView({ result: r, momentum, onContinue, onRematch, onHome }) {
  const [copied, setCopied] = useState(false);
  const small = useMedia('(max-width: 559px)');
  const kits = makeKits(r.teams);
  const v = verdict(r);
  const single = REMATCH_CONTEXTS.includes(r.context);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.share);
      setCopied(true);
      toast({ title: 'Copied', message: 'Result copied to the clipboard.', tone: 'positive' });
    } catch {
      toast({ title: 'Could not copy', message: r.share, tone: 'negative' });
    }
  };
  const bug = t => ({
    name: r.teams[t].name,
    short: r.teams[t].short,
    code: r.teams[t].flagCode || undefined,
    colors: teamColors(r.teams[t]),
    score: r.score[t],
  });
  return html`<div
    class="result"
    data-testid="match-result"
    style=${{ '--home': kits[0].primary, '--away': kits[1].primary }}
  >
    <header class="match-top">
      <${IconButton} icon="house" label="Home" onClick=${onHome} />
      <p class="match-top__title eyebrow">${r.title || 'Full time'}</p>
      <span class="match-top__spacer"></span>
    </header>
    <section class="res-hero" aria-labelledby="res-title">
      <p class=${cx('res-hero__ft eyebrow', v && `is-${v.tone}`)}>
        ${v ? `Full time · ${v.text}` : 'Full time'}
      </p>
      <h1 id="res-title" class="res-hero__title">${headline(r)}</h1>
      <${ScoreBug}
        size=${small ? 'md' : 'lg'}
        home=${bug(0)}
        away=${bug(1)}
        period=${r.shootout ? 'PENS' : r.extraTime ? 'AET' : 'FT'}
        pens=${r.shootout ? r.shootout.score : null}
      />
      <${Scorers} r=${r} />
      ${
        r.shootout &&
        html`<${ShootoutPanel}
          fixed
          teams=${r.teams}
          shootout=${{
            ...r.shootout,
            suddenDeath: r.shootout.kicks.length > 10,
            kicking: null,
          }}
        />`
      }
      <${Timeline} r=${r} />
      ${
        r.analysis?.length > 0 &&
        html`<ul class="res-chips" aria-label="Analysis">
          ${r.analysis.map(
            c =>
              html`<li key=${c.id}>
                <${Chip}
                  tone=${c.tone === 'positive' ? 'green' : c.tone === 'negative' ? 'coral' : 'sky'}
                  icon=${c.tone === 'positive' ? 'trending-up' : c.tone === 'negative' ? 'trending-down' : 'activity'}
                  ><strong>${c.label}</strong> <span class="res-chip__detail">${c.detail}</span><//
                >
              </li>`,
          )}
        </ul>`
      }
    </section>
    <div class="res-grid">
      <div class="res-col">
        <div class="res-spots">
          <${PlayerSpot} p=${r.motm} r=${r} kind="motm" />
          ${r.heldYouBack && html`<${PlayerSpot} p=${r.heldYouBack} r=${r} kind="held" />`}
        </div>
        ${
          momentum?.length > 0 &&
          html`<${Card} class="res-card"
            ><${MomentumChart}
              samples=${momentum}
              teams=${r.teams}
              label="Match momentum"
              final
              height=${64}
          /><//>`
        }
        ${
          single &&
          html`<${Card} class="res-card res-share">
            <span class="eyebrow">Share</span>
            <p class="res-share__text">${r.share}</p>
            <${Button}
              size="sm"
              variant="secondary"
              icon=${copied ? 'check' : 'copy'}
              onClick=${copy}
              >${copied ? 'Copied' : 'Copy result'}<//
            >
          <//>`
        }
      </div>
      <div class="res-col">
        <${Card} class="res-card">
          <h2 class="res-card__h">Match stats</h2>
          <${StatsTable} stats=${r.stats} teams=${r.teams} />
        <//>
        <${Card} class="res-card">
          <h2 class="res-card__h">Player ratings</h2>
          <${Ratings} r=${r} />
        <//>
      </div>
    </div>
    <div class="res-actions action-bar">
      <${Button} variant="ghost" icon="house" onClick=${onHome}>Home<//>
      ${single && html`<${Button} variant="secondary" icon="repeat" onClick=${onRematch} data-testid="rematch">Rematch<//>`}
      <${Button}
        variant="primary"
        size="lg"
        iconEnd="arrow-right"
        onClick=${onContinue}
        data-testid="continue"
        >Continue<//
      >
    </div>
  </div>`;
}

export { storyTag };
