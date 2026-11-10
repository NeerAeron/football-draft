// Watch a moment of a fixture as a contact sheet of frames (PNG) — the way to look at what the
// engine actually did around a finding from blunders.mjs, without opening the game.
//
//   node tools/calibration/watch.mjs --fixture 3 --at 81.4                 # 3 s before … 3 s after
//   node tools/calibration/watch.mjs --fixture 3 --at 81.4 --before 6 --after 2 --frames 16
//   node tools/calibration/watch.mjs --fixture 3 --at 81.4 --full          # whole pitch
//   node tools/calibration/watch.mjs --fixture 3 --at 81.4 --trace         # + one text line per frame
//
// Options: --out <file.png> (default .shots/watch-<fixture>-<at>.png), --engine <app dir>,
// --cols N (4). Each frame shows both teams (number = shirt slot, ring = carrier, yellow rim =
// keeper, tick = velocity, dotted line = where he is heading, two letters = intent), the ball
// (bigger when it is in the air) and a header: elapsed · clock · ball state · carrier's action.
// Needs the pre-installed Playwright (same as scripts/dev/browser.mjs).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadFixtures } from './lib/fixtures.mjs';

const args = process.argv.slice(2),
  flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const fixtureId = Number(flag('--fixture', 0)),
  at = Number(flag('--at', 30)),
  before = Number(flag('--before', 3)),
  after = Number(flag('--after', 3)),
  frames = Number(flag('--frames', 12)),
  cols = Number(flag('--cols', 4)),
  full = args.includes('--full'),
  out = resolve(flag('--out', `.shots/watch-${fixtureId}-${at}.png`));

const W = 105,
  H = 68;
const INTENT = {
  press: 'PR',
  mark: 'MK',
  track: 'TR',
  cover: 'CV',
  recover: 'RC',
  receive: 'RV',
  intercept: 'IN',
  sweep: 'SW',
  dribble: 'DR',
  run: 'RN',
  shape: 'SH',
  hold: 'HD',
  support: 'SP',
  reset: 'RS',
  keeper: 'GK',
};

const { fixtures, buildMatch } = await loadFixtures(flag('--engine') || undefined);
const spec = fixtures(fixtureId + 1)[fixtureId];
const m = buildMatch(spec);
const start = Math.max(0, at - before),
  every = (before + after) / Math.max(1, frames - 1);
const shots = [];
let next = start,
  lastEvent = 0;
while (!m.finished && shots.length < frames) {
  m.step(1 / 60);
  if (m.elapsed + 1e-9 >= next) {
    const b = m.ball,
      owner = b.owner != null ? m.players[b.owner] : null,
      news = m.events
        .slice(0, m.events.length - lastEvent)
        .reverse()
        .map(e => e.text);
    lastEvent = m.events.length;
    shots.push({
      elapsed: m.elapsed,
      time: m.time,
      mode: m.mode,
      phase: m.phase,
      restart: m.mode === 'restart' ? m.restart.type : null,
      ball: { x: b.x, y: b.y, z: b.z, kind: b.kind, vx: b.vx, vy: b.vy },
      owner: owner?.id ?? null,
      kicker: b.kicker,
      target: b.kind === 'pass' ? b.target : null,
      delivery: b.kind === 'pass' ? b.delivery : null,
      action: owner?.action ?? (b.kicker != null ? m.players[b.kicker].action : ''),
      news,
      players: m.players
        .filter(p => !p.sentOff)
        .map(p => ({
          id: p.id,
          team: p.team,
          n: p.slot + 1,
          gk: p.role === 'GK',
          name: p.name,
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          tx: p.tx,
          ty: p.ty,
          intent: p.intent,
          action: p.action,
        })),
    });
    next += every;
  }
}
if (!shots.length) throw Error(`fixture ${fixtureId} ended before ${start}s`);

// ---- view box: the whole pitch, or the area the ball travels through (at least 52 × 34 m)
let view = { x: -2, y: -2, w: W + 4, h: H + 4 };
if (!full) {
  const xs = shots.map(s => s.ball.x),
    ys = shots.map(s => s.ball.y);
  let w = Math.max(52, Math.max(...xs) - Math.min(...xs) + 24),
    h = Math.max(34, Math.max(...ys) - Math.min(...ys) + 16);
  if (w / h > 52 / 34) h = (w * 34) / 52;
  else w = (h * 52) / 34;
  w = Math.min(w, W + 4);
  h = Math.min(h, H + 4);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2,
    cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  view = {
    x: Math.min(Math.max(cx - w / 2, -2), W + 2 - w),
    y: Math.min(Math.max(cy - h / 2, -2), H + 2 - h),
    w,
    h,
  };
}
const scale = view.w / 52; // glyph size follows the zoom
const COLORS = ['#ff5a5f', '#4aa8ff'];
const clock = s => `${Math.floor(s.time / 60)}'${String(Math.floor(s.time % 60)).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function frame(s, index) {
  const r = 1.05 * scale,
    parts = [];
  parts.push(
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#1d6b3a" stroke="#cfe8d6" stroke-width="${0.18 * scale}"/>`,
    `<line x1="52.5" y1="0" x2="52.5" y2="${H}" stroke="#cfe8d6" stroke-width="${0.14 * scale}"/>`,
    `<circle cx="52.5" cy="34" r="9.15" fill="none" stroke="#cfe8d6" stroke-width="${0.14 * scale}"/>`,
  );
  for (const x of [0, W]) {
    const d = x ? -1 : 1;
    parts.push(
      `<rect x="${x ? W - 16.5 : 0}" y="${34 - 20.16}" width="16.5" height="40.32" fill="none" stroke="#cfe8d6" stroke-width="${0.14 * scale}"/>`,
      `<rect x="${x ? W - 5.5 : 0}" y="${34 - 9.16}" width="5.5" height="18.32" fill="none" stroke="#cfe8d6" stroke-width="${0.14 * scale}"/>`,
      `<rect x="${x ? W : -1.6}" y="${34 - 3.66}" width="1.6" height="7.32" fill="#ffffff30" stroke="#fff" stroke-width="${0.14 * scale}"/>`,
      `<circle cx="${x + d * 11}" cy="34" r="${0.25 * scale}" fill="#cfe8d6"/>`,
    );
  }
  for (const p of s.players) {
    const speed = Math.hypot(p.vx, p.vy),
      carrier = s.owner === p.id,
      target = s.target === p.id;
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 1.5)
      parts.push(
        `<line x1="${p.x}" y1="${p.y}" x2="${p.tx}" y2="${p.ty}" stroke="${COLORS[p.team]}" stroke-opacity=".45" stroke-width="${0.12 * scale}" stroke-dasharray="${0.5 * scale} ${0.5 * scale}"/>`,
      );
    if (speed > 0.4)
      parts.push(
        `<line x1="${p.x}" y1="${p.y}" x2="${p.x + p.vx * 0.5}" y2="${p.y + p.vy * 0.5}" stroke="#fff" stroke-width="${0.22 * scale}"/>`,
      );
    parts.push(
      `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${COLORS[p.team]}" stroke="${carrier ? '#fff' : p.gk ? '#ffd84a' : target ? '#9dff8a' : '#0008'}" stroke-width="${(carrier ? 0.38 : 0.2) * scale}"/>`,
      `<text x="${p.x}" y="${p.y + 0.42 * scale}" font-size="${1.2 * scale}" text-anchor="middle" fill="#fff" font-weight="700">${p.n}</text>`,
      `<text x="${p.x}" y="${p.y - 1.35 * scale}" font-size="${0.95 * scale}" text-anchor="middle" fill="#fffc">${
        INTENT[p.intent] ||
        esc(
          String(p.intent || '')
            .slice(0, 2)
            .toUpperCase(),
        )
      }</text>`,
    );
  }
  const b = s.ball,
    br = (0.42 + Math.min(b.z, 6) * 0.12) * scale;
  if (b.z > 0.4)
    parts.push(
      `<ellipse cx="${b.x + b.z * 0.25}" cy="${b.y + b.z * 0.25}" rx="${br}" ry="${br * 0.6}" fill="#0006"/>`,
    );
  parts.push(
    `<line x1="${b.x}" y1="${b.y}" x2="${b.x - b.vx * 0.25}" y2="${b.y - b.vy * 0.25}" stroke="#fff" stroke-opacity=".7" stroke-width="${0.2 * scale}"/>`,
    `<circle cx="${b.x}" cy="${b.y}" r="${br}" fill="#fff" stroke="#111" stroke-width="${0.14 * scale}"/>`,
  );
  const who = id => (id == null ? '?' : `${s.players.find(p => p.id === id)?.name ?? id}`);
  const state =
    s.mode === 'restart'
      ? `RESTART ${s.restart}`
      : s.owner != null
        ? `${s.ball.kind} · ${who(s.owner)}`
        : s.ball.kind === 'pass'
          ? `${s.delivery} ${who(s.kicker)} → ${who(s.target)}`
          : `${s.ball.kind}${s.ball.z > 0.5 ? ` z${s.ball.z.toFixed(1)}` : ''}`;
  return `<figure>
    <figcaption><b>${index + 1}</b> ${s.elapsed.toFixed(1)}s ${clock(s)} · ${esc(state)}<br><i>${esc(s.action || s.phase || '')}</i></figcaption>
    <svg viewBox="${view.x} ${view.y} ${view.w} ${view.h}" font-family="Arial, sans-serif">${parts.join('')}</svg>
    <p>${esc(s.news.join(' · ')) || '&nbsp;'}</p>
  </figure>`;
}

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:10px;background:#0b1020;color:#e8ecf5;font:12px/1.3 Arial,sans-serif;width:${cols * 470}px}
  h1{font-size:14px;margin:0 0 8px;font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px}
  figure{margin:0;background:#141b2f;border-radius:6px;padding:6px}
  figcaption{min-height:30px} i{color:#9fb0d0} b{color:#cdf545}
  svg{display:block;width:100%;border-radius:4px;background:#12381f}
  p{margin:4px 0 0;min-height:15px;color:#ffd84a;font-size:11px}
</style>
<h1>Fixture ${fixtureId}: <span style="color:${COLORS[0]}">${esc(spec.home.name)}</span> v <span style="color:${COLORS[1]}">${esc(spec.away.name)}</span> · seed ${spec.seed} · ${spec.duration}s · frames every ${every.toFixed(2)}s around ${at}s</h1>
<div class="grid">${shots.map(frame).join('')}</div>`;

if (args.includes('--trace'))
  for (const [i, s] of shots.entries()) {
    const o = s.owner != null ? s.players.find(p => p.id === s.owner) : null;
    console.log(
      `${String(i + 1).padStart(2)} ${s.elapsed.toFixed(2)}s ${clock(s)} ${s.mode}/${s.ball.kind} ball(${s.ball.x.toFixed(1)},${s.ball.y.toFixed(1)},z${s.ball.z.toFixed(1)}) ${o ? `${o.name}#${o.n}t${o.team} "${o.action}"` : ''} ${s.news.join(' | ')}`,
    );
  }

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * 470 + 20, height: 600 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
