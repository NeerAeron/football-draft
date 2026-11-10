/**
 * GradeBadge — run/match grade plaque, S+ … F, with an optional verdict.
 *   grade    'S+' | 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'F'
 *   size     'sm' (32) | 'md' (56) | 'lg' (88) | 'xl' (128)                default 'md'
 *   verdict  named verdict next to it ('Knockout heartbreak');  detail  small line ('964 pts')
 * Colour family by letter: S holo, A gold, B volt, C sky, D amber, F coral.
 */
import { html, cx } from '../lib/html.js';

export const GRADES = [
  'S+',
  'S',
  'A+',
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D+',
  'D',
  'F',
];

export const gradeFamily = grade => String(grade || 'F')[0].toLowerCase();

export function GradeBadge({ grade = 'B', size = 'md', verdict, detail, class: className }) {
  const family = gradeFamily(grade);
  const letter = String(grade)[0];
  const mod = String(grade).slice(1).replace('-', '−');
  const label = `Grade ${grade}${verdict ? `: ${verdict}` : ''}${detail ? `, ${detail}` : ''}`;
  return html`<div
    class=${cx('grade', `grade--${size}`, `grade--${family}`, className)}
    role="img"
    aria-label=${label}
  >
    <span class="grade__plaque" aria-hidden="true">
      <span class="grade__letter">${letter}<span class="grade__mod">${mod}</span></span>
    </span>
    ${
      (verdict || detail) &&
      html`<span class="grade__text" aria-hidden="true">
        ${verdict && html`<span class="grade__verdict">${verdict}</span>`}
        ${detail && html`<span class="grade__detail">${detail}</span>`}
      </span>`
    }
  </div>`;
}
