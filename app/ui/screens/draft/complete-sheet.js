// Completion: your XI, team OVR and Links, then the next step by context — run/daily: on to
// the World Cup (RUN-UI); quick: the opponent reveal, then the pre-match; versus: both XIs,
// then the pre-match. Hidden ratings can be revealed here.
import { useMemo, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { teamStyle } from '../../lib/color.js';
import { isReducedMotion } from '../../lib/motion.js';
import { playCue } from '../../lib/audio.js';
import { outcomeProbabilities } from '../../../core/competition/model.js';
import { formationLabel } from '../../../core/players/formations.js';
import {
  Modal,
  Button,
  PitchView,
  Flag,
  Crest,
  Chip,
  Icon,
  Confetti,
} from '../../components/index.js';
import { quickOpponent, difficultyLabel } from '../../lib/draft-store.js';
import { linkLines } from './draft-model.js';

const fmt = v => (v == null ? '–' : Number(v).toFixed(1));
const pct = p => `${Math.round(p * 100)}%`;

const NEXT = {
  run: { label: 'On to the World Cup', icon: 'trophy' },
  daily: { label: 'Play the Daily', icon: 'calendar-days' },
  quick: { label: 'Meet your opponent', icon: 'swords' },
  versus: { label: 'To the pre-match', icon: 'arrow-right' },
};

function XiSummary({ team, players, hideRatings, small }) {
  return html`<div class=${cx('xi-summary', small && 'is-small')}>
    <div class="xi-summary__head" style=${teamStyle([team.color, team.secondary])}>
      <span class="xi-summary__kit" aria-hidden="true"></span>
      <span class="xi-summary__name">${team.name}</span>
      <span class="xi-summary__formation">${formationLabel(team.formation)}</span>
    </div>
    <div class="xi-summary__stats">
      <span
        ><small>OVR</small
        ><b class="num" data-testid="final-ovr">${hideRatings ? '?' : fmt(team.rating)}</b></span
      >
      <span
        ><small>Links</small
        ><b class="num">${team.links.score}<i>/${team.links.maxScore}</i></b></span
      >
      <span
        ><small>Linked</small><b class="num">${team.links.linked}<i>/11</i></b></span
      >
    </div>
    <${PitchView}
      formation=${team.formation}
      players=${players}
      links=${linkLines(team.links.pairs)}
      hideRatings=${hideRatings}
      label=${`${team.name} XI`}
      aspect=${small ? '4 / 4.6' : '4 / 4.4'}
      class="xi-summary__pitch"
    />
  </div>`;
}

function OpponentReveal({ opponent, mine, hideRatings }) {
  const p = outcomeProbabilities(mine, opponent.effective);
  return html`<div
    class="opp-reveal"
    style=${teamStyle([opponent.color || '#baaff0', opponent.secondary || '#16213a'])}
  >
    <p class="eyebrow is-gold">Your opponent</p>
    <div class="opp-reveal__crest">
      ${
        opponent.code
          ? html`<${Flag}
              code=${opponent.code}
              name=${opponent.name}
              src=${opponent.flag || undefined}
              size=${88}
              decorative
            />`
          : html`<${Crest}
              name=${opponent.name}
              colors=${[opponent.color, opponent.secondary]}
              size=${88}
              shape="shield"
              decorative
            />`
      }
    </div>
    <h3 class="opp-reveal__name" data-testid="opponent-name">${opponent.name}</h3>
    <p class="opp-reveal__meta">
      ${formationLabel(opponent.formation)}${hideRatings ? '' : ` · OVR ${fmt(opponent.rating)}`}
      ${opponent.kind === 'boss' && html` · <${Chip} tone="holo" size="sm">Boss<//>`}
    </p>
    ${
      !hideRatings &&
      html`<div
        class="opp-reveal__odds"
        role="img"
        aria-label=${`Win ${pct(p.win)}, draw ${pct(p.draw)}, loss ${pct(p.loss)}`}
      >
        <span class="opp-reveal__bar">
          <i class="is-win" style=${`flex:${p.win}`}></i
          ><i class="is-draw" style=${`flex:${p.draw}`}></i
          ><i class="is-loss" style=${`flex:${p.loss}`}></i>
        </span>
        <span class="opp-reveal__legend">
          <span>Win <b class="num">${pct(p.win)}</b></span>
          <span>Draw <b class="num">${pct(p.draw)}</b></span>
          <span>Loss <b class="num">${pct(p.loss)}</b></span>
        </span>
      </div>`
    }
    ${
      opponent.weakened > 0.05 &&
      html`<p class="opp-reveal__note">
        <${Icon} name="sparkles" size=${14} /> You drafted some of their players — they field the
        best of the rest.
      </p>`
    }
  </div>`;
}

/**
 * CompleteSheet props: open, onClose, snap, context, teamPlayers (views per side),
 * onContinue(async), busy.
 */
export function CompleteSheet({ open, onClose, snap, context, teamPlayers, onContinue, busy }) {
  const [step, setStep] = useState('xi');
  const [revealed, setRevealed] = useState(!context.options.hideRatings);
  const [burst, setBurst] = useState(0);
  const hide = !revealed;
  const kind = context.kind;
  const opponent = useMemo(() => (step === 'opponent' ? quickOpponent() : null), [step]);
  const mine = snap.teams[0];
  const next = NEXT[kind] || NEXT.quick;

  const go = () => {
    if (kind === 'quick' && step === 'xi') {
      setStep('opponent');
      playCue('reveal');
      if (!isReducedMotion()) setBurst(b => b + 1);
      return;
    }
    onContinue();
  };
  const title =
    step === 'opponent'
      ? 'Match day'
      : kind === 'versus'
        ? 'Both XIs are ready'
        : 'Your XI is ready';
  const mineEffective = (mine.rating || 0) + (mine.links.chem || 0);
  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    variant="sheet"
    size="lg"
    eyebrow=${kind === 'quick' ? `Quick Match · ${difficultyLabel(context.difficulty)}` : snap.modeLabel + ' draft'}
    title=${title}
    class="complete-sheet"
    footer=${html`
      ${
        context.options.hideRatings &&
        !revealed &&
        html`<${Button} variant="ghost" icon="eye" onClick=${() => setRevealed(true)}
          >Reveal ratings<//
        >`
      }
      <${Button}
        variant="primary"
        size="lg"
        iconEnd=${step === 'opponent' ? 'arrow-right' : next.icon}
        onClick=${go}
        loading=${busy}
        class="complete-sheet__cta"
        data-testid="draft-continue"
        >${step === 'opponent' ? 'To the pre-match' : next.label}<//
      >
    `}
  >
    ${
      step === 'opponent' && opponent
        ? html`<div class="complete-grid">
            <${XiSummary} team=${mine} players=${teamPlayers[0]} hideRatings=${hide} small />
            <${OpponentReveal} opponent=${opponent} mine=${mineEffective} hideRatings=${hide} />
          </div>`
        : html`<div class=${cx('complete-grid', snap.sides === 2 && 'is-versus')}>
            ${snap.teams.map(
              (t, i) =>
                html`<${XiSummary}
                  key=${i}
                  team=${t}
                  players=${teamPlayers[i]}
                  hideRatings=${hide}
                  small=${snap.sides === 2}
                />`,
            )}
          </div>`
    }
    <${Confetti} fire=${burst} />
  <//>`;
}
