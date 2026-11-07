import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { POSITIONS, positionFamiliarity } from '../app/core/players/ratings.js';
import { FORMATIONS } from '../app/core/players/formations.js';
import { CONFIG } from '../app/core/config/config.js';
import { BADGES } from '../app/core/players/traits.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { clubRating } from '../app/core/players/team-ratings.js';
import {
  assignClubLineup,
  clubLineupStamp,
  clubRatingStamp,
  clubSquads,
} from '../app/core/players/club-lineups.js';
import { badgeStamp } from '../app/core/players/catalog-derived.js';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';

const catalog = loadRuntimeCatalog(),
  { players, teams, leagues, nations } = catalog;
const flags = new URL('../app/assets/flags/', import.meta.url);

test('players have unique ids, valid positions, badges and a known nationality', () => {
  assert.equal(new Set(players.map(p => p.profileId)).size, players.length);
  const badges = new Set(BADGES.map(b => b.id)),
    nationNames = new Set(nations.map(n => n.name));
  for (const p of players) {
    assert.ok(POSITIONS.includes(p.primaryPosition), p.profileId);
    assert.ok(p.secondaryPositions.every(s => POSITIONS.includes(s) && s !== p.primaryPosition));
    assert.equal(new Set(p.secondaryPositions).size, p.secondaryPositions.length);
    assert.ok(p.tags.every(t => badges.has(t)));
    assert.ok(p.name && typeof p.fullName === 'string');
    assert.ok(['left', 'right'].includes(p.foot));
    assert.ok(nationNames.has(p.source.nationality), p.source.nationality);
  }
});

test('the nations table matches the players and every flag file ships', () => {
  assert.equal(new Set(nations.map(n => n.name)).size, nations.length);
  const names = nations.map(n => n.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  for (const n of nations) {
    const own = catalog.byNation.get(n.name);
    assert.equal(n.players, own.length, n.name);
    assert.equal(n.goalkeepers, own.filter(p => p.primaryPosition === 'GK').length, n.name);
    assert.match(n.code, /^[a-z]{2}(-[a-z]{3})?$/);
    assert.equal(n.flag, `./assets/flags/${n.code}.svg`);
    assert.ok(existsSync(new URL(`../app/${n.flag}`, import.meta.url)), n.flag);
  }
  assert.equal(
    nations.reduce((s, n) => s + n.players, 0),
    players.length,
  );
  const shipped = readdirSync(flags).filter(f => f.endsWith('.svg'));
  assert.deepEqual(shipped.sort(), [...new Set(nations.map(n => `${n.code}.svg`))].sort());
  assert.match(readFileSync(new URL('LICENSE', flags), 'utf8'), /MIT License/);
  for (const file of shipped) {
    const svg = readFileSync(new URL(file, flags), 'utf8');
    assert.match(svg, /^<svg [^>]*viewBox="0 0 640 480"/, file);
    assert.ok(svg.length < 70_000, file);
  }
});

test('clubs and leagues are consistent; club-less players never reach league or club pools', () => {
  const teamIds = new Set(teams.map(t => t.id)),
    leagueIds = new Set(leagues.map(l => l.id));
  for (const p of players)
    if (p.source.clubId == null) {
      assert.equal(p.source.club, null);
      assert.equal(p.source.leagueId, null);
    } else {
      assert.ok(teamIds.has(p.source.clubId));
      assert.ok(leagueIds.has(p.source.leagueId));
    }
  for (const t of teams) {
    assert.ok(leagueIds.has(t.leagueId), t.name);
    assert.equal(t.playerCount, catalog.byClub.get(t.id)?.length ?? 0, t.name);
  }
  for (const l of leagues)
    assert.equal(l.playerCount, catalog.byLeague.get(l.id)?.length ?? 0, l.name);
  const pooled = new Set(clubSquads(catalog).flatMap(c => c.players));
  assert.ok(players.every(p => pooled.has(p) === (p.source.clubId != null)));
});

test('precomputed values match the live configuration and today’s code', () => {
  assert.deepEqual(catalog.precomputed, {
    badges: badgeStamp(),
    clubRatings: clubRatingStamp(),
    lineups: clubLineupStamp(),
  });
  assert.deepEqual(catalog.formations, Object.keys(FORMATIONS));
  for (const p of players) assert.deepEqual(normalizeBadges(p, p.tags), p.tags, p.profileId);
  for (const t of teams) {
    const rating = clubRating(catalog.byClub.get(t.id) || []);
    assert.deepEqual(
      [t.overall, t.sampleSize, t.tier],
      [rating.overall, rating.sampleSize, rating.tier],
    );
  }
  // Recompute a deterministic sample of club lineups with the Hungarian assignment.
  teams.forEach((t, i) => {
    if (i % 7) return;
    const squad = [...(catalog.byClub.get(t.id) || [])];
    for (const f of Object.keys(FORMATIONS))
      assert.deepEqual(
        assignClubLineup(squad, f)?.map(p => p.profileId) ?? null,
        t.lineups[f]?.map(p => p.profileId) ?? null,
        `${t.name} ${f}`,
      );
  });
});

test('every precomputed XI has one keeper and ten distinct outfield club members at familiarity >= 0.85', () => {
  let lineups = 0;
  for (const t of teams) {
    const members = new Set(catalog.byClub.get(t.id) || []);
    for (const [formation, xi] of Object.entries(t.lineups)) {
      const rows = FORMATIONS[formation];
      assert.equal(xi.length, 11);
      assert.equal(new Set(xi).size, 11);
      assert.equal(xi.filter(p => p.primaryPosition === 'GK').length, 1);
      assert.equal(xi[0].primaryPosition, 'GK');
      xi.forEach((p, i) => {
        assert.ok(members.has(p), `${t.name} ${formation}`);
        assert.ok(positionFamiliarity(p, rows[i][2]) >= CONFIG.ai.minimumFit);
        assert.ok(CONFIG.ai.minimumFit >= 0.85);
      });
      lineups++;
    }
    if (t.bestFormation) assert.ok(t.lineups[t.bestFormation]);
    else assert.deepEqual(t.lineups, {});
  }
  assert.ok(lineups > teams.length * 5);
});
