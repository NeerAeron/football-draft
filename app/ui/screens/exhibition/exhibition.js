// Exhibition (#/exhibition): any two teams — club best XIs, national XIs, the World XI /
// All-Stars, or random XIs — with search and league filters → pre-match → match → back here
// with the result. The selection is remembered ('football-draft-exhibition').
import { useEffect, useMemo, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { readJSON, writeJSON } from '../../lib/storage.js';
import { loadWarmCatalog } from '../../lib/catalog-warm.js';
import { opponentCandidates, buildOpponent } from '../../../core/draft/opponents.js';
import { buildSide } from '../../../core/draft/session.js';
import { randomLineups } from '../../../core/players/lineups.js';
import { FORMATIONS, formationLabel } from '../../../core/players/formations.js';
import { searchKey } from '../../../core/util/text.js';
import { Button, IconButton } from '../../components/button.js';
import { Tabs } from '../../components/tabs.js';
import { ChipGroup } from '../../components/chip.js';
import { Icon } from '../../components/icon.js';
import { LeagueLogo } from '../../components/crest.js';
import { Skeleton } from '../../components/skeleton.js';
import { EmptyState } from '../../components/empty-state.js';
import { openPrematch } from '../../lib/prematch-store.js';
import { readMatchResult, clearMatch, matchStore } from '../../lib/match-store.js';
import { matchSideFor } from '../../lib/run-store.js';
import { sideColors } from '../../lib/kits.js';
import { TeamMark } from '../run/run-parts.js';
import { xiViews } from '../run/team-view.js';
import { PitchView } from '../../components/pitch-view.js';
import { fmt1 } from '../../lib/format.js';

const KEY = 'football-draft-exhibition';
const PAGE = 40;
const RANDOM_KITS = [
  ['#ff6f61', '#16213a'],
  ['#5cc8ff', '#16213a'],
];
const randomSeed = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(buf);
  return buf[0] >>> 0 || 7;
};

/** A team choice: { key, kind, id, name, code, colors, rating, effective, formation, league? }. */
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

function teamFromCandidate(c, leagues) {
  return {
    key: c.key,
    kind: c.kind,
    id: c.id,
    name: c.name,
    code: c.code,
    colors: sideColors(c),
    color: c.color,
    secondary: c.secondary,
    rating: c.rating,
    effective: c.effective,
    formation: c.formation,
    league: c.leagueId ? leagues.get(String(c.leagueId)) : null,
    ref: c,
  };
}
function randomTeam(catalog, seed, side) {
  const formation = '433';
  const slots = FORMATIONS[formation].map(([, , role]) => ({ role }));
  const players = randomLineups(slots, catalog.players, seed);
  const [color, secondary] = RANDOM_KITS[side % 2];
  const built = buildSide({ name: 'Random XI', color, secondary, formation, players });
  return {
    key: `random:${seed}`,
    kind: 'random',
    id: String(seed),
    name: 'Random XI',
    code: null,
    colors: [color, secondary],
    color,
    secondary,
    rating: built.rating,
    effective: built.effective,
    formation,
    side: built,
  };
}
function resolveTeam(catalog, byKey, leagues, key, side) {
  if (!key) return null;
  if (key.startsWith('random:')) {
    const seed = Number(key.slice(7)) >>> 0;
    try {
      return randomTeam(catalog, seed || 7, side);
    } catch {
      return null;
    }
  }
  const c = byKey.get(key);
  return c ? teamFromCandidate(c, leagues) : null;
}
/** The engine-ready side for a team choice. */
function sideOf(catalog, team) {
  if (team.side) return team.side;
  return buildOpponent(catalog, team.ref) || null;
}
const KIND_LABEL = { club: 'Club', nation: 'National team', boss: 'Legends', random: 'Random' };
const teamMeta = t =>
  t.kind === 'club'
    ? t.league?.name || 'Club'
    : t.kind === 'nation'
      ? 'National team'
      : t.kind === 'boss'
        ? 'Best players in the game'
        : 'Eleven random players';

function TeamSlot({ team, side, active, onActivate, onRandom }) {
  return html`<button
    type="button"
    class=${cx('ex-slot', active && 'is-active', !team && 'is-empty')}
    onClick=${onActivate}
    aria-pressed=${active}
    data-testid=${`slot-${side}`}
  >
    <span class="ex-slot__side">${side === 0 ? 'Home' : 'Away'}</span>
    ${
      team
        ? html`<${TeamMark} team=${team} size=${72} />
            <span class="ex-slot__name">${team.name}</span>
            <span class="ex-slot__meta">${teamMeta(team)}</span>
            <span class="ex-slot__stats">
              <span><b class="num">${fmt1(team.rating)}</b> OVR</span>
              <span>${formationLabel(team.formation)}</span>
            </span>`
        : html`<span class="ex-slot__plus" aria-hidden="true"
              ><${Icon} name="plus" size=${28}
            /></span>
            <span class="ex-slot__name">Pick a team</span>
            <span class="ex-slot__meta">${active ? 'Choose below' : 'Tap to choose'}</span>`
    }
    <span class="ex-slot__hint">${active ? 'Picking' : 'Change'}</span>
    ${onRandom && null}
  </button>`;
}

function TeamList({ items, selected, onPick, limit, onMore }) {
  if (!items.length)
    return html`<${EmptyState}
      icon="search"
      size="sm"
      title="No teams found"
      message="Try another name or filter."
    />`;
  return html`<ul class="ex-list" role="list">
      ${items.slice(0, limit).map(
        t =>
          html`<li key=${t.key}>
            <button
              type="button"
              class=${cx('ex-team', selected.includes(t.key) && 'is-selected')}
              onClick=${() => onPick(t)}
              aria-pressed=${selected.includes(t.key)}
            >
              <${TeamMark} team=${t} size=${32} />
              <span class="ex-team__text">
                <span class="ex-team__name truncate">${t.name}</span>
                <span class="ex-team__meta truncate">${teamMeta(t)}</span>
              </span>
              ${
                t.league?.logo &&
                html`<${LeagueLogo}
                  src=${t.league.logo}
                  name=${t.league.name}
                  size=${24}
                  decorative
                />`
              }
              <span class="ex-team__rating num">${fmt1(t.rating)}</span>
            </button>
          </li>`,
      )}
    </ul>
    ${
      items.length > limit &&
      html`<${Button} variant="ghost" block onClick=${onMore}
        >${`Show more (${items.length - limit})`}<//
      >`
    }`;
}

export default function ExhibitionScreen() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const saved = useMemo(() => readJSON(KEY, {}) || {}, []);
  const [keys, setKeys] = useState([saved.home || null, saved.away || null]);
  const [active, setActive] = useState(saved.home ? (saved.away ? 1 : 1) : 0);
  const [tab, setTab] = useState('club');
  const [query, setQuery] = useState('');
  const [league, setLeague] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [last, setLast] = useState(null);

  useEffect(() => {
    let live = true;
    loadWarmCatalog()
      .then(async catalog => {
        if (!live) return;
        const leagues = new Map(catalog.leagues.map(l => [String(l.id), l]));
        // Every club and nation XI (~170 ms once): its own task, then render in the next.
        await nextTask();
        const list = opponentCandidates(catalog);
        await nextTask();
        if (!live) return;
        const byKey = new Map(list.map(c => [c.key, c]));
        const teams = list.map(c => teamFromCandidate(c, leagues));
        setData({ catalog, leagues, byKey, teams });
        // Back from a match: show its result once.
        const req = matchStore.get()?.request;
        if (req?.meta?.context === 'exhibition') {
          const result = readMatchResult(req.id);
          if (result) setLast(result);
          clearMatch(req.id);
        }
        if (!saved.home && !saved.away) {
          // A tasty default: the two strongest clubs.
          const clubs = teams.filter(t => t.kind === 'club');
          setKeys([clubs[0]?.key || null, clubs[1]?.key || null]);
          setActive(1);
        }
      })
      .catch(e => live && setError(e));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (keys[0] || keys[1]) writeJSON(KEY, { home: keys[0], away: keys[1] });
  }, [keys]);

  const teams = useMemo(() => {
    if (!data) return [null, null];
    return keys.map((k, i) => resolveTeam(data.catalog, data.byKey, data.leagues, k, i));
  }, [data, keys]);

  // Both XIs for the line-up preview (built once per team choice).
  const lineups = useMemo(
    () =>
      teams.map(t => {
        if (!t || !data) return null;
        const side = sideOf(data.catalog, t);
        return side ? { formation: side.formation, views: xiViews(data.catalog, side) } : null;
      }),
    [teams[0]?.key, teams[1]?.key, data],
  );

  const leagueOptions = useMemo(() => {
    if (!data) return [];
    const counts = new Map();
    for (const t of data.teams)
      if (t.kind === 'club' && t.league)
        counts.set(t.league.id, (counts.get(t.league.id) || 0) + 1);
    const top = data.catalog.leagues
      .filter(l => counts.has(l.id))
      .sort((a, b) => (a.optaRank ?? 99) - (b.optaRank ?? 99))
      .slice(0, 12);
    return [
      { value: 'all', label: 'All leagues' },
      ...top.map(l => ({
        value: String(l.id),
        label: l.name.replace(/^(English|Spanish|Italian|German|French) /, ''),
      })),
    ];
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = searchKey(query.trim());
    return data.teams.filter(t => {
      if (tab === 'club' && t.kind !== 'club') return false;
      if (tab === 'nation' && t.kind !== 'nation') return false;
      if (tab === 'boss' && t.kind !== 'boss') return false;
      if (tab === 'club' && league !== 'all' && String(t.league?.id) !== league) return false;
      if (q && !searchKey(`${t.name} ${t.league?.name || ''}`).includes(q)) return false;
      return true;
    });
  }, [data, tab, query, league]);

  const pick = team => {
    setKeys(k => {
      const next = [...k];
      next[active] = team.key;
      return next;
    });
    if (active === 0 && !keys[1]) setActive(1);
  };
  const rollRandom = () => pick({ key: `random:${randomSeed()}` });
  const swap = () => setKeys(([a, b]) => [b, a]);
  const randomMatchup = () => {
    if (!data) return;
    const pool = data.teams.filter(t => t.kind === 'club' || t.kind === 'nation');
    const seed = randomSeed();
    const a = pool[seed % pool.length],
      b = pool[(seed >>> 8) % pool.length];
    setKeys([a.key, (b.key === a.key ? pool[(seed + 1) % pool.length] : b).key]);
  };

  const kickOff = () => {
    const [home, away] = teams;
    const sides = [sideOf(data.catalog, home), sideOf(data.catalog, away)];
    if (sides.some(s => !s)) return;
    const seed = randomSeed();
    openPrematch({
      id: `exhibition:${seed.toString(36)}`,
      seed,
      sides: [
        { ...matchSideFor(sides[0], { kind: 'user', editable: true }), colors: home.colors },
        { ...matchSideFor(sides[1], { kind: 'ai', editable: false }), colors: away.colors },
      ],
      competition: { mode: 'ai', difficulty: 'medium', knockout: false },
      meta: { context: 'exhibition', title: 'Exhibition', returnTo: '/exhibition' },
    });
  };

  if (error)
    return html`<div class="screen container-narrow" data-screen="exhibition">
      <${EmptyState}
        icon="triangle-alert"
        tone="coral"
        level=${1}
        title="Teams could not load"
        action=${html`<${Button} variant="primary" onClick=${() => location.reload()}>Retry<//>`}
      />
    </div>`;

  const ready = teams[0] && teams[1] && teams[0].key !== teams[1].key;
  return html`<div class="screen container exhibition" data-screen="exhibition">
    <header class="ex-head">
      <div>
        <p class="eyebrow">No draft · one match</p>
        <h1 class="ex-title">Exhibition</h1>
      </div>
      <div class="ex-head__tools">
        <${IconButton}
          icon="arrow-up-down"
          label="Swap home and away"
          onClick=${swap}
          variant="secondary"
        />
        <${Button} icon="dices" variant="secondary" onClick=${randomMatchup} disabled=${!data}
          >Random matchup<//
        >
      </div>
    </header>

    ${
      last &&
      html`<section
        class="ex-last card card--pad-sm"
        aria-label="Last result"
        data-testid="exhibition-last"
      >
        <${Icon} name="whistle" size=${18} />
        <span class="ex-last__label">Full time</span>
        <span class="ex-last__score">
          ${`${last.teams?.[0]?.name ?? 'Home'} ${last.score[0]}–${last.score[1]} ${last.teams?.[1]?.name ?? 'Away'}`}
        </span>
        ${last.motm && html`<span class="ex-last__motm text-3">${`Man of the match: ${last.motm.name}`}</span>`}
      </section>`
    }

    <div class="ex-grid">
      <section class="ex-matchup" aria-label="Matchup">
        <div class="ex-slots">
          ${
            data
              ? html`<${TeamSlot}
                    team=${teams[0]}
                    side=${0}
                    active=${active === 0}
                    onActivate=${() => setActive(0)}
                  />
                  <span class="ex-vs" aria-hidden="true">vs</span>
                  <${TeamSlot}
                    team=${teams[1]}
                    side=${1}
                    active=${active === 1}
                    onActivate=${() => setActive(1)}
                  />`
              : html`<${Skeleton} variant="card" /><${Skeleton} variant="card" />`
          }
        </div>
        ${
          ready &&
          html`<p class="ex-edge text-2">
            ${(() => {
              const d = teams[0].effective - teams[1].effective;
              return Math.abs(d) < 0.6
                ? 'Too close to call.'
                : `${d > 0 ? teams[0].name : teams[1].name} are favourites by ${fmt1(Math.abs(d))}.`;
            })()}
          </p>`
        }
      </section>

      <section class="ex-picker card card--pad-md" aria-labelledby="ex-picker-title">
        <h2 class="section-title" id="ex-picker-title">
          ${`Choose the ${active === 0 ? 'home' : 'away'} team`}
        </h2>
        <${Tabs}
          label="Team type"
          variant="pill"
          block
          value=${tab}
          onChange=${t => {
            setTab(t);
            setLimit(PAGE);
          }}
          tabs=${[
            { id: 'club', label: 'Clubs' },
            { id: 'nation', label: 'Nations' },
            { id: 'boss', label: 'Legends' },
            { id: 'random', label: 'Random' },
          ]}
        >
          ${() =>
            tab === 'random'
              ? html`<div class="ex-random">
                  <p class="text-2">
                    Eleven random players from every league in the game, placed in their best
                    positions. Chaos guaranteed.
                  </p>
                  <${Button}
                    icon="dices"
                    variant="secondary"
                    onClick=${rollRandom}
                    data-testid="roll-random"
                    >Roll a random XI<//
                  >
                </div>`
              : html`<div class="ex-filters">
                    <label class="ex-search">
                      <${Icon} name="search" size=${18} />
                      <span class="visually-hidden">Search teams</span>
                      <input
                        type="search"
                        placeholder=${tab === 'nation' ? 'Search nations' : 'Search clubs or leagues'}
                        value=${query}
                        onInput=${e => {
                          setQuery(e.currentTarget.value);
                          setLimit(PAGE);
                        }}
                      />
                    </label>
                    ${
                      tab === 'club' &&
                      html`<${ChipGroup}
                        label="League"
                        options=${leagueOptions}
                        value=${league}
                        onChange=${v => {
                          setLeague(v || 'all');
                          setLimit(PAGE);
                        }}
                        scroll
                        size="sm"
                      />`
                    }
                  </div>
                  ${
                    data
                      ? html`<${TeamList}
                          items=${filtered}
                          selected=${keys.filter(Boolean)}
                          onPick=${pick}
                          limit=${limit}
                          onMore=${() => setLimit(l => l + PAGE)}
                        />`
                      : html`<${Skeleton} variant="row" lines=${6} />`
                  }`}
        <//>
      </section>
      ${
        lineups.some(Boolean) &&
        html`<section class="ex-lineups card card--pad-md" aria-labelledby="ex-lineups-title">
          <h2 class="section-title" id="ex-lineups-title">Line-ups</h2>
          <div class="ex-lineups__grid">
            ${lineups.map(
              (l, i) =>
                l &&
                html`<div class="ex-lineup" key=${teams[i].key}>
                  <p class="ex-lineup__name">
                    <${TeamMark} team=${teams[i]} size=${20} />
                    <span class="truncate">${teams[i].name}</span>
                  </p>
                  <${PitchView}
                    formation=${l.formation}
                    players=${l.views.map(v => v.view)}
                    label=${`${teams[i].name} line-up`}
                  />
                </div>`,
            )}
          </div>
        </section>`
      }
      <div class="action-bar ex-actions">
        <${Button}
          variant="primary"
          size="lg"
          block
          iconEnd="arrow-right"
          disabled=${!ready}
          onClick=${kickOff}
          data-testid="kick-off"
          >Kick off<//
        >
      </div>
    </div>
  </div>`;
}

export { KIND_LABEL };
