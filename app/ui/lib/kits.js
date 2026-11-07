// Team kits for presentation. Catalog clubs carry primary/secondary colours; national teams
// have none in the catalog, so their home kit [primary, secondary] comes from this table by
// flag code (score bugs, crests, pre-match, opponent reveals, the engine's shirt colours).
// Unknown codes get a stable colour from the code — never the generic lavender default.
// Framework-free: Node tests and every store import it.
//
//   nationKit('br')                              // ['#f9d616', '#1d4f9c']
//   sideColors({ color: '#C8102E', secondary })  // club colours win
//   sideColors({ code: 'fr' })                   // nation kit
//   kitColors(side, fallback)                    // any side shape: colors | color | code | flagCode

// prettier-ignore
export const NATION_KITS = {
  fr: ['#1b2a5c', '#ffffff'], br: ['#f9d616', '#1d4f9c'], es: ['#c60b1e', '#f1bf00'],
  'gb-eng': ['#ffffff', '#1b2a5c'], pt: ['#a6192e', '#006a44'], de: ['#ffffff', '#111111'],
  it: ['#1d5bb8', '#ffffff'], ar: ['#75aadb', '#ffffff'], nl: ['#f36c21', '#1b2a5c'],
  be: ['#c8102e', '#111111'], uy: ['#6cace4', '#111111'], hr: ['#e3001b', '#ffffff'],
  ch: ['#d52b1e', '#ffffff'], ma: ['#c1272d', '#006233'], tr: ['#e30a17', '#ffffff'],
  se: ['#fecc02', '#006aa7'], rs: ['#c6363c', '#0c4076'], co: ['#fcd116', '#003893'],
  dk: ['#c8102e', '#ffffff'], no: ['#ba0c2f', '#00205b'], sn: ['#ffffff', '#00853f'],
  ng: ['#008751', '#ffffff'], us: ['#ffffff', '#0a3161'], jp: ['#1b2a7a', '#ffffff'],
  ci: ['#f77f00', '#009e60'], pl: ['#ffffff', '#dc143c'], at: ['#ed2939', '#ffffff'],
  gr: ['#0d5eaf', '#ffffff'], 'gb-sct': ['#1b2a5c', '#ffffff'], ua: ['#ffd500', '#005bbb'],
  sk: ['#ffffff', '#0b4ea2'], mx: ['#006847', '#ffffff'], cz: ['#d7141a', '#11457e'],
  gh: ['#ffffff', '#111111'], cm: ['#007a5e', '#ce1126'], hu: ['#ce2939', '#ffffff'],
  ec: ['#ffdd00', '#034ea2'], ca: ['#d52b1e', '#ffffff'], kr: ['#c60c30', '#003478'],
  ba: ['#002395', '#fecb00'], si: ['#ffffff', '#005da4'], ge: ['#ffffff', '#da291c'],
  cd: ['#007fff', '#ce1021'], ml: ['#14b53a', '#fcd116'], cl: ['#d52b1e', '#0039a6'],
  al: ['#e41e20', '#111111'], py: ['#d52b1e', '#ffffff'], ie: ['#169b62', '#ffffff'],
  xk: ['#244aa5', '#d0a650'], ro: ['#fcd116', '#002b7f'], 'gb-wls': ['#c8102e', '#ffffff'],
  sa: ['#ffffff', '#006c35'], gn: ['#ce1126', '#fcd116'], ve: ['#7b1e2e', '#ffffff'],
  fi: ['#ffffff', '#002f6c'], ru: ['#ffffff', '#0039a6'], au: ['#ffcd00', '#00843d'],
  is: ['#02529c', '#ffffff'], pe: ['#ffffff', '#d91023'], ao: ['#cc092f', '#111111'],
  jm: ['#fed100', '#009b3a'], qa: ['#8a1538', '#ffffff'], il: ['#ffffff', '#0038b8'],
  cv: ['#003893', '#ffffff'], sr: ['#377e3f', '#ffffff'], 'gb-nir': ['#00a650', '#ffffff'],
  bf: ['#009e49', '#ef2b2d'], nz: ['#ffffff', '#111111'], me: ['#c40308', '#d4af37'],
  bg: ['#ffffff', '#00966e'], ht: ['#00209f', '#d21034'], cy: ['#0055a4', '#ffffff'],
  bo: ['#007934', '#ffffff'], pa: ['#da121a', '#ffffff'], mk: ['#d20000', '#ffe600'],
  id: ['#ce1126', '#ffffff'], km: ['#00a550', '#ffffff'], cr: ['#ce1126', '#002b7f'],
  lu: ['#ed2939', '#ffffff'], cw: ['#002b7f', '#f9e814'], dz: ['#ffffff', '#006233'],
  eg: ['#c8102e', '#ffffff'], tn: ['#e70013', '#ffffff'], ir: ['#ffffff', '#239f40'],
};
const FALLBACK_KITS = [
  ['#2f6fdb', '#ffffff'],
  ['#c8102e', '#ffffff'],
  ['#0f8a4f', '#ffffff'],
  ['#f2c230', '#13213d'],
  ['#6d3fc0', '#ffffff'],
  ['#e8702a', '#13213d'],
];
// prettier-ignore
const NOISE = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'sv', 'fk', 'sk', 'cd', 'ud', 'ss', 'as', 'bk', 'if',
  'club', 'de', 'the', 'and']);

/** Three-letter broadcast code: 'Real Madrid' → 'RMA', 'Arsenal' → 'ARS', 'Paris Saint-Germain' → 'PSG'. */
export function teamCode(name) {
  const words = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 1 && !/^\d+$/.test(w) && !NOISE.has(w.toLowerCase()));
  if (!words.length)
    return String(name || 'TM')
      .slice(0, 3)
      .toUpperCase();
  const code =
    words.length === 1
      ? words[0].slice(0, 3)
      : words.length === 2
        ? words[0][0] + words[1].slice(0, 2)
        : words
            .slice(0, 3)
            .map(w => w[0])
            .join('');
  return code.toUpperCase();
}

/** Generic kit when a side has neither colours nor a nation (neutral navy + white). */
export const NEUTRAL_KIT = ['#2e3e63', '#ffffff'];

/** Home kit [primary, secondary] of a nation by flag code, or null without a code. */
export function nationKit(code) {
  if (!code) return null;
  const key = String(code).toLowerCase();
  if (NATION_KITS[key]) return NATION_KITS[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_KITS[h % FALLBACK_KITS.length];
}

/** Kit colours [primary, secondary] of any side/opponent ref (club colours, nation kit). */
export function sideColors(side) {
  if (side?.color) return [side.color, side.secondary || '#16213a'];
  return nationKit(side?.code) || NEUTRAL_KIT;
}

/**
 * Kit colours of a side in any of the shapes the stores pass around: `colors: [p, s]`,
 * `color`/`secondary`, or a nation `code`/`flagCode`. `fallback` (default: the neutral kit)
 * is used only when none of those is present.
 */
export function kitColors(side, fallback = NEUTRAL_KIT) {
  const given = (side?.colors || []).filter(Boolean);
  if (given.length) return given.length > 1 ? given : [given[0], '#16213a'];
  if (side?.color) return [side.color, side.secondary || '#16213a'];
  return nationKit(side?.code ?? side?.flagCode) || fallback;
}
