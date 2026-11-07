// Team-colour helpers. Catalog clubs carry primary/secondary hex colours; national
// teams get theirs from the nations table. Components receive `colors: [primary, secondary]`
// and call teamStyle() to get CSS custom properties:
//   --team      primary, lifted if it would vanish on the navy background
//   --team-2    secondary (or a readable fallback)
//   --team-ink  text colour with ≥ 4.5:1 contrast on --team
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(hex) {
  const m = HEX.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

const toHex = rgb =>
  '#' +
  rgb
    .map(v =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

const channel = c => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Mix two hex colours (t = share of b). */
export function mix(a, b, t) {
  const x = parseHex(a),
    y = parseHex(b);
  if (!x || !y) return a;
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

const INK = '#0a0f1c';
const WHITE = '#ffffff';
const NIGHT = '#0d1424';

/** Dark ink or white, whichever reads better on the colour. */
export function readableOn(hex) {
  return contrastRatio(hex, INK) >= contrastRatio(hex, WHITE) ? INK : WHITE;
}

/** Lighten colours that would disappear on the navy UI (e.g. black or navy kits). */
export function visibleOnNight(hex, min = 1.8) {
  if (!parseHex(hex)) return null;
  let out = hex;
  for (let i = 0; i < 6 && contrastRatio(out, NIGHT) < min; i++) out = mix(out, WHITE, 0.18);
  return out;
}

/** CSS custom properties for a team's colours. */
export function teamStyle(colors = []) {
  const [primary, secondary] = colors;
  const team = visibleOnNight(primary) || '#2e3e63';
  const second = parseHex(secondary) ? secondary : readableOn(team);
  return { '--team': team, '--team-2': second, '--team-ink': readableOn(team) };
}
