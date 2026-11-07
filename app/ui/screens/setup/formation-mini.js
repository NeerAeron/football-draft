// FormationMini — a tiny portrait pitch with one dot per slot (formation picker cards).
import { useMemo } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { FORMATIONS } from '../../../core/players/formations.js';
import { layoutSlots } from '../../components/pitch-view.js';

const LINE = { GK: 'gk', CB: 'def', LB: 'def', RB: 'def' };
const ATT = new Set(['LW', 'RW', 'ST']);

export function FormationMini({ formation, class: className }) {
  const slots = useMemo(() => layoutSlots(FORMATIONS[formation] || FORMATIONS['433']), [formation]);
  return html`<svg
    class=${cx('formation-mini', className)}
    viewBox="0 0 100 125"
    aria-hidden="true"
    focusable="false"
  >
    <rect class="formation-mini__pitch" x="1" y="1" width="98" height="123" rx="8" />
    <path class="formation-mini__lines" d="M1 62.5h98M30 1v14h40V1M30 124v-14h40v14" />
    <circle class="formation-mini__lines" cx="50" cy="62.5" r="10" />
    ${slots.map(
      s =>
        html`<circle
          key=${s.index}
          class=${`formation-mini__dot is-${LINE[s.role] || (ATT.has(s.role) ? 'att' : 'mid')}`}
          cx=${s.left}
          cy=${(s.top / 100) * 125}
          r="6.5"
        />`,
    )}
  </svg>`;
}
