import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { CONFIG } from '../app/core/config/config.js';
import {
  buildMatchConfig,
  createMatchRequest,
  requestMatch,
  readMatchResult,
  saveMatchResult,
  clearMatch,
  currentRequest,
  rematch,
  runResultFor,
  teamCode,
} from '../app/ui/lib/match-store.js';

const profiles = new Match(7, 180).exportConfig().players;
const side = (name, colors, formation = '433', extra = {}) => ({
  name,
  colors,
  formation,
  players: profiles.slice(0, 11).map(p => ({ ...p, chem: 1.5 })),
  ...extra,
});

test('buildMatchConfig makes an engine config that imports unchanged', () => {
  const config = buildMatchConfig({
    sides: [
      side('Liverpool', ['#c8102e', '#ffffff'], '4231', {
        tactics: { mentality: 'push', tempo: 9 },
      }),
      side('Arsenal', ['#ef0107', '#fbffff'], '442', { code: 'gb-eng' }),
    ],
    competition: { knockout: true },
  });
  assert.deepEqual(Object.keys(config).sort(), ['competition', 'players', 'teams', 'tuning']);
  assert.equal(config.players.length, 22);
  assert.deepEqual(config.competition, { mode: 'ai', difficulty: 'medium', knockout: true });
  assert.equal(config.teams[0].tactics.formation, '4231');
  assert.equal(config.teams[1].tactics.formation, '442');
  assert.equal(config.teams[0].tactics.mentality, 'push');
  assert.equal(config.teams[0].tactics.tempo, 5, 'tactic values are clamped like setTactic');
  assert.equal(config.teams[0].short, 'LIV');
  assert.equal(config.teams[1].code, 'gb-eng');
  // Red vs red: the away side changes into its secondary kit.
  assert.equal(config.teams[1].color, '#fbffff');
  assert.equal(config.players[0].chem, 1.5);
  assert.deepEqual(config.tuning, JSON.parse(JSON.stringify(CONFIG)));
  // JSON-safe and stable through the engine.
  const m = new Match(3, 180);
  m.importConfig(JSON.parse(JSON.stringify(config)));
  assert.deepEqual(m.exportConfig(), config);
});

test('buildMatchConfig rejects malformed sides', () => {
  assert.throws(() => buildMatchConfig({ sides: [side('A', [])] }), /two sides/);
  assert.throws(
    () => buildMatchConfig({ sides: [side('A', [], 'nope'), side('B', [])] }),
    /formation/,
  );
  const short = { ...side('B', []), players: profiles.slice(0, 10) };
  assert.throws(() => buildMatchConfig({ sides: [side('A', []), short] }), /eleven/);
});

test('requests get defaults, results round-trip and convert for the run', () => {
  const config = buildMatchConfig({
    sides: [side('France', ['#1d3c8f', '#ffffff']), side('Brazil', ['#f7d417', '#1d7a3a'])],
  });
  const r = createMatchRequest({ seed: 42, config, view: 'full' });
  assert.equal(r.id, 'match-16');
  assert.equal(r.duration, 180);
  assert.deepEqual(r.meta.userSides, [0]);
  assert.equal(r.meta.sides[1].kind, 'ai');
  assert.equal(r.meta.returnTo, '#/');
  assert.equal(createMatchRequest({ seed: 1, config, view: 'nope' }).view, 'key');
  assert.throws(() => createMatchRequest({ seed: 1, config: { teams: [] } }), /22 players/);

  requestMatch({ id: 'run:qf', seed: 9, config, meta: { context: 'run' } }, { go: false });
  assert.equal(currentRequest().id, 'run:qf');
  assert.equal(readMatchResult('run:qf'), null);
  const result = {
    id: 'run:qf',
    score: [1, 1],
    shootout: { score: [4, 5], winner: 1 },
    players: [
      { team: 0, profileId: 'a', rating: 7.1, goals: 1, assists: 0 },
      { team: 1, profileId: 'b', rating: 6.4, goals: 1, assists: 0 },
    ],
  };
  assert.equal(saveMatchResult({ ...result, id: 'other' }), false);
  assert.equal(saveMatchResult(result), true);
  assert.equal(readMatchResult('run:qf'), result);
  assert.equal(readMatchResult('nope'), null);
  assert.deepEqual(runResultFor(result, 0), {
    goalsFor: 1,
    goalsAgainst: 1,
    outcome: 'D',
    shootout: { winner: 'opponent', score: [4, 5] },
    players: [{ profileId: 'a', rating: 7.1, goals: 1, assists: 0 }],
  });
  assert.equal(runResultFor(result, 1).shootout.winner, 'user');
  const again = rematch();
  assert.equal(again.id, 'run:qf');
  assert.notEqual(again.seed, 9);
  assert.equal(readMatchResult(), null, 'a rematch clears the old result');
  clearMatch('other');
  assert.ok(currentRequest());
  clearMatch('run:qf');
  assert.equal(currentRequest(), null);
});

test('teamCode gives broadcast codes', () => {
  assert.deepEqual(
    ['Real Madrid', 'Arsenal', 'Paris Saint-Germain', 'Manchester City', "Côte d'Ivoire"].map(
      teamCode,
    ),
    ['RMA', 'ARS', 'PSG', 'MCI', 'CIV'],
  );
});
