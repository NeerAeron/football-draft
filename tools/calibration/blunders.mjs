// "Dumb play" detector: simulates club matches and counts the moments a viewer would call
// stupid — the things that make a watched match frustrating — with the fixture id and clock
// of each, so watch.mjs can render them and a fix can be measured before/after.
//
//   node tools/calibration/blunders.mjs                      # 24 fixtures, summary per 90'
//   node tools/calibration/blunders.mjs --matches 48 --out /tmp/after.json
//   node tools/calibration/blunders.mjs --engine /tmp/before/app --out /tmp/before.json
//   node tools/calibration/blunders.mjs --compare /tmp/before.json /tmp/after.json
//   node tools/calibration/blunders.mjs --list giveaway --limit 12     # samples to watch
//   node tools/calibration/watch.mjs --fixture 3 --at 81.4             # …then look at one
//
// Options: --matches N (24), --workers N (3), --engine <app dir> (another checkout's app/,
// e.g. `git archive <commit> app | tar -x -C /tmp/before`), --tuning <json | file> (a patch
// over the tuning, e.g. '{"gameplay":{"markingLapses":1.3}}'), --list <type> [--limit N].
// Everything is measured from engine state only (docs/engine-events.md); nothing here
// consumes simulation RNG. What each finding means is documented at DETECTORS below.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFixtures } from './lib/fixtures.mjs';

const W = 105,
  H = 68;
const hyp = Math.hypot;

/** What a finding of each type means (also the order of the summary). */
export const DETECTORS = {
  giveaway: 'plain pass by an unpressed player (nobody within 4 m) cut out by an opponent',
  'pass-out': 'plain pass (not a cross, clearance or long ball) straight out of play',
  'restart-giveaway': 'throw-in, goal kick or free kick passed straight to an opponent',
  'keeper-giveaway': "keeper's pass or throw cut out in his own half",
  'dribble-out': 'carrier takes the ball out of play with no opponent within 3 m',
  'own-box-dawdle': 'outfield carrier keeps the ball 1.5 s+ in his own box with a presser on him',
  'idle-carrier': 'unpressed outfield carrier keeps the ball 6 s+ and goes nowhere (< 5 m)',
  'keeper-hold': 'keeper holds the ball 8 s+',
  retreat: 'carrier runs 18 m+ back towards his own goal in one carry',
  dither: 'unpressed carrier turns back and forth (3+ reversals in one carry)',
  'loose-ignored': 'slow loose ball (< 3 m/s) that nobody is running at for 1 s+',
  'loose-long': 'ball loose for 4 s+ in open play',
  swarm: 'seconds with 8+ outfield players within 7 m of the ball (open play)',
  'crowd-carrier': 'seconds with a team-mate within 1.5 m of the carrier outside the boxes',
  statue: 'outfield player standing still 8 s+ in open play with the ball within 35 m',
  'free-in-box': 'seconds an attacker has the ball in the box with no defender within 5 m',
  'no-shot': 'carrier 1.5 s+ within 11 m of goal, in front of it, unpressed, without shooting',
  'hopeless-shot': 'shot from 28 m+ with xG under 0.03',
  'soft-goal': 'goal from a shot with xG under 0.04',
  'own-goal': 'own goal',
  'keeper-wander': 'seconds a keeper is 26 m+ from his goal in open play',
  'ping-pong': 'two players swapping 4+ short passes in a row',
  'back-to-keeper': 'unpressed pass back to the keeper from the opposition half',
  offside: 'offside (for scale)',
  teleport: 'player moved faster than 16 m/s in open play',
};

// ---------------------------------------------------------------- one match

function analyse(m, spec) {
  const findings = [],
    add = (type, extra = {}) =>
      findings.push({
        type,
        fixture: spec.id,
        at: +m.elapsed.toFixed(2),
        clock: clock(m),
        ...extra,
      });
  const totals = { play: 0, restart: 0, restarts: {}, swarm: 0, crowd: 0, freeBox: 0, wander: 0 };
  const name = id => (id == null ? null : m.players[id].name);
  const opponents = p => m.activePlayers.filter(q => q.team !== p.team);
  const nearestOpp = p => Math.min(...opponents(p).map(q => hyp(q.x - p.x, q.y - p.y)));
  const relX = (x, team) => m.rel(x, team);

  let prev = snapshot(m),
    pass = null, // pass in flight
    carry = null, // one player's spell on the ball
    loose = null, // loose-ball spell
    exchange = [], // recent completed short passes (ping-pong)
    restartStart = null,
    seenEvents = 0,
    step = 0;
  const still = new Array(22).fill(0),
    stillFlagged = new Array(22).fill(false),
    lastPos = m.players.map(p => ({ x: p.x, y: p.y }));

  const endCarry = out => {
    if (!carry) return;
    const p = m.players[carry.id],
      duration = m.elapsed - carry.t0,
      moved = hyp(p.x - carry.x0, p.y - carry.y0);
    if (p.role !== 'GK') {
      if (duration >= 6 && moved < 5 && carry.minOpp > 5)
        add('idle-carrier', { player: p.name, seconds: +duration.toFixed(1), from: carry.t0 });
      if (carry.back >= 18)
        add('retreat', { player: p.name, metres: Math.round(carry.back), from: carry.t0 });
      if (carry.reversals >= 3 && carry.minOpp > 4)
        add('dither', { player: p.name, reversals: carry.reversals, from: carry.t0 });
      if (carry.ownBoxPressed >= 1.5)
        add('own-box-dawdle', { player: p.name, seconds: +carry.ownBoxPressed.toFixed(1) });
      if (carry.noShot >= 1.5)
        add('no-shot', { player: p.name, seconds: +carry.noShot.toFixed(1), from: carry.t0 });
    } else if (carry.held >= 8) add('keeper-hold', { seconds: +carry.held.toFixed(1) });
    if (out && p.role !== 'GK' && carry.lastOpp > 3)
      add('dribble-out', { player: p.name, restart: out, nearest: +carry.lastOpp.toFixed(1) });
    carry = null;
  };

  const endPass = (outcome, by = null) => {
    if (!pass) return;
    const k = m.players[pass.kicker],
      plain = pass.delivery === 'pass' && pass.length < 32,
      interceptor = by != null ? m.players[by] : null;
    const info = {
      player: k.name,
      to: name(pass.target),
      length: Math.round(pass.length),
      from: pass.t0,
      pressure: +pass.pressure.toFixed(1),
      zone: zone(relX(pass.x0, k.team)),
    };
    if (outcome === 'intercepted') {
      if (pass.restart)
        add('restart-giveaway', { ...info, restart: pass.restart, by: interceptor.name });
      else if (k.role === 'GK' && relX(interceptor.x, k.team) < 52.5)
        add('keeper-giveaway', { ...info, by: interceptor.name });
      else if (plain && pass.pressure > 4) add('giveaway', { ...info, by: interceptor.name });
    } else if (outcome === 'out' && plain && !pass.restart) add('pass-out', info);
    if (outcome === 'complete' && pass.length < 12) {
      exchange.push({ a: pass.kicker, b: by, t: m.elapsed });
      exchange = exchange.filter(e => m.elapsed - e.t < 12).slice(-6);
      const n = exchange.length;
      if (
        n >= 4 &&
        [1, 2, 3].every(
          i =>
            exchange[n - i].a === exchange[n - i - 1].b &&
            exchange[n - i].b === exchange[n - i - 1].a,
        )
      ) {
        add('ping-pong', { players: [name(pass.kicker), name(by)] });
        exchange = [];
      }
    } else if (outcome !== 'complete') exchange = [];
    pass = null;
  };

  while (!m.finished && step < 60 * 60 * 20) {
    m.step(1 / 60);
    step++;
    const dt = 1 / 60,
      b = m.ball,
      cur = snapshot(m);
    if (m.mode === 'shootout') break;

    // ---- clock shares
    if (m.mode === 'play') totals.play += dt;
    else if (m.mode === 'restart') {
      totals.restart += dt;
      if (prev.mode !== 'restart' || prev.restart !== cur.restart)
        restartStart = { type: cur.restart, t: m.elapsed };
    }
    if (prev.mode === 'restart' && m.mode === 'play' && restartStart) {
      const r = (totals.restarts[restartStart.type] ??= { n: 0, seconds: 0 });
      r.n++;
      r.seconds += m.elapsed - restartStart.t;
    }

    // ---- ball leaves play: who put it out?
    if (m.mode === 'restart' && prev.mode === 'play') {
      const out = ['Throw-in', 'Goal kick', 'Corner'].includes(cur.restart) ? cur.restart : null;
      if (pass) endPass(out ? 'out' : 'stopped');
      endCarry(prev.kind === 'dribble' ? out : null);
      loose = null;
    }

    // ---- pass start / end
    if (m.mode === 'play') {
      const started =
        b.kind === 'pass' &&
        b.owner === null &&
        (prev.kind !== 'pass' || prev.kicker !== b.kicker || b.age < prev.age);
      if (started) {
        if (pass) endPass('complete', b.kicker); // first-time lay-off
        endCarry(null);
        const k = m.players[b.kicker];
        pass = {
          t0: +m.elapsed.toFixed(2),
          kicker: b.kicker,
          target: b.target,
          delivery: b.delivery || 'pass',
          x0: k.x,
          y0: k.y,
          length: b.destination ? hyp(b.destination.x - k.x, b.destination.y - k.y) : 0,
          pressure: nearestOpp(k),
          restart: prev.mode === 'restart' ? prev.restart : null,
        };
        const target = b.target != null ? m.players[b.target] : null;
        if (
          target?.role === 'GK' &&
          target.team === k.team &&
          relX(k.x, k.team) > 52.5 &&
          pass.pressure > 5 &&
          !pass.restart
        )
          add('back-to-keeper', { player: k.name, from: pass.t0 });
      } else if (pass) {
        if (b.owner !== null) {
          const o = m.players[b.owner];
          endPass(o.team === m.players[pass.kicker].team ? 'complete' : 'intercepted', o.id);
        } else if (b.kind === 'shot') endPass('complete', b.kicker);
        else if (b.kind === 'loose' && prev.kind === 'pass') endPass('loose');
      }
    }

    // ---- carries
    if (m.mode === 'play' && b.owner !== null && (b.kind === 'dribble' || b.kind === 'held')) {
      const p = m.players[b.owner];
      if (!carry || carry.id !== p.id) {
        endCarry(null);
        carry = {
          id: p.id,
          t0: +m.elapsed.toFixed(2),
          x0: p.x,
          y0: p.y,
          minOpp: 99,
          lastOpp: 99,
          back: 0,
          deepest: relX(p.x, p.team),
          furthest: relX(p.x, p.team),
          reversals: 0,
          lastSign: 0,
          signAt: p.x,
          ownBoxPressed: 0,
          noShot: 0,
          held: 0,
        };
      }
      const near = nearestOpp(p),
        rx = relX(p.x, p.team);
      carry.minOpp = Math.min(carry.minOpp, near);
      carry.lastOpp = near;
      carry.furthest = Math.max(carry.furthest, rx);
      carry.back = Math.max(carry.back, carry.furthest - rx);
      if (b.kind === 'held') carry.held += dt;
      // Direction reversals along the pitch (only counted once he has moved 2.5 m each way).
      const sign = Math.sign(p.vx * m.direction(p.team));
      if (sign && sign !== carry.lastSign && Math.abs(p.x - carry.signAt) > 2.5) {
        if (carry.lastSign) carry.reversals++;
        carry.lastSign = sign;
        carry.signAt = p.x;
      } else if (!carry.lastSign && sign) carry.lastSign = sign;
      const inOwnBox = rx < 16.5 && Math.abs(p.y - 34) < 20.16,
        goalDist = hyp(W - rx, p.y - 34);
      if (p.role !== 'GK' && inOwnBox && near < 2.5) carry.ownBoxPressed += dt;
      if (p.role !== 'GK' && goalDist < 11 && Math.abs(p.y - 34) < 9 && near > 2.2)
        carry.noShot += dt;
      else carry.noShot = Math.max(carry.noShot, 0) && carry.noShot; // keeps the longest spell
    } else if (carry && (b.owner === null || b.owner !== carry.id)) endCarry(null);

    // ---- loose balls
    if (m.mode === 'play' && b.owner === null && b.kind === 'loose') {
      loose ??= { t0: m.elapsed, ignored: 0, flagged: false, long: false };
      const speed = hyp(b.vx, b.vy);
      if (speed < 3 && b.z < 1 && b.x > 1 && b.x < W - 1 && b.y > 1 && b.y < H - 1) {
        let chased = false;
        for (const p of m.activePlayers) {
          const d = hyp(b.x - p.x, b.y - p.y);
          if (d > 25) continue;
          const closing = d > 0.01 ? ((b.x - p.x) * p.vx + (b.y - p.y) * p.vy) / d : 9;
          if (d < 1.5 || closing > 2) chased = true;
        }
        loose.ignored = chased ? 0 : loose.ignored + dt;
        if (loose.ignored >= 1 && !loose.flagged) {
          loose.flagged = true;
          add('loose-ignored', { x: Math.round(b.x), y: Math.round(b.y) });
        }
      }
      if (m.elapsed - loose.t0 >= 4 && !loose.long) {
        loose.long = true;
        add('loose-long', { from: +loose.t0.toFixed(2) });
      }
    } else loose = null;

    // ---- sampled every 6 steps (10 Hz)
    if (m.mode === 'play' && step % 6 === 0) {
      const tick = 0.1;
      let around = 0;
      for (const p of m.activePlayers) {
        if (p.role !== 'GK' && hyp(p.x - b.x, p.y - b.y) < 7) around++;
        // statues
        const moved = hyp(p.x - lastPos[p.id].x, p.y - lastPos[p.id].y);
        if (p.role !== 'GK' && moved < 0.03 && hyp(p.x - b.x, p.y - b.y) < 35) {
          still[p.id] += tick;
          if (still[p.id] >= 8 && !stillFlagged[p.id]) {
            stillFlagged[p.id] = true;
            add('statue', { player: p.name, intent: p.intent, action: p.action });
          }
        } else {
          still[p.id] = 0;
          stillFlagged[p.id] = false;
        }
        if (p.role === 'GK' && !p.emergencyKeeper && relX(p.x, p.team) > 26) totals.wander += tick;
      }
      if (around >= 8) totals.swarm += tick;
      if (b.owner !== null && b.kind === 'dribble') {
        const c = m.players[b.owner],
          rx = relX(c.x, c.team),
          inBoxes = (rx < 16.5 || rx > W - 16.5) && Math.abs(c.y - 34) < 20.16;
        if (
          !inBoxes &&
          m.activePlayers.some(q => q !== c && q.team === c.team && hyp(q.x - c.x, q.y - c.y) < 1.5)
        )
          totals.crowd += tick;
        if (rx > W - 16.5 && Math.abs(c.y - 34) < 20.16) {
          const defenders = opponents(c).filter(q => q.role !== 'GK');
          if (Math.min(...defenders.map(q => hyp(q.x - c.x, q.y - c.y))) > 5)
            totals.freeBox += tick;
        }
      }
    }
    for (const p of m.activePlayers) {
      if (m.mode === 'play' && prev.mode === 'play') {
        const d = hyp(p.x - prev.px[p.id], p.y - prev.py[p.id]);
        if (d > 16 / 60) add('teleport', { player: p.name, metres: +d.toFixed(2) });
      }
      if (step % 6 === 0) {
        lastPos[p.id].x = p.x;
        lastPos[p.id].y = p.y;
      }
    }

    // ---- events (newest first)
    const fresh = m.events.length - seenEvents;
    for (let i = fresh - 1; i >= 0; i--) {
      const e = m.events[i];
      if (e.type === 'shot' && !e.penalty && e.distance >= 28 && e.xg < 0.03)
        add('hopeless-shot', {
          player: name(e.playerId),
          distance: Math.round(e.distance),
          xg: e.xg,
        });
      if (e.type === 'goal') {
        if (e.ownGoal) add('own-goal', {});
        else if (!e.penalty && e.xg != null && e.xg < 0.04)
          add('soft-goal', { player: name(e.playerId), xg: e.xg, shotType: e.shotType });
      }
      if (e.type === 'offside') add('offside', { player: name(e.playerId) });
    }
    seenEvents = m.events.length;
    prev = cur;
  }
  endCarry(null);
  const shots = m.stats[0].shots + m.stats[1].shots,
    passes = m.stats[0].passes + m.stats[1].passes,
    completed = m.stats[0].completed + m.stats[1].completed;
  return {
    id: spec.id,
    seed: spec.seed,
    duration: spec.duration,
    teams: [spec.home.name, spec.away.name],
    score: [...m.score],
    elapsed: m.elapsed,
    totals,
    stats: { shots, passes, completed, goals: m.score[0] + m.score[1] },
    findings,
  };
}

function snapshot(m) {
  const b = m.ball,
    px = new Float32Array(22),
    py = new Float32Array(22);
  for (const p of m.players) {
    px[p.id] = p.x;
    py[p.id] = p.y;
  }
  return {
    mode: m.mode,
    restart: m.mode === 'restart' ? m.restart.type : null,
    kind: b.kind,
    owner: b.owner,
    kicker: b.kicker,
    age: b.age,
    px,
    py,
  };
}
const zone = rx => (rx < 35 ? 'own third' : rx < 70 ? 'middle' : 'final third');
function clock(m) {
  const minute = Math.floor(m.time / 60);
  return `${minute}'`;
}

// ---------------------------------------------------------------- report

function summarise(report) {
  const matches = report.results.length,
    per = Object.fromEntries(Object.keys(DETECTORS).map(k => [k, 0]));
  let play = 0,
    restart = 0;
  const restarts = {};
  for (const r of report.results) {
    for (const f of r.findings) per[f.type] = (per[f.type] || 0) + 1;
    per.swarm += r.totals.swarm;
    per['crowd-carrier'] += r.totals.crowd;
    per['free-in-box'] += r.totals.freeBox;
    per['keeper-wander'] += r.totals.wander;
    play += r.totals.play;
    restart += r.totals.restart;
    for (const [type, v] of Object.entries(r.totals.restarts)) {
      const t = (restarts[type] ??= { n: 0, seconds: 0 });
      t.n += v.n;
      t.seconds += v.seconds;
    }
  }
  const stats = report.results.reduce(
    (s, r) => ({
      shots: s.shots + r.stats.shots,
      passes: s.passes + r.stats.passes,
      completed: s.completed + r.stats.completed,
      goals: s.goals + r.stats.goals,
    }),
    { shots: 0, passes: 0, completed: 0, goals: 0 },
  );
  return {
    matches,
    perMatch: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v / matches])),
    inPlay: play / (play + restart),
    restarts: Object.fromEntries(
      Object.entries(restarts).map(([k, v]) => [
        k,
        { perMatch: v.n / matches, seconds: v.seconds / v.n },
      ]),
    ),
    goals: stats.goals / matches,
    shots: stats.shots / matches,
    passes: stats.passes / matches,
    completion: stats.completed / stats.passes,
  };
}

function printSummary(report, baseline = null) {
  const s = summarise(report),
    b = baseline && summarise(baseline),
    num = v => (v >= 10 ? v.toFixed(0) : v.toFixed(2)).padStart(7);
  console.log(
    `${s.matches} matches · goals ${s.goals.toFixed(2)} · shots ${s.shots.toFixed(1)} · passes ${s.passes.toFixed(0)} (${(s.completion * 100).toFixed(0)}%) · ball in play ${(s.inPlay * 100).toFixed(0)}%` +
      (b
        ? `   [before: goals ${b.goals.toFixed(2)} · shots ${b.shots.toFixed(1)} · in play ${(b.inPlay * 100).toFixed(0)}%]`
        : ''),
  );
  console.log(`\nper match${b ? '   before →   after' : ''}`);
  for (const [type, text] of Object.entries(DETECTORS)) {
    const v = s.perMatch[type] || 0;
    console.log(
      `${b ? num(b.perMatch[type] || 0) + ' →' : ''}${num(v)}  ${type.padEnd(17)} ${text}`,
    );
  }
  console.log('\nrestarts (per match, seconds each)');
  for (const [type, v] of Object.entries(s.restarts).sort((a, c) => c[1].perMatch - a[1].perMatch))
    console.log(
      `${num(v.perMatch)}  ${v.seconds.toFixed(1).padStart(5)} s  ${type}` +
        (b?.restarts[type]
          ? `   [before ${b.restarts[type].perMatch.toFixed(1)} × ${b.restarts[type].seconds.toFixed(1)} s]`
          : ''),
    );
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2),
    flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null),
    load = file => JSON.parse(readFileSync(file, 'utf8'));
  if (args.includes('--compare')) {
    const [a, c] = args.slice(args.indexOf('--compare') + 1);
    return printSummary(load(c), load(a));
  }
  if (args.includes('--summary')) return printSummary(load(flag('--summary')));
  const count = Number(flag('--matches') || 24),
    workers = Math.min(count, Number(flag('--workers') || 3)),
    engine = flag('--engine') || fileURLToPath(new URL('../../app', import.meta.url)),
    tuning = readTuning(flag('--tuning'));
  const started = performance.now(),
    results = [];
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: { engine, tuning, count, share: w, of: workers },
        });
        worker.on('message', r => {
          results.push(r);
          process.stderr.write(
            `\r${results.length}/${count} ${((performance.now() - started) / 1000).toFixed(0)}s`,
          );
        });
        worker.on('error', reject);
        worker.on('exit', resolve);
      });
    }),
  );
  process.stderr.write('\n');
  results.sort((a, c) => a.id - c.id);
  const report = { engine, results };
  if (flag('--out')) writeFileSync(flag('--out'), JSON.stringify(report));
  const list = flag('--list');
  if (list) {
    const limit = Number(flag('--limit') || 20),
      all = results.flatMap(r => r.findings.filter(f => f.type === list));
    // Spread the samples over the fixtures rather than taking the first match's.
    const stride = Math.max(1, Math.floor(all.length / limit));
    for (const f of all.filter((_, i) => i % stride === 0).slice(0, limit)) {
      const { type, fixture, at, clock: c, ...rest } = f;
      console.log(`--fixture ${fixture} --at ${at}  ${c.padStart(4)}  ${JSON.stringify(rest)}`);
    }
    console.log(`${all.length} ${list} findings in ${count} matches`);
  } else printSummary(report);
}

/** --tuning takes inline JSON ('{"gameplay":{"markingLapses":1.3}}') or a JSON file. */
function readTuning(value) {
  if (!value) return null;
  return JSON.parse(value.trim().startsWith('{') ? value : readFileSync(value, 'utf8'));
}

async function work() {
  const { engine, tuning, count, share, of } = workerData,
    { fixtures, buildMatch } = await loadFixtures(engine);
  for (const spec of fixtures(count).filter((_, i) => i % of === share))
    parentPort.postMessage(analyse(buildMatch(spec, tuning), spec));
}

if (isMainThread) await main();
else await work();
