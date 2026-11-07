// Read-only observers. Output retains individual loss reasons and 32 fixed real-roster cases.
// DETAILS=1 includes delivery, pressure, aim error and receiving traces.
// CALIBRATION_ENGINE=file:///path/engine.mjs CASE_LIMIT=1 node retention-calibration.mjs output.json
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { Match } = await import(
  process.env.CALIBRATION_ENGINE || new URL('../../app/core/sim/engine.js', import.meta.url)
);
const catalog = JSON.parse(
  readFileSync(new URL('../../app/data/players-runtime.json', import.meta.url)),
).players;
const byId = new Map(catalog.map(p => [p.profileId, p]));
const allCases = JSON.parse(
  readFileSync(
    process.env.CALIBRATION_FIXTURES ||
      new URL('../../tests/fixtures/retention-squads.json', import.meta.url),
  ),
).map(c => ({ ...c, config: { teams: c.teams, players: c.profiles.map(id => byId.get(id)) } }));
const cases = allCases
    .filter(c => !process.env.CASE_ARCHETYPE || c.archetype === process.env.CASE_ARCHETYPE)
    .slice(0, Number(process.env.CASE_LIMIT) || Infinity),
  rows = [];
const sum = (m, key) => m.stats.reduce((n, s) => n + (s[key] || 0), 0);
const segmentGap = (p, a, b) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};
export function observe(m) {
  let team = null,
    cause = null,
    active = null,
    flight = null,
    stepStart = null;
  const losses = [],
    passes = [],
    receipts = [],
    shotEnds = [],
    misc = { heavyTouches: 0, miscontrols: 0 };
  const player = p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    role: p.role,
    control: p.skill('control'),
    energy: p.energy,
    x: p.x,
    y: p.y,
    pressure: m.pressure(p),
  });
  const classify = end => {
    if (end.restart === 'Offside') return 'Offside';
    if (end.restart === 'Indirect free kick') return 'Illegal second touch';
    if (['Free kick', 'Penalty'].includes(end.restart)) return 'Foul conceded';
    if (cause?.type === 'shot') return 'Shot ended possession';
    if (cause?.type === 'tackle') return 'Tackled off the ball';
    if (cause?.type === 'takeon') return 'Failed take-on';
    if (cause?.type === 'heavy') return 'Heavy dribbling touch';
    if (cause?.type === 'pass') {
      const p = cause.pass;
      if (p.miscontrols.some(q => q.team === team && q.teammate)) return 'Receiving miscontrol';
      if (
        !p.teammateAttempts &&
        p.minGroundGap < 1.85 &&
        !(end.type === 'controlled' && m.elapsed - p.closestAt < 1 / 60 + 0.00001)
      )
        return 'Uncollected pass near intended receiver';
      if (end.type === 'controlled')
        return p.miscontrols.some(q => q.team !== team)
          ? 'Opponent deflection, then recovery'
          : 'Clean interception';
      if (end.type === 'restart')
        return p.miscontrols.length
          ? 'Deflected pass out of play'
          : 'Pass out without a control attempt';
      return 'Other pass loss';
    }
    if (['Throw-in', 'Goal kick', 'Corner'].includes(end.restart))
      return 'Carried ball out of play';
    return 'Other';
  };
  const lose = end => {
    const reason = classify(end),
      row = {
        team,
        at: m.elapsed,
        half: m.half,
        reason,
        cause: cause?.type || 'carry',
        player: cause?.player?.name || null,
        to: cause?.pass?.receiver || null,
        passId: cause?.pass?.number ?? null,
        groundGap: cause?.pass?.minGroundGap ?? null,
        end,
      };
    (reason === 'Shot ended possession' ? shotEnds : losses).push(row);
  };
  const resolve = result => {
    if (active) {
      active.result = result;
      active = null;
    }
  };
  const scanMiscontrols = () => {
    if (!flight) return;
    for (const p of m.players) {
      const count = p.stats.miscontrols - flight.seen[p.id];
      if (count <= 0) continue;
      flight.seen[p.id] = p.stats.miscontrols;
      misc.miscontrols += count;
      for (let i = 0; i < count; i++) {
        const teammate = flight.kind === 'pass' && flight.team === p.team && flight.failures === 0;
        const q = {
          ...player(p),
          passId: active?.number ?? null,
          teammate,
          at: m.elapsed,
          height: flight.z,
          speed: flight.speed,
          success: false,
        };
        if (active) {
          active.miscontrols.push(q);
          if (teammate) active.teammateAttempts++;
        }
        if (teammate) receipts.push(q);
        flight.failures++;
      }
    }
  };
  const heavy = () => {
    if (!stepStart || stepStart.owner == null) return;
    const p = m.players[stepStart.owner];
    if (p.action === 'Heavy touch' && p.stats.miscontrols > stepStart.miscontrols) {
      misc.heavyTouches += p.stats.miscontrols - stepStart.miscontrols;
      cause = { type: 'heavy', player: player(p) };
      stepStart.miscontrols = p.stats.miscontrols;
    }
  };
  const methods = Object.fromEntries(
    [
      'own',
      'pass',
      'shoot',
      'startRestart',
      'finishPeriod',
      'stepRestart',
      'step',
      'moveBall',
      'duel',
      'feint',
      'checkBounds',
    ].map(k => [k, m[k]]),
  );
  m.own = function (p, ...args) {
    scanMiscontrols();
    const incoming = {
        kind: this.ball.kind,
        kicker: this.ball.kicker,
        pending: this.ball.pendingPass,
        z: this.ball.z,
        speed: Math.hypot(this.ball.vx, this.ball.vy),
      },
      oldCompleted = sum(this, 'completed');
    const success = methods.own.call(this, p, ...args);
    if (success) {
      if (
        incoming.kind === 'pass' &&
        incoming.kicker != null &&
        this.players[incoming.kicker].team === p.team
      ) {
        const r = {
          ...player(p),
          passId: active?.number ?? null,
          success: true,
          at: this.elapsed,
          height: incoming.z,
          speed: incoming.speed,
        };
        receipts.push(r);
        if (active) active.teammateAttempts++;
      }
      if (team != null && team !== p.team) lose({ type: 'controlled', by: p.name, team: p.team });
      if (active)
        resolve(
          p.team !== active.team
            ? 'opponent'
            : sum(this, 'completed') > oldCompleted
              ? 'completed'
              : 'retained-no-credit',
        );
      team = p.team;
      cause = null;
    }
    return success;
  };
  m.pass = function (p, o, ...args) {
    if (!o) return methods.pass.call(this, p, o, ...args);
    assert.equal(active, null, 'Previous pass resolved before next pass');
    team ??= p.team;
    const entry = {
      holdAtRelease: p.hold,
      passerPressure: this.pressure(p),
      receiverPressureAtKick: this.pressure(o.r),
      aimFromReceiver: Math.hypot(o.aim.x - o.r.x, o.aim.y - o.r.y),
      number: passes.length + 1,
      team: p.team,
      passer: p.name,
      receiver: o.r.name,
      to: o.r.id,
      at: this.elapsed,
      distance: Math.hypot(o.aim.x - p.x, o.aim.y - p.y),
      delivery: o.delivery || 'pass',
      loft: !!o.loft || o.delivery === 'cross',
      teammateAttempts: 0,
      miscontrols: [],
      minGroundGap: 999,
      closestAt: null,
    };
    const result = methods.pass.call(this, p, o, ...args);
    entry.targetError = Math.hypot(
      this.ball.destination.x - o.aim.x,
      this.ball.destination.y - o.aim.y,
    );
    active = entry;
    passes.push(entry);
    cause = { type: 'pass', pass: entry, player: player(p) };
    return result;
  };
  m.shoot = function (p, ...args) {
    team ??= p.team;
    cause = { type: 'shot', player: player(p) };
    return methods.shoot.call(this, p, ...args);
  };
  m.startRestart = function (type, restartTeam, ...args) {
    heavy();
    if (team != null && type !== 'Goal' && type !== 'Second half' && restartTeam !== team)
      lose({ type: 'restart', restart: type, team: restartTeam });
    resolve('restart');
    team = null;
    cause = null;
    return methods.startRestart.call(this, type, restartTeam, ...args);
  };
  m.finishPeriod = function (...args) {
    resolve('period-end');
    team = null;
    cause = null;
    return methods.finishPeriod.apply(this, args);
  };
  m.stepRestart = function (dt) {
    if (this.restart.timer <= dt) {
      team = this.restart.team;
      cause = null;
    }
    return methods.stepRestart.call(this, dt);
  };
  m.checkBounds = function (...args) {
    heavy();
    return methods.checkBounds.apply(this, args);
  };
  m.step = function (dt) {
    const owner = this.ball.owner;
    stepStart =
      owner == null ? null : { owner, miscontrols: this.players[owner].stats.miscontrols };
    const result = methods.step.call(this, dt);
    heavy();
    stepStart = null;
    return result;
  };
  m.moveBall = function (dt) {
    const b = this.ball,
      prev = { x: b.x, y: b.y },
      next = { x: b.x + b.vx * dt, y: b.y + b.vy * dt };
    flight = {
      kind: b.kind,
      team: b.kicker != null ? this.players[b.kicker].team : null,
      z: Math.max(0, b.z + b.vz * dt),
      speed: Math.hypot(b.vx, b.vy),
      seen: this.players.map(p => p.stats.miscontrols),
      failures: 0,
    };
    if (active && b.kind === 'pass' && flight.z < 0.3) {
      const d = segmentGap(this.players[active.to], prev, next);
      if (d < active.minGroundGap) {
        active.minGroundGap = d;
        active.closestAt = this.elapsed;
      }
    }
    const result = methods.moveBall.call(this, dt);
    scanMiscontrols();
    flight = null;
    return result;
  };
  m.duel = function (p, q) {
    const old = this.pendingTackle,
      owner = this.ball.owner,
      result = methods.duel.call(this, p, q);
    if (
      this.pendingTackle &&
      this.pendingTackle !== old &&
      owner === p.id &&
      this.ball.owner === null
    )
      cause = { type: 'tackle', player: player(p) };
    return result;
  };
  m.feint = function (p, q) {
    const owner = this.ball.owner,
      result = methods.feint.call(this, p, q);
    if (owner === p.id && this.ball.owner === null) cause = { type: 'takeon', player: player(p) };
    return result;
  };
  return { losses, passes, receipts, shotEnds, misc };
}
const finish = m => {
  let frames = 0;
  while (!m.finished && frames++ < 40000) m.step(1 / 60);
  assert.ok(m.finished, 'Match must end');
};
for (const c of cases) {
  const m = new Match(c.seed, c.duration);
  m.importConfig(c.config);
  const log = observe(m);
  finish(m);
  const categories = Object.fromEntries(
    [...new Set(log.losses.map(l => l.reason))].map(k => [
      k,
      log.losses.filter(l => l.reason === k).length,
    ]),
  );
  const row = {
    id: c.id,
    archetype: c.archetype,
    seed: c.seed,
    duration: c.duration,
    overall: c.summary.overall,
    outfieldRetention: c.summary.outfieldRetention,
    goals: m.score.reduce((n, g) => n + g, 0),
    score: m.score,
    shots: sum(m, 'shots'),
    fouls: sum(m, 'fouls'),
    yellowCards: sum(m, 'yellowCards'),
    redCards: sum(m, 'redCards'),
    secondYellows: m.events.filter(e => e.type === 'red' && e.secondYellow).length,
    clearances: log.passes.filter(p => p.delivery === 'clearance').length,
    offTarget: sum(m, 'offTarget'),
    blocked: sum(m, 'blocked'),
    onTarget: sum(m, 'onTarget'),
    saves: sum(m, 'saves'),
    boxShots: sum(m, 'boxShots'),
    boxGoals: sum(m, 'boxGoals'),
    passes: sum(m, 'passes'),
    completed: sum(m, 'completed'),
    passAccuracy: (100 * sum(m, 'completed')) / sum(m, 'passes'),
    turnovers: log.losses.length,
    turnoversByTeam: [0, 1].map(t => log.losses.filter(l => l.team === t).length),
    categories,
    receivingAttempts: log.receipts.length,
    receivingMiscontrols: log.receipts.filter(r => !r.success).length,
    miscontrols: sum(m, 'miscontrols'),
    heavyTouches: log.misc.heavyTouches,
    longBalls: log.passes.filter(
      p => p.distance >= 28 && !['cross', 'cutback', 'clearance'].includes(p.delivery),
    ).length,
    losses: log.losses,
    passDetails: process.env.DETAILS === '1' ? log.passes : undefined,
    receiptDetails: process.env.DETAILS === '1' ? log.receipts : undefined,
  };
  assert.equal(log.passes.length, row.passes);
  assert.equal(log.passes.filter(p => p.result === 'completed').length, row.completed);
  assert.equal(log.misc.miscontrols + log.misc.heavyTouches, row.miscontrols);
  if (process.env.VALIDATE_OBSERVER === '1') {
    const raw = new Match(c.seed, c.duration);
    raw.importConfig(c.config);
    finish(raw);
    assert.deepEqual(
      { rng: m.rng, stats: m.stats, score: m.score, elapsed: m.elapsed },
      { rng: raw.rng, stats: raw.stats, score: raw.score, elapsed: raw.elapsed },
    );
    row.observerValidated = true;
  }
  rows.push(row);
  writeFileSync(process.argv[2], JSON.stringify(rows, null, 2) + '\n');
  console.log(
    JSON.stringify({
      ...row,
      losses: undefined,
      passDetails: undefined,
      receiptDetails: undefined,
    }),
  );
}
