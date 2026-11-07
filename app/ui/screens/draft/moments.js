// Draft moments: the foil flourish when a Star/Superstar is drafted (non-blocking overlay,
// skipped with reduced motion) and the Versus pass-the-device interstitial.
import { useEffect, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { teamStyle } from '../../lib/color.js';
import { PlayerCard, Modal, Button, Confetti } from '../../components/index.js';

/** Star/Superstar pick: the card flies in with a foil sweep, then fades (1.6 s). */
export function PickMoment({ moment, view }) {
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!moment) return;
    setShown(moment);
    const t = setTimeout(() => setShown(null), 1700);
    return () => clearTimeout(t);
  }, [moment?.token]);
  const superstar = shown?.tier === 'Superstar';
  return html`${
      shown &&
      view &&
      html`<div class=${cx('pick-moment', superstar && 'is-superstar')} aria-hidden="true">
        <div class="pick-moment__card">
          <${PlayerCard} player=${view} size="l" showBadges=${false} />
          <span class="pick-moment__sheen"></span>
        </div>
        <p class="pick-moment__label">${superstar ? 'Superstar signed' : 'Star signed'}</p>
      </div>`
    } <${Confetti} fire=${superstar ? shown.token : 0} origin=${{ x: 0.5, y: 0.4 }} />`;
}

/** Versus: hand the device over before the next spin (and the coin toss at the start). */
export function PassDevice({ open, team, first, pickIndex, totalPicks, onSpin, onView }) {
  if (!team) return null;
  return html`<${Modal}
    open=${open}
    onClose=${onView}
    size="sm"
    eyebrow=${first ? 'Coin toss' : `Pick ${pickIndex + 1} of ${totalPicks}`}
    title=${first ? `${team.name} drafts first` : `${team.name}'s turn`}
    description=${first ? 'Then you take turns: one spin, one pick each.' : `Pass the device to ${team.name}.`}
    class="pass-device"
    footer=${html`
      <${Button} variant="ghost" onClick=${onView}>See the board<//>
      <${Button} variant="primary" icon="reel" onClick=${onSpin} data-testid="pass-spin">Spin<//>
    `}
  >
    <div
      class="pass-device__kit"
      style=${teamStyle([team.color, team.secondary])}
      aria-hidden="true"
    >
      <span>${team.name.slice(0, 1).toUpperCase()}</span>
    </div>
  <//>`;
}
