// Paired before/after evidence, not an enforced match-rate target.
// node tests/long-ball-calibration.mjs /tmp/long-balls.json
import { readFileSync, writeFileSync } from 'node:fs';
import { randomLineups } from '../app/lineups.js';
const { Match } = await import(process.env.CALIBRATION_ENGINE || '../app/engine.js');

const profiles = JSON.parse(
  readFileSync(new URL('../app/data/players-runtime.json', import.meta.url)),
).players;
const rows = [];
const seeds = Array.from(
  { length: Number(process.argv[4] || 3) },
  (_, i) => Number(process.argv[3] || 4301) + i,
);
for (const duration of [180, 300])
  for (const roster of ['paired', 'catalog'])
    for (const seed of seeds) {
      const m = new Match(seed, duration);
      if (roster === 'catalog') {
        const c = m.exportConfig();
        c.players = randomLineups(m.players, profiles, seed);
        m.importConfig(c);
      }
      const deliveries = [],
        pass = m.pass,
        own = m.own;
      let active = null;
      m.pass = function (p, o, restart) {
        if (o) {
          const length = Math.hypot(o.aim.x - p.x, o.aim.y - p.y);
          active = {
            length,
            loft: !!o.loft || o.delivery === 'cross',
            delivery: o.delivery || 'pass',
            switch:
              length >= 28 && Math.abs(o.aim.y - p.y) >= 24 && (o.aim.y - 34) * (p.y - 34) < 0,
            keeper: p.role === 'GK',
            completed: false,
          };
          deliveries.push(active);
        }
        return pass.call(this, p, o, restart);
      };
      m.own = function (p, ...args) {
        const completed = this.stats.reduce((sum, s) => sum + s.completed, 0),
          result = own.call(this, p, ...args);
        if (active && this.stats.reduce((sum, s) => sum + s.completed, 0) > completed)
          active.completed = true;
        active = null;
        return result;
      };
      let steps = 0;
      while (!m.finished && steps++ < 30000) m.step(1 / 60);
      if (!m.finished) throw Error('Match did not finish');
      const sum = key => m.stats.reduce((n, s) => n + s[key], 0),
        long = deliveries.filter(d => d.length >= 28),
        longOpen = long.filter(d => !['cross', 'cutback', 'clearance'].includes(d.delivery));
      const row = {
        seed,
        duration,
        roster,
        goals: m.score[0] + m.score[1],
        shots: sum('shots'),
        passes: sum('passes'),
        completed: sum('completed'),
        longBalls: longOpen.length,
        loftedLongBalls: longOpen.filter(d => d.loft).length,
        longSwitches: longOpen.filter(d => d.switch).length,
        longThroughBalls: longOpen.filter(d => d.delivery === 'through').length,
        longClearances: long.filter(d => d.delivery === 'clearance').length,
        outfieldClearances: long.filter(d => d.delivery === 'clearance' && !d.keeper).length,
        longCompleted: long.filter(d => d.completed).length,
        longAttempts: long.length,
        keeperLosses: sum('keeperLosses'),
        offsides: sum('offsides'),
      };
      rows.push(row);
      writeFileSync(process.argv[2], JSON.stringify(rows, null, 2) + '\n');
      console.log(JSON.stringify(row));
    }
