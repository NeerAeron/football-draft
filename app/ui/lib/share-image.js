// Share card image: a 1080 × 1350 (4:5, the feed format) PNG of a finished World Cup Run or
// Daily Challenge — the XI's flags on a pitch, record, grade + verdict, result squares and the
// mode — drawn on a canvas with our fonts. Pure layout math is exported for tests; drawing and
// sharing need a browser.
//
//   const blob = await renderShareImage(card);         // card: see shareCard() below
//   await shareImage(blob, { title, text, filename });  // Web Share with a file, else download
import { FORMATIONS } from '../../core/players/formations.js';

/** Cup outline paths in a 100 × 110 box (the run screen's Trophy SVG draws the same shape). */
export const CUP_PATHS = {
  handleLeft: 'M27 13c-12 0-17 6-15.5 14.5C13 37 21 45 32 48',
  handleRight: 'M73 13c12 0 17 6 15.5 14.5C87 37 79 45 68 48',
  bowl: 'M23 6h54v20c0 20-11 33-27 37-16-4-27-17-27-37z',
  stem: 'M45 63h10l-1.5 15h-7z',
  base: 'M33 84h34l4 15H29z',
  star: 'm50 18 3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5.1-4.9 7-1z',
};

export const SHARE_W = 1080;
export const SHARE_H = 1350;
const LINE_GAP = 5;

/**
 * Token centres for a formation on a portrait pitch box { x, y, w, h } (attacking upwards):
 * lines (similar depth) spread evenly between the box's bottom (GK) and top; width kept.
 */
export function pitchTokenLayout(formation, box) {
  const rows = Array.isArray(formation) ? formation : FORMATIONS[formation] || FORMATIONS['433'];
  const order = rows.map((r, i) => i).sort((a, b) => rows[a][0] - rows[b][0]);
  const lines = [];
  for (const i of order) {
    const last = lines.at(-1);
    if (last && rows[i][0] - rows[last.at(-1)][0] <= LINE_GAP) last.push(i);
    else lines.push([i]);
  }
  const bottom = box.y + box.h * 0.85,
    top = box.y + box.h * 0.12,
    step = lines.length > 1 ? (bottom - top) / (lines.length - 1) : 0;
  const out = [];
  lines.forEach((line, li) => {
    const mean = line.reduce((s, i) => s + rows[i][0], 0) / line.length;
    for (const i of line) {
      const [x, y, role] = rows[i];
      out[i] = {
        index: i,
        role,
        x: Math.round(box.x + box.w * (0.1 + (y / 68) * 0.8)),
        y: Math.round(bottom - li * step - (x - mean) * (box.h / 160)),
      };
    }
  });
  return out;
}

/** Result squares row: positions of up to 7 squares (+ a gap between group and knockouts). */
export function resultSquares(count, { x, y, size = 64, gap = 12, groupGap = 36 }) {
  return Array.from({ length: count }, (_, i) => ({
    x: x + i * (size + gap) + (i >= 3 ? groupGap - gap : 0),
    y,
    size,
  }));
}

/** Shorten a name to fit a pixel width with a measure function (canvas or a stub in tests). */
export function fitText(text, maxWidth, measure) {
  let s = String(text || '');
  if (measure(s) <= maxWidth) return s;
  while (s.length > 1 && measure(s + '…') > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

/**
 * Card data for renderShareImage, built by the screens:
 * { title: 'World Cup Run' | 'Daily #7', subtitle: 'Nations · Pro', record: { w, d, l },
 *   results: ['W','D',…], champion, grade, verdict, stageLabel, formation,
 *   players: [{ name, code, nation, rating? }] (slot order), hideRatings,
 *   stats: [{ label, value }] (≤ 3), footer: 'football-draft.example' }
 */

// ---- drawing (browser) -------------------------------------------------------------------------
const C = {
  bg: '#070b16',
  ink: '#0d1424',
  text1: '#f3f6fd',
  text2: '#b4bfd6',
  text3: '#8592ad',
  volt: '#cdf545',
  gold: '#f5c84c',
  coral: '#ff6f61',
  amber: '#ffb547',
  green: '#3ddc84',
  pitchA: '#155f37',
  pitchB: '#186b3e',
  line: 'rgba(236,255,240,0.38)',
};
const OUTCOME_FILL = { W: C.green, D: C.amber, L: C.coral };
const GRADE_FILL = {
  s: ['#ff8fd0', '#b494ff', '#6fd6ff', '#7dffc0'],
  a: ['#fff1c4', '#f5c84c', '#dba52a'],
  b: ['#ecff9e', '#cdf545', '#8bb012'],
  c: ['#d6f1ff', '#5cc8ff', '#2a8fc7'],
  d: ['#ffe0b8', '#ffb547', '#c77510'],
  f: ['#ffd0ca', '#ff6f61', '#b8322a'],
};
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const UI = 'Inter, system-ui, sans-serif';

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}
function gradient(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
  return g;
}
async function ensureFonts() {
  const fonts = globalThis.document?.fonts;
  if (!fonts?.load) return;
  await Promise.all([
    fonts.load(`800 120px ${DISPLAY}`),
    fonts.load(`700 40px ${DISPLAY}`),
    fonts.load(`600 28px ${UI}`),
    fonts.load(`400 28px ${UI}`),
  ]).catch(() => {});
}

function drawBackground(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  };
  glow(540, -120, 820, 'rgba(128,160,255,0.28)');
  glow(60, -40, 520, 'rgba(205,245,69,0.12)');
  glow(1020, -40, 520, 'rgba(120,210,255,0.14)');
}

function drawPitch(ctx, box) {
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, 28);
  ctx.clip();
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? C.pitchA : C.pitchB;
    ctx.fillRect(box.x, box.y + (box.h / stripes) * i, box.w, box.h / stripes + 1);
  }
  const shade = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  shade.addColorStop(0, 'rgba(7,11,22,0.15)');
  shade.addColorStop(1, 'rgba(7,11,22,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  const pad = 22,
    x = box.x + pad,
    y = box.y + pad,
    w = box.w - pad * 2,
    h = box.h - pad * 2;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h / 2, w * 0.13, 0, Math.PI * 2);
  ctx.stroke();
  const bw = w * 0.5,
    bh = h * 0.14;
  ctx.strokeRect(x + (w - bw) / 2, y, bw, bh);
  ctx.strokeRect(x + (w - bw) / 2, y + h - bh, bw, bh);
  ctx.restore();
}

async function drawToken(ctx, p, { x, y, r, hideRatings }) {
  // flag disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(7,11,22,0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const img = p.image;
  if (img) {
    const ratio = img.naturalWidth / img.naturalHeight || 4 / 3;
    const h = r * 2,
      w = h * ratio;
    ctx.drawImage(img, x - w / 2, y - r, w, h);
  } else {
    ctx.fillStyle = '#2e3e63';
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = C.text1;
    ctx.font = `700 ${Math.round(r * 0.8)}px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      String(p.nation || p.name || '?')
        .slice(0, 3)
        .toUpperCase(),
      x,
      y + 2,
    );
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  // rating badge
  if (!hideRatings && p.rating != null) {
    const bw = 50,
      bh = 30;
    roundRect(ctx, x - bw / 2, y + r - 14, bw, bh, 8);
    ctx.fillStyle = p.rating >= 85 ? '#c9b6ff' : p.rating >= 80 ? C.gold : '#d9e1ee';
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.font = `800 26px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.rating), x, y + r + 2);
  }
  // name
  ctx.font = `700 25px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const name = fitText(p.name, 150, s => ctx.measureText(s).width).toUpperCase();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(7,11,22,0.8)';
  const ny = y + r + (hideRatings ? 10 : 20);
  ctx.strokeText(name, x, ny);
  ctx.fillStyle = C.text1;
  ctx.fillText(name, x, ny);
}

function drawCup(ctx, x, y, scale) {
  if (typeof Path2D !== 'function') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const gold = gradient(ctx, 0, 0, 100, 110, ['#fff4cf', '#f5c84c', '#a8770f', '#f7d774']);
  ctx.strokeStyle = '#dba52a';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke(new Path2D(CUP_PATHS.handleLeft));
  ctx.stroke(new Path2D(CUP_PATHS.handleRight));
  ctx.fillStyle = gold;
  for (const d of [CUP_PATHS.bowl, CUP_PATHS.stem, CUP_PATHS.base]) ctx.fill(new Path2D(d));
  ctx.fillRect(26, 99, 48, 9);
  ctx.restore();
}

function drawGrade(ctx, grade, x, y, size) {
  const family = String(grade || 'F')[0].toLowerCase();
  const fill = GRADE_FILL[family] || GRADE_FILL.f;
  roundRect(ctx, x, y, size, size, size * 0.24);
  ctx.fillStyle = gradient(ctx, x, y, x + size, y + size, fill);
  ctx.fill();
  roundRect(ctx, x + 6, y + 6, size - 12, size - 12, size * 0.2);
  ctx.fillStyle = 'rgba(7,11,22,0.88)';
  ctx.fill();
  ctx.fillStyle = gradient(ctx, x, y, x + size, y + size, fill);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const letter = String(grade)[0],
    mod = String(grade).slice(1);
  ctx.font = `800 ${Math.round(size * 0.62)}px ${DISPLAY}`;
  const lw = ctx.measureText(letter).width;
  ctx.font = `800 ${Math.round(size * 0.36)}px ${DISPLAY}`;
  const mw = mod ? ctx.measureText(mod).width : 0;
  const start = x + size / 2 - (lw + mw) / 2;
  ctx.textAlign = 'left';
  ctx.font = `800 ${Math.round(size * 0.62)}px ${DISPLAY}`;
  ctx.fillText(letter, start, y + size * 0.54);
  if (mod) {
    ctx.font = `800 ${Math.round(size * 0.36)}px ${DISPLAY}`;
    ctx.fillText(mod, start + lw + 2, y + size * 0.36);
  }
}

/** Draw the card on a canvas and return a PNG Blob. */
export async function renderShareImage(card, { canvas } = {}) {
  await ensureFonts();
  const el = canvas || globalThis.document.createElement('canvas');
  el.width = SHARE_W;
  el.height = SHARE_H;
  const ctx = el.getContext('2d');
  drawBackground(ctx);
  const M = 72;

  // header
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = C.volt;
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.letterSpacing = '5px';
  ctx.fillText('FOOTBALL DRAFT', M, 104);
  ctx.textAlign = 'right';
  ctx.fillStyle = card.champion ? C.gold : C.text2;
  ctx.fillText(String(card.title || 'World Cup Run').toUpperCase(), SHARE_W - M, 104);
  ctx.letterSpacing = '0px';

  // grade + verdict + record
  const gy = 150,
    gs = 190;
  drawGrade(ctx, card.grade || 'F', M, gy, gs);
  ctx.textAlign = 'left';
  ctx.fillStyle = card.champion ? C.gold : C.text1;
  ctx.font = `800 84px ${DISPLAY}`;
  const textX = M + gs + 40,
    textW = SHARE_W - M - textX;
  ctx.fillText(
    fitText(String(card.verdict || '').toUpperCase(), textW, s => ctx.measureText(s).width),
    textX,
    gy + 78,
  );
  ctx.fillStyle = C.text2;
  ctx.font = `600 30px ${UI}`;
  ctx.fillText(
    fitText(card.stageLabel || '', textW, s => ctx.measureText(s).width),
    textX,
    gy + 132,
  );
  const r = card.record || { w: 0, d: 0, l: 0 };
  ctx.font = `800 64px ${DISPLAY}`;
  ctx.fillStyle = C.text1;
  ctx.fillText(`${r.w}–${r.d}–${r.l}`, textX, gy + 196);
  const rw = ctx.measureText(`${r.w}–${r.d}–${r.l}`).width;
  ctx.font = `600 22px ${UI}`;
  ctx.fillStyle = C.text3;
  ctx.fillText('W – D – L', textX + rw + 18, gy + 192);

  // result squares
  const squares = resultSquares(7, { x: M, y: 384, size: 62, gap: 12, groupGap: 40 });
  squares.forEach((s, i) => {
    const res = card.results?.[i];
    roundRect(ctx, s.x, s.y, s.size, s.size, 12);
    ctx.fillStyle = res ? OUTCOME_FILL[res] : 'rgba(148,170,220,0.12)';
    ctx.fill();
    if (res) {
      ctx.fillStyle = 'rgba(7,11,22,0.85)';
      ctx.font = `800 34px ${DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(res, s.x + s.size / 2, s.y + s.size / 2 + 2);
    }
  });
  const lastSquare = squares.at(-1);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (card.champion) {
    const cx = lastSquare.x + lastSquare.size + 28;
    drawCup(ctx, cx, lastSquare.y - 4, 0.62);
    ctx.font = `800 40px ${DISPLAY}`;
    ctx.fillStyle = C.gold;
    ctx.fillText('CHAMPIONS', cx + 76, lastSquare.y + 33);
  }

  // pitch + XI
  const box = { x: M, y: 482, w: SHARE_W - M * 2, h: 700 };
  drawPitch(ctx, box);
  const tokens = pitchTokenLayout(card.formation, box);
  const images = await Promise.all(
    (card.players || []).map(p => loadImage(p.code ? `./assets/flags/${p.code}.svg` : null)),
  );
  for (let i = 0; i < tokens.length; i++) {
    const p = card.players?.[i];
    if (!p) continue;
    await drawToken(
      ctx,
      { ...p, image: images[i] },
      {
        x: tokens[i].x,
        y: tokens[i].y - 10,
        r: 40,
        hideRatings: card.hideRatings,
      },
    );
  }

  // footer stats
  ctx.textBaseline = 'alphabetic';
  const stats = (card.stats || []).slice(0, 3);
  const colW = (SHARE_W - M * 2) / Math.max(1, stats.length);
  stats.forEach((s, i) => {
    const cx = M + colW * i;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text1;
    ctx.font = `800 52px ${DISPLAY}`;
    ctx.fillText(String(s.value), cx, 1262);
    ctx.fillStyle = C.text3;
    ctx.font = `600 22px ${UI}`;
    ctx.fillText(String(s.label).toUpperCase(), cx, 1294);
  });
  ctx.textAlign = 'right';
  ctx.fillStyle = C.text3;
  ctx.font = `500 22px ${UI}`;
  ctx.fillText(card.subtitle || '', SHARE_W - M, 1262);
  ctx.fillStyle = C.volt;
  ctx.font = `600 22px ${UI}`;
  ctx.fillText(card.footer || '', SHARE_W - M, 1294);

  return new Promise((resolve, reject) =>
    el.toBlob(b => (b ? resolve(b) : reject(Error('Could not draw the image'))), 'image/png'),
  );
}

/**
 * Share a PNG with the Web Share API (files) when the device can, else download it.
 * Returns 'shared' | 'downloaded' | 'cancelled'.
 */
export async function shareImage(blob, { filename = 'football-draft.png', title, text } = {}) {
  const File_ = globalThis.File;
  const file = File_ ? new File_([blob], filename, { type: 'image/png' }) : null;
  const nav = globalThis.navigator;
  if (file && nav?.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title, text });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = globalThis.document.createElement('a');
  a.href = url;
  a.download = filename;
  globalThis.document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
