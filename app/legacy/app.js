import { CONFIG } from '../core/config/config.js';
import { escapeHtml, searchKey } from '../core/util/text.js';
import { createGameAudio, MatchSoundEvents } from '../services/sound.js';
import { receiptLabel } from '../core/players/player-labels.js';
import { rateClubCatalog } from '../core/players/team-ratings.js';
import { normalizeBadges } from '../core/players/badges.js';
import { compileBadges } from '../core/players/badges.js';
import { FORMATIONS, formationLabel, formationLines } from '../core/players/formations.js';
import { KITS, bestSlots } from '../core/draft/draft.js';
import { createGameUI } from './game-ui.js';
import { miniPitch, renderSquadList, showPlayerCard, rankPlayers } from './squad-ui.js';
import { DIFFICULTIES } from '../core/draft/opponent.js';
import { tacticAccess, coachAI } from '../core/sim/coach.js';
import { Match, ATTRS, W, H, LENGTHS, clamp } from '../core/sim/engine.js';
import { GOAL_ZONES } from '../core/sim/goal-zones.js';
import { TAGS, STYLES, TACTICS, badgeEligible, badgeDescription } from '../core/players/traits.js';
import {
  simulateComplete,
  simulateHalf,
  applyReplayFrame,
  performanceRating,
} from '../core/sim/replay.js';
import {
  overallRating,
  OVERALL_WEIGHTS,
  RATING_GROUPS,
  categoryRating,
  roleAbility,
  calibratedRoleAbility,
  OVERALL_OFFSETS,
  positionFamiliarity,
  POSITIONS,
  teamRatings,
  playerTier,
} from '../core/players/ratings.js';
import { bindPitchFullscreen } from '../services/fullscreen.js';
import { PlaybackClock, bindPlaybackButton } from '../services/playback.js';
import { randomLineups, playerInitials } from '../core/players/lineups.js';
import { matchClock } from '../core/sim/periods.js';
let gameMode = 'sandbox',
  difficulty = 'medium',
  screen = 'home',
  gameUI = null,
  lineupTeam = 0,
  lineupSelection = 6;
const playback = new PlaybackClock();
const sound = createGameAudio(),
  matchSounds = new MatchSoundEvents((cue, options) => sound.play(cue, options));
const $ = s => document.querySelector(s),
  canvas = $('#pitch'),
  ctx = canvas.getContext('2d');
let match = new Match(),
  selected = 6,
  viewMode = 'quick',
  showTrails = false,
  showShape = false,
  tacticsTeam = 0,
  squadTeam = 0,
  uiTimer = 0,
  lastEvents = '',
  trailTime = 0,
  view = { scale: 1, ox: 0, oy: 0 },
  hovered = null;
let recording = null,
  playhead = 0,
  clipNumber = 0,
  busy = false,
  generation = 0,
  reportShown = false,
  started = false,
  halftimeShown = false;
let catalog = null,
  catalogLoading = null,
  rosterReady = false,
  catalogLimit = 80;
const formatTime = t =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const roleNames = {
  GK: 'Goalkeeper',
  LB: 'Left back',
  CB: 'Center back',
  RB: 'Right back',
  DM: 'Defensive midfield',
  CM: 'Central midfield',
  LW: 'Left wing',
  RW: 'Right wing',
  ST: 'Striker',
  AM: 'Attacking midfield',
  LM: 'Left midfield',
  RM: 'Right midfield',
};
const attrHelp = {
  pace: 'Maximum running speed',
  acceleration: 'How quickly a player reaches running speed and changes velocity',
  dribbling: 'Carrying, feints and protection',
  shortPassing: 'Accuracy of short ground passes',
  longPassing: 'Accuracy of longer passes and through balls',
  crossing: 'Accuracy of crosses and cutbacks',
  shooting: 'Placement of close-range finishes',
  longShots: 'Accuracy when shooting from distance',
  penalties: 'Penalty placement and taker selection',
  power: 'Actual shot velocity',
  vision: 'Creative decisions, passing risk and opportunities',
  awareness:
    'Defensive reading, reaction timing and anticipation; 70% awareness + 30% reactions in imported players',
  defending: 'Tackles and blocks',
  stamina: 'Match endurance, burst length and recovery',
  control: 'First touch and receiving fast or aerial passes',
  composure: 'Executing calmly under pressure and fatigue',
  strength: 'Shielding and contact balance',
  heading: 'Placement and control of aerial headers',
  goalkeeping: 'One goalkeeper rating for reactions, reach, handling and saves',
};
const modeLabels = {
  full: '5-minute match + stoppage time',
  quick: '3-minute match + stoppage time',
  highlights: '1-minute highlights · full match underneath',
  instant: 'Instant result · no visual simulation',
};
const baseLocked = () => !rosterReady || busy || match.finished || !!recording;
const editingLocked = () => baseLocked() || gameMode !== 'sandbox';
const tagsLocked = () =>
  baseLocked() ||
  (gameMode === 'ai' && match.players[selected].team === 1) ||
  (gameMode !== 'sandbox' && started && match.mode !== 'halftime');
const tacticsLocked = (team = tacticsTeam) =>
  !rosterReady ||
  busy ||
  !tacticAccess(gameMode, team, {
    started,
    halftime: match.mode === 'halftime',
    recording: !!recording,
    finished: match.finished,
  });
const lineupLocked = () =>
  baseLocked() ||
  match.lineupFixed() ||
  (gameMode === 'ai' && match.players[selected].team === 1) ||
  (started && match.mode !== 'halftime');
const catalogLocked = () => gameMode !== 'sandbox' || lineupLocked() || match.elapsed > 0;
let lastControlState = '',
  lastTacticsUI = '',
  lastTagsUI = '';
function renderPlaybackControl() {
  $('.speed-buttons').hidden = started;
  const label = busy
    ? rosterReady
      ? 'Working…'
      : 'Loading…'
    : !rosterReady
      ? 'Retry'
      : !recording && match.mode === 'halftime'
        ? 'Second half'
        : match.finished
          ? 'New match'
          : !started
            ? viewMode === 'instant'
              ? 'Simulate'
              : 'Start'
            : playback.paused
              ? 'Resume'
              : 'Pause';
  const state = `${label}:${playback.paused}:${busy}:${match.finished}`;
  if (state === lastControlState) return;
  lastControlState = state;
  const button = $('#play');
  button.disabled = busy;
  $('#play-label').textContent = label;
  $('#play-icon').textContent = match.finished ? '↻' : playback.paused ? '▶' : 'Ⅱ';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(!playback.paused && !busy && !match.finished));
}
function updateOverall(p) {
  $('#player-rating').textContent = overallRating(p);
  $('#player-panel').dataset.tier = playerTier(p).name.toLowerCase();
}
function paintRange(input) {
  input.style.setProperty(
    '--fraction',
    clamp(
      (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)),
      0,
      1,
    ),
  );
}
function renderCategories() {
  const p = match.players[selected],
    groups = RATING_GROUPS.filter(
      g => g.id !== 'goalkeeping' || p.role === 'GK' || p.primaryPosition === 'GK',
    );
  $('#rating-categories').replaceChildren();
  for (const g of groups) {
    const tile = document.createElement('div');
    tile.className = `rating-category${g.id === 'goalkeeping' ? ' goalkeeper-rating' : ''}`;
    const label = document.createElement('span'),
      value = document.createElement('b');
    label.textContent = g.label;
    value.dataset.category = g.id;
    value.textContent = categoryRating(p, g);
    tile.append(label, value);
    $('#rating-categories').append(tile);
  }
}
function renderAttributes() {
  const p = match.players[selected];
  $('#attributes').replaceChildren();
  for (const g of RATING_GROUPS) {
    const h = document.createElement('h4');
    h.textContent = g.label;
    $('#attributes').append(h);
    for (const key of Object.keys(g.weights)) {
      const label = ATTRS[key],
        row = document.createElement('label');
      row.className = 'attribute-row';
      row.htmlFor = `attr-${key}`;
      const text = document.createElement('span');
      text.textContent = label;
      const range = document.createElement('input');
      Object.assign(range, {
        type: 'range',
        min: 1,
        max: 99,
        value: p.attrs[key],
        id: `attr-${key}`,
        title: attrHelp[key],
        disabled: editingLocked(),
      });
      range.setAttribute('aria-label', `${label}: ${attrHelp[key]}`);
      paintRange(range);
      const output = document.createElement('output');
      output.htmlFor = range.id;
      output.textContent = p.attrs[key];
      range.oninput = () => {
        if (editingLocked()) return;
        p.attrs[key] = Number(range.value);
        output.textContent = range.value;
        paintRange(range);
        match.setTags(p.id, p.tags);
        renderTags();
        updatePlayer();
      };
      row.append(text, range, output);
      $('#attributes').append(row);
    }
  }
}
function renderLineup() {
  const p = match.players[selected],
    select = $('#playing-slot');
  select.replaceChildren();
  for (const q of match.players.filter(q => q.team === p.team)) {
    const option = document.createElement('option');
    option.value = q.id;
    option.textContent = `${q.role} · #${q.number}${q.id === p.id ? '' : ` · ${q.name}`}`;
    select.append(option);
  }
  select.value = selected;
  select.disabled = lineupLocked();
  $('#choose-player').disabled = catalogLocked();
  $('#choose-player').hidden = gameMode !== 'sandbox';
}
function selectPlayer(id) {
  selected = id;
  const p = match.players[id];
  squadTeam = p.team;
  $('#squad-team').value = p.team;
  $('#selected-number').textContent = rosterReady ? playerInitials(p) : '·';
  $('#selected-number').style.background = match.teams[p.team].color;
  $('#selected-name').textContent = rosterReady ? p.name : 'Selecting players…';
  renderCategories();
  renderAttributes();
  renderLineup();
  renderSquad();
  renderTags();
  updatePlayer();
}
$('#ratings-expanded').ontoggle = () => {
  $('#ratings-expanded summary').textContent = $('#ratings-expanded').open
    ? 'Collapse ratings'
    : 'Expand ratings';
};
$('#playing-slot').onchange = e => {
  if (lineupLocked()) return;
  const destination = Number(e.target.value);
  if (match.swapLineup(selected, destination)) {
    selectPlayer(destination);
    updateUI();
  }
};
for (const role of POSITIONS) {
  const option = document.createElement('option');
  option.value = role;
  option.textContent = `${role} · ${roleNames[role]}`;
  $('#catalog-position').append(option);
}
function renderCatalog() {
  const p = match.players[selected],
    query = searchKey($('#catalog-search').value),
    role = $('#catalog-position').value;
  $('#catalog-context').textContent =
    `${p.role} · ${match.teams[p.team].name}${p.sentOff ? ' · Red card' : p.yellowCards ? ' · Yellow card' : ''}`;
  $('#catalog-list').replaceChildren();
  if (!catalog) return;
  const profiles = rankPlayers(catalog.players, role, query);
  $('#catalog-status').textContent = `${profiles.length} players`;
  $('#catalog-more').hidden = profiles.length <= catalogLimit;
  for (const q of profiles.slice(0, catalogLimit)) {
    const asPlayed = { ...q, role: p.role },
      used = match.players.some(
        r => r.team === p.team && r.id !== p.id && r.profileId === q.profileId,
      ),
      button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-player';
    button.dataset.tier = playerTier(q).name.toLowerCase();
    button.disabled = used || catalogLocked() || (p.role === 'GK') !== (q.primaryPosition === 'GK');
    const info = document.createElement('span'),
      name = document.createElement('strong'),
      detail = document.createElement('small'),
      rating = document.createElement('span');
    name.textContent = q.name;
    detail.textContent = `${[q.primaryPosition, ...q.secondaryPositions].join(' / ')} · ${q.source.club || 'Free agent'}`;
    info.append(name, detail);
    rating.className = 'catalog-rating';
    const score = document.createElement('b'),
      caption = document.createElement('small');
    score.textContent = overallRating(q, true, role || q.primaryPosition);
    caption.textContent = used
      ? 'In this XI'
      : (p.role === 'GK') !== (q.primaryPosition === 'GK')
        ? 'Different position type'
        : p.role + ' · ' + overallRating(asPlayed) + ' OVR';
    rating.append(score, caption);
    button.append(info, rating);
    button.setAttribute(
      'aria-label',
      `Choose ${q.name}, overall ${overallRating(asPlayed)} at ${p.role}`,
    );
    button.onclick = () => {
      if (catalogLocked()) return;
      if (match.setPlayerProfile(selected, q)) {
        $('#player-catalog').close();
        selectPlayer(selected);
        loadTactics();
        updateUI();
      }
    };
    $('#catalog-list').append(button);
  }
  if (!profiles.length) $('#catalog-status').textContent = 'No players match these filters.';
}
async function loadCatalog() {
  if (catalog) return catalog;
  catalogLoading ??= fetch('./data/players-runtime.json')
    .then(r => {
      if (!r.ok) throw new Error('Catalog unavailable');
      return r.json();
    })
    .then(data => {
      if (
        ![1, 2].includes(data.schemaVersion) ||
        !Array.isArray(data.players) ||
        data.players.length < 22
      )
        throw new Error('Invalid catalog');
      data.teams = rateClubCatalog(data);
      for (const p of data.players) p.tags = normalizeBadges(p, p.tags);
      return data;
    });
  try {
    catalog = await catalogLoading;
    return catalog;
  } catch (error) {
    catalogLoading = null;
    throw error;
  }
}
async function openCatalog() {
  if (catalogLocked()) return;
  catalogLimit = 80;
  $('#player-catalog').showModal();
  $('#catalog-status').textContent = 'Loading players…';
  try {
    await loadCatalog();
    renderCatalog();
  } catch {
    $('#catalog-status').textContent =
      'The player catalog could not load. Close this panel and try again.';
  }
}
$('#choose-player').onclick = openCatalog;
$('#close-catalog').onclick = () => $('#player-catalog').close();
$('#catalog-search').oninput = () => {
  catalogLimit = 80;
  renderCatalog();
};
$('#catalog-position').onchange = () => {
  catalogLimit = 80;
  renderCatalog();
};
$('#catalog-more').onclick = () => {
  catalogLimit += 80;
  renderCatalog();
};
function renderSquad() {
  $('#squad').replaceChildren();
  if (!rosterReady) return;
  match.players
    .filter(p => p.team === squadTeam)
    .forEach(p => {
      const button = document.createElement('button');
      button.textContent = playerInitials(p);
      button.title = `${p.name} · ${roleNames[p.role]}`;
      button.setAttribute('aria-label', `Inspect ${p.name}, ${roleNames[p.role]}`);
      button.className = p.id === selected ? 'active' : '';
      button.setAttribute('aria-pressed', String(p.id === selected));
      button.onclick = () => selectPlayer(p.id);
      $('#squad').append(button);
    });
}
$('#dominant-foot').onchange = e => {
  if (editingLocked()) return;
  match.players[selected].foot = e.target.value;
  updatePlayer();
};
function renderTags() {
  lastTagsUI = `${selected}:${match.players[selected].tags.join(',')}:${playerTier(match.players[selected]).capacity}:${tagsLocked()}`;
  const p = match.players[selected];
  $('#player-tags').replaceChildren();
  for (const id of p.tags) {
    const t = TAGS.find(t => t.id === id),
      chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = t.label;
    chip.tabIndex = 0;
    const tip = document.createElement('span');
    tip.className = 'tag-tooltip';
    tip.id = `tip-${p.id}-${t.id}`;
    tip.role = 'tooltip';
    tip.textContent = badgeDescription(t, p);
    chip.setAttribute('aria-describedby', tip.id);
    chip.append(tip);
    const locateTip = () => {
      const rect = chip.getBoundingClientRect();
      tip.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - 240))}px`;
      tip.style.top = `${Math.max(10, rect.top - (tip.offsetHeight || 78) - 8)}px`;
    };
    chip.onpointerenter = locateTip;
    chip.onfocus = locateTip;
    $('#player-tags').append(chip);
  }
  if (!p.tags.length) $('#player-tags').textContent = 'No selected badges';
  $('#edit-tags').textContent =
    `${tagsLocked() ? '' : 'Edit · '}${p.tags.length}/${playerTier(p).capacity}`;
  $('#edit-tags').disabled = tagsLocked();
}
function renderTagBank() {
  const p = match.players[selected];
  $('#tag-title').textContent = `${p.name.split(' ').pop()}’s badges`;
  $('#tag-count').textContent =
    `${p.tags.length} / ${playerTier(p).capacity} · ${playerTier(p).name} · minimum ${playerTier(p).minimum}`;
  $('#tag-bank').replaceChildren();
  for (const group of ['Attack', 'Defense', 'Goalkeeper']) {
    if (!TAGS.some(t => t.group === group && badgeEligible(p, t))) continue;
    const h = document.createElement('h3');
    h.textContent = group;
    $('#tag-bank').append(h);
    for (const t of TAGS.filter(t => t.group === group && badgeEligible(p, t))) {
      const b = document.createElement('button');
      b.className = `tag-choice ${p.tags.includes(t.id) ? 'active' : ''}`;
      b.setAttribute('aria-pressed', String(p.tags.includes(t.id)));
      b.disabled = p.tags.includes(t.id)
        ? p.tags.length <= playerTier(p).minimum
        : p.tags.length >= playerTier(p).capacity;
      b.innerHTML = `<strong>${t.label}</strong><span>${badgeDescription(t, p)}</span>`;
      b.onclick = () => {
        if (tagsLocked()) return;
        match.setTags(
          p.id,
          p.tags.includes(t.id) ? p.tags.filter(id => id !== t.id) : [...p.tags, t.id],
        );
        renderTagBank();
        renderTags();
      };
      $('#tag-bank').append(b);
    }
  }
}
$('#edit-tags').onclick = () => {
  if (tagsLocked()) return;
  renderTagBank();
  $('#tag-dialog').showModal();
};
$('#close-tags').onclick = () => $('#tag-dialog').close();
$('#clear-tags').onclick = () => {
  if (tagsLocked()) return;
  match.setTags(
    selected,
    compileBadges(match.players[selected], match.players[selected].inference?.badges || []).map(
      b => b.tag,
    ),
  );
  renderTagBank();
  renderTags();
};
function updatePlayer() {
  const p = match.players[selected];
  $('#player-action').textContent = busy
    ? 'Resolving match'
    : match.finished
      ? 'Full time'
      : p.sentOff
        ? 'Sent off'
        : p.displayAction(match.elapsed) || 'Ready';
  $('#player-action').style.color = match.teams[p.team].color;
  updateOverall(p);
  $('#dominant-foot').value = p.foot;
  $('#dominant-foot').disabled = editingLocked();
  $('#energy-value').textContent = `${Math.round(p.energy * 100)}%`;
  $('#energy-fill').style.width = `${p.energy * 100}%`;
  $('#energy-fill').style.background =
    p.energy < 0.35 ? '#e1a277' : p.energy < 0.6 ? '#d5c07d' : '#98ba82';
  $('#selected-role').textContent =
    `${p.role} · ${match.teams[p.team].name}${p.sentOff ? ' · Red card' : p.yellowCards ? ' · Yellow card' : ''}`;
  $('#player-positions').textContent = [p.primaryPosition, ...p.secondaryPositions].join(' / ');
  for (const node of document.querySelectorAll('[data-category]')) {
    const group = RATING_GROUPS.find(g => g.id === node.dataset.category);
    node.textContent = categoryRating(p, group);
  }
  $('#choose-player').disabled = catalogLocked();
  $('#choose-player').hidden = gameMode !== 'sandbox';
  $('#playing-slot').disabled = lineupLocked() || p.sentOff;
}
function statRows(m, full = false) {
  const [a, b] = m.stats,
    total = a.possession + b.possession,
    home = total ? Math.round((100 * a.possession) / total) : 50;
  const rows = [
    ['Possession', `${home}%`, `${100 - home}%`],
    ['Shots / on target', `${a.shots} / ${a.onTarget}`, `${b.shots} / ${b.onTarget}`],
    ['Off target', a.offTarget, b.offTarget],
    ['Saves', a.saves, b.saves],
    ['Passes completed', a.completed, b.completed],
    [
      'Pass accuracy',
      `${a.passes ? Math.round((a.completed / a.passes) * 100) : 0}%`,
      `${b.passes ? Math.round((b.completed / b.passes) * 100) : 0}%`,
    ],
  ];
  if (full)
    rows.push(
      ['Yellow cards', a.yellowCards || 0, b.yellowCards || 0],
      ['Red cards', a.redCards || 0, b.redCards || 0],
      ['Shots inside box', a.boxShots, b.boxShots],
      ['Goals inside box', a.boxGoals, b.boxGoals],
      ['Goals outside box', m.score[0] - a.boxGoals, m.score[1] - b.boxGoals],
      ['Goals from central corridor', a.centralGoals, b.centralGoals],
      ['Assisted goals', a.assistedGoals, b.assistedGoals],
      ['Crosses / cutbacks', a.crosses, b.crosses],
      ['Through balls', a.throughBalls, b.throughBalls],
      ['Take-ons won', a.takeons, b.takeons],
      ['Tackles won', a.tackles, b.tackles],
      ['Fouls committed', a.fouls, b.fouls],
      ['Offsides', a.offsides, b.offsides],
      ['Penalties awarded', a.penalties, b.penalties],
      ['Penalty goals', a.penaltyGoals, b.penaltyGoals],
      ['Blocked shots', a.blocked, b.blocked],
      ['Woodwork', a.woodwork, b.woodwork],
      [
        'Forward / backward passes',
        `${a.forwardPasses} / ${a.backwardPasses}`,
        `${b.forwardPasses} / ${b.backwardPasses}`,
      ],
    );
  return rows;
}
let lastStats = '';
function renderStats() {
  const html = statRows(match)
    .map(([label, a, b]) => {
      const x = parseFloat(a) || 0,
        y = parseFloat(b) || 0,
        pct = x + y ? (100 * x) / (x + y) : 50;
      return `<div class="stat"><div class="stat-labels"><b>${a}</b><span>${label}</span><b>${b}</b></div><div class="stat-track"><i style="width:${pct}%"></i><i style="width:${100 - pct}%"></i></div></div>`;
    })
    .join('');
  if (html !== lastStats) {
    $('#stats').innerHTML = html;
    lastStats = html;
  }
}
function renderInterval() {
  const half = !busy && !recording && match.mode === 'halftime',
    full = !busy && match.finished && viewMode !== 'instant';
  $('#interval-banner').hidden = !(half || full);
  if (!half && !full) return;
  const title = half ? 'HALF TIME' : match.abandonedTeam != null ? 'MATCH ABANDONED' : 'FULL TIME',
    score = `${match.score[0]} — ${match.score[1]}`;
  if ($('#interval-title').textContent !== title) $('#interval-title').textContent = title;
  if ($('#interval-score').textContent !== score) $('#interval-score').textContent = score;
  const avg = values =>
    Math.round((values.filter((_, i) => i % 11).reduce((a, b) => a + b, 0) / 20) * 100);
  const note = half
    ? `Outfield stamina ${avg(match.halftime.energyBefore)}% → ${avg(match.halftime.energyAfter)}%. Adjust your tactics before the second half.`
    : match.abandonedTeam != null
      ? `${match.teams[match.abandonedTeam].name} have fewer than seven players.`
      : match.score[0] === match.score[1]
        ? 'Honors even at the final whistle.'
        : `${match.teams[match.score[0] > match.score[1] ? 0 : 1].name} take the win.`;
  if ($('#interval-note').textContent !== note) $('#interval-note').textContent = note;
  const label = half ? 'Start second half' : 'View match summary';
  if ($('#interval-action').textContent !== label) $('#interval-action').textContent = label;
}
function presentHalftime() {
  if (halftimeShown) return;
  halftimeShown = true;
  sound.stop();
  sound.play('half');
  playback.setPaused(true, performance.now());
  selectPlayer(selected);
  loadTactics();
  setTab('tactics');
  updateUI();
}
bindPlaybackButton($('#interval-action'), () => (match.finished ? showReport() : togglePlay()));
function renderTeamRatings() {
  for (const [team, side] of ['home', 'away'].entries()) {
    const ratings = rosterReady ? teamRatings(match.activePlayers, team) : {};
    for (const line of ['def', 'mid', 'att']) {
      const node = $(`#${side}-${line}`),
        value = String(ratings[line] ?? '—');
      if (node.textContent !== value) node.textContent = value;
    }
  }
}
function updateUI() {
  $('#home-score').textContent = match.score[0];
  $('#away-score').textContent = match.score[1];
  $('#clock').textContent = matchClock(match.time, match.half);
  $('#period').textContent = match.finished
    ? match.abandonedTeam != null
      ? 'ABANDONED'
      : 'FULL TIME'
    : !recording && match.mode === 'halftime'
      ? 'HALF TIME'
      : match.half === 1
        ? '1ST HALF'
        : '2ND HALF';
  $('#added-time').hidden =
    match.time < (match.half === 1 ? 2700 : 5400) || match.finished || match.mode === 'halftime';
  $('#added-time').textContent = `+${match.addedMinutes[match.half - 1]} MIN`;
  renderInterval();
  $('.live-dot').style.opacity = playback.paused || match.finished ? 0.25 : 1;
  ['home', 'away'].forEach((side, i) => {
    $(`#${side}-formation`).textContent = formationLabel(match.teams[i].tactics.formation);
    const reds = match.stats[i].redCards || 0,
      node = $(`#${side}-reds`);
    node.hidden = !reds;
    node.textContent = reds ? String(reds) : '';
    node.setAttribute(
      'aria-label',
      `${match.teams[i].name}: ${reds} red card${reds === 1 ? '' : 's'}`,
    );
  });
  $('#pitch-status').textContent = busy
    ? 'RESOLVING MATCH'
    : match.finished
      ? match.abandonedTeam != null
        ? 'ABANDONED'
        : 'FULL TIME'
      : playback.paused
        ? 'PAUSED'
        : match.phase.toUpperCase();
  $('#pitch-status').classList.remove('goal');
  $('#phase-label').textContent = recording && !match.finished ? 'HIGHLIGHTS' : 'KEY MOMENTS';
  const goal = match.events.find(e => e.type === 'goal' && match.elapsed - e.elapsed < 2.5);
  $('#goal-banner').hidden = !goal || busy || match.finished || match.mode === 'halftime';
  if (goal) {
    const scorer = match.players[goal.playerId],
      assist = match.players[goal.assistId];
    $('#goal-banner').style.setProperty('--goal-color', match.teams[goal.team].color);
    $('#goal-banner').innerHTML =
      `<span class="goal-word">GOAL</span><strong>${match.score[0]} <i>—</i> ${match.score[1]}</strong><span>${escapeHtml(scorer?.name || match.teams[goal.team].name)}${goal.ownGoal ? ' · own goal' : ''}</span>${assist ? `<small>Assist · ${escapeHtml(assist.name)}</small>` : ''}`;
  }
  $('#replay-badge').hidden = !recording || match.finished;
  $('#replay-badge').textContent =
    `HIGHLIGHTS · ${clipNumber} / ${recording?.clips.length || 0} · ${formatTime(Math.max(0, 60 - (recording?.viewOffset || 0) - playhead))} left`;
  const events = match.events.filter(e =>
      [
        'goal',
        'shot',
        'save',
        'dribble',
        'tackle',
        'cross',
        'through',
        'cutback',
        'block',
        'half',
        'full',
        'added',
        'foul',
        'penalty',
        'offside',
        'post',
        'yellow',
        'red',
      ].includes(e.type),
    ),
    key = events.map(e => `${e.id}:${e.outcome || ''}`).join(',');
  if (key !== lastEvents) {
    lastEvents = key;
    const feed = $('#events'),
      top = feed.scrollTop,
      height = feed.scrollHeight;
    feed.replaceChildren();
    for (const e of events) {
      const el = document.createElement('div');
      el.className = `event${e.team === 1 ? ' away' : ''}${e.type === 'goal' ? ' goal-event' : ''}${e.type === 'yellow' ? ' yellow-event' : e.type === 'red' ? ' red-event' : ''}`;
      const time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = matchClock(e.time, e.half ?? (e.time < 2700 ? 1 : 2));
      const content = document.createElement('span');
      content.textContent = e.text;
      const mark = document.createElement('i');
      mark.className = 'event-mark';
      el.append(time, mark, content);
      if (e.chance != null && e.type !== 'goal') {
        const estimate = document.createElement('span');
        estimate.className = 'event-estimate';
        estimate.textContent = `${Math.round(e.chance * 100)}% ${e.chanceLabel || 'success'}`;
        estimate.title = 'Estimated at the moment of action from ability and the situation';
        el.append(estimate);
      }
      if (e.outcome && e.outcome !== 'in flight') {
        const outcome = document.createElement('small');
        outcome.className = 'shot-outcome';
        outcome.textContent = e.outcome === 'saved' ? 'saved' : e.outcome;
        content.append(outcome);
      }
      feed.append(el);
    }
    feed.scrollTop = top < 18 ? 0 : top + Math.max(0, feed.scrollHeight - height);
  }
  if (!events.length)
    $('#events').innerHTML = '<p class="quiet-feed">Waiting for the first key moment.</p>';
  if ($('#moments-dialog').open && $('#expanded-events').dataset.signature !== key) {
    const feed = $('#expanded-events'),
      scroll = feed.scrollTop;
    feed.innerHTML = $('#events').innerHTML;
    feed.dataset.signature = key;
    feed.scrollTop = scroll;
  }
  renderPlaybackControl();
  $('#report-button').hidden = !match.finished;
  $('#length-note').textContent = modeLabels[viewMode];
  if (
    lastTacticsUI !==
    JSON.stringify([
      tacticsTeam,
      match.teams[tacticsTeam].tactics,
      tacticsLocked(),
      match.lineupFixed(),
    ])
  )
    loadTactics();
  if (
    lastTagsUI !==
    `${selected}:${match.players[selected].tags.join(',')}:${playerTier(match.players[selected]).capacity}:${tagsLocked()}`
  )
    renderTags();
  if ($('#lineup-dialog').open && $('#lineup-dialog').dataset.locked !== String(lineupLocked()))
    renderLineupEditor();
  updatePlayer();
  renderStats();
  renderTeamRatings();
  renderTVControls();
  if (match.finished && !reportShown) {
    reportShown = true;
    sound.stop();
    sound.play('full');
    playback.setPaused(true, performance.now());
    selectPlayer(selected);
    loadTactics();
    if (viewMode === 'instant') showReport();
  }
}
function setTab(tab) {
  const player = tab === 'player';
  $('#tactics-panel').hidden = player;
  $('#player-view').hidden = !player;
  for (const name of ['tactics', 'player']) {
    const b = $(`#tab-${name}`),
      active = name === tab;
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
  }
}
for (const name of ['tactics', 'player']) {
  const button = $(`#tab-${name}`);
  button.onclick = () => setTab(name);
  button.onkeydown = e => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === 'Home'
          ? 'tactics'
          : e.key === 'End'
            ? 'player'
            : name === 'tactics'
              ? 'player'
              : 'tactics';
      setTab(next);
      $(`#tab-${next}`).focus();
    }
  };
}
$('#formation').innerHTML = Object.keys(FORMATIONS)
  .sort()
  .map(id => `<option value="${id}">${formationLabel(id)}</option>`)
  .join('');
$('#team-style').innerHTML = Object.entries(STYLES)
  .map(([id, t]) => `<option value="${id}">${t.label}</option>`)
  .join('');

function loadTactics() {
  const t = match.teams[tacticsTeam].tactics,
    team = match.teams[tacticsTeam];
  miniPitch(
    $('#tactic-formation-preview'),
    FORMATIONS[t.formation],
    FORMATIONS[t.formation].map((_, slot) =>
      match.players.find(p => p.team === tacticsTeam && p.slot === slot),
    ),
    {
      preview: true,
      color: team.color,
      secondary: team.secondary,
      onSelect: (slot, p) =>
        showPlayerCard(p, FORMATIONS[t.formation][slot][2], {
          team: team.name,
          color: team.color,
          secondary: team.secondary,
        }),
    },
  );
  lastTacticsUI = JSON.stringify([tacticsTeam, t, tacticsLocked(), match.lineupFixed()]);
  $('#formation').value = t.formation;
  $('#team-style').value = t.style;
  $('#style-help').textContent = STYLES[t.style].description;
  $('#formation').disabled = tacticsLocked() || match.lineupFixed();
  $('#formation').title =
    gameMode !== 'sandbox' ? 'Formation and positions can only be changed at halftime.' : '';
  $('#formation-note').hidden = gameMode === 'sandbox';
  $('#team-style').disabled = tacticsLocked();
  $('#tactics-access').textContent = tacticsLocked() ? 'LOCKED' : 'EDIT';
  $('#tactics-lock-note').textContent =
    gameMode === 'ai' && tacticsTeam === 1
      ? 'AI controlled'
      : gameMode === 'pvp'
        ? 'Changes at kickoff and half-time'
        : gameMode === 'ai'
          ? ''
          : '';
  $('#team-tactics').replaceChildren();
  for (const [key, definition] of Object.entries(TACTICS)) {
    const block = document.createElement('div');
    block.className = 'tactic-step';
    block.innerHTML = `<div class="tactic-step-title"><span>${definition.label}</span><b>${definition.levels[t[key] - 1]}</b></div>`;
    const group = document.createElement('div');
    group.className = 'five-scale';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', definition.label);
    for (let v = 1; v <= 5; v++) {
      const button = document.createElement('button');
      button.textContent = v;
      button.className = t[key] === v ? 'active' : '';
      button.title = definition.levels[v - 1];
      button.setAttribute('aria-label', `${definition.label} ${v}: ${definition.levels[v - 1]}`);
      button.setAttribute('aria-pressed', String(t[key] === v));
      button.disabled = tacticsLocked();
      button.onclick = () => {
        if (tacticsLocked()) return;
        match.setTactic(tacticsTeam, key, v);
        loadTactics();
      };
      group.append(button);
    }
    const help = document.createElement('p');
    help.className = 'control-help';
    help.textContent = definition.help;
    block.append(group, help);
    $('#team-tactics').append(block);
  }
  document.querySelectorAll('[data-team]').forEach(b => {
    const active = Number(b.dataset.team) === tacticsTeam;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}
for (const key of ['formation', 'team-style'])
  $(`#${key}`).onchange = e => {
    if (tacticsLocked() || (key === 'formation' && match.lineupFixed())) return;
    match.setTactic(tacticsTeam, key === 'team-style' ? 'style' : key, e.target.value);
    loadTactics();
    selectPlayer(selected);
    updateUI();
  };
document.querySelectorAll('[data-team]').forEach(
  b =>
    (b.onclick = () => {
      tacticsTeam = Number(b.dataset.team);
      loadTactics();
    }),
);
$('#squad-team').onchange = e => {
  squadTeam = Number(e.target.value);
  renderSquad();
};
async function resetMatch({ redraw = true } = {}) {
  const token = ++generation,
    config = match.exportConfig(),
    drawRoster = redraw || !rosterReady;
  const seed = (match.seed + 0x9e3779b9) >>> 0;
  match = new Match(seed, viewMode === 'quick' ? 180 : 300);
  match.importConfig(config);
  match.pauseAtHalf = true;
  sound.stop();
  matchSounds.reset(match);
  busy = drawRoster;
  rosterReady = !drawRoster;
  recording = null;
  playhead = 0;
  clipNumber = 0;
  playback.reset(performance.now());
  started = false;
  reportShown = false;
  halftimeShown = false;
  lastEvents = '';
  hovered = null;
  $('#preparing').hidden = !drawRoster;
  $('#prepare-label').textContent = 'Selecting the lineups…';
  $('#prepare-progress').hidden = true;
  $('#moments-dialog').close();
  $('#match-report').close();
  $('#tag-dialog').close();
  $('#player-catalog').close();
  $('#lineup-dialog').close();
  selectPlayer(selected);
  loadTactics();
  updateUI();
  if (drawRoster) {
    try {
      const data = await loadCatalog();
      if (token !== generation) return;
      config.players = randomLineups(match.players, data.players, seed);
      match.importConfig(config);
      rosterReady = true;
    } catch (error) {
      if (token !== generation) return;
      busy = false;
      $('#prepare-label').textContent =
        'Players could not load. Select Retry or New match to try again.';
      updateUI();
      return;
    }
  }
  if (token !== generation) return;
  busy = false;
  $('#preparing').hidden = true;
  $('#prepare-progress').hidden = false;
  selectPlayer(selected);
  loadTactics();
  updateUI();
}
async function startRecorded() {
  sound.stop();
  const token = ++generation,
    config = match.exportConfig(),
    seed = match.seed;
  busy = true;
  playback.setPaused(true, performance.now());
  started = true;
  $('#preparing').hidden = false;
  $('#prepare-progress').hidden = false;
  $('#prepare-label').textContent =
    viewMode === 'highlights' ? 'Finding the moments that matter…' : 'Playing out the full match…';
  $('#prepare-progress').value = 0;
  selectPlayer(selected);
  loadTactics();
  updateUI();
  try {
    const progress = p => {
        $('#prepare-progress').value = p;
      },
      cancelled = () => generation !== token;
    const complete =
      viewMode === 'highlights'
        ? await simulateHalf(match, progress, cancelled)
        : await simulateComplete(config, seed, false, progress, cancelled);
    if (!complete || generation !== token) return;
    busy = false;
    $('#preparing').hidden = true;
    if (viewMode === 'instant') {
      match = complete.result;
      recording = null;
      playback.setPaused(true, performance.now());
    } else {
      recording = complete;
      playhead = 0;
      clipNumber = applyReplayFrame(match, recording, 0);
      matchSounds.reset(match);
      playback.setPaused(false, performance.now());
    }
    selectPlayer(selected);
    loadTactics();
    updateUI();
  } catch (error) {
    if (generation !== token) return;
    busy = false;
    playback.setPaused(true, performance.now());
    started = false;
    $('#prepare-label').textContent = 'The match could not finish. Start a new match to try again.';
    $('#prepare-progress').hidden = true;
    console.error(error);
    updateUI();
  }
}
function togglePlay() {
  if (busy) return;
  if (!rosterReady) {
    resetMatch();
    return;
  }
  if (match.finished) {
    newGame();
    return;
  }
  if (!recording && match.mode === 'halftime') {
    if (viewMode === 'highlights') {
      startRecorded();
      return;
    }
    match.resumeHalf();
    sound.play('kickoff');
    playback.setPaused(false, performance.now());
    updateUI();
    return;
  }
  if (!started && ['highlights', 'instant'].includes(viewMode)) {
    startRecorded();
    return;
  }
  if (!started) sound.play('kickoff');
  started = true;
  playback.setPaused(!playback.paused, performance.now());
  if (playback.paused) sound.stop();
  loadTactics();
  renderTags();
  renderLineup();
  updateUI();
}
bindPlaybackButton($('#play'), togglePlay);
$('#reset').onclick = newGame;
document.querySelectorAll('[data-mode]').forEach(
  b =>
    (b.onclick = () => {
      if (b.disabled || started) return;
      viewMode = b.dataset.mode;
      resetMatch({ redraw: false });
      document.querySelectorAll('[data-mode]').forEach(q => {
        q.classList.toggle('active', q === b);
        q.setAttribute('aria-pressed', String(q === b));
      });
    }),
);
$('#trails').onchange = e => (showTrails = e.target.checked);
$('#shape').onchange = e => (showShape = e.target.checked);
$('#expand-moments').onclick = () => {
  $('#expanded-events').innerHTML = $('#events').innerHTML;
  $('#moments-dialog').showModal();
};
$('#close-moments').onclick = () => $('#moments-dialog').close();
document.addEventListener('keydown', e => {
  if (
    screen === 'match' &&
    e.code === 'Space' &&
    !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'A'].includes(
      document.activeElement?.tagName,
    ) &&
    !document.activeElement?.isContentEditable &&
    !document.querySelector('dialog[open]')
  ) {
    e.preventDefault();
    if (!e.repeat) togglePlay();
  }
});
async function showReport() {
  if (!match.finished) return;
  await pitchFullscreen.exit();
  if ($('#match-report').open) return;
  const m = match,
    sorted = [...m.players].sort((a, b) => performanceRating(b, m) - performanceRating(a, m));
  $('#report-score').textContent =
    `${m.teams[0].name} ${m.score[0]} — ${m.score[1]} ${m.teams[1].name}`;
  $('#report-context').textContent =
    `${viewMode === 'highlights' ? 'Full-match result behind the highlights' : viewMode === 'instant' ? 'Instant · full match resolved' : `${LENGTHS[viewMode] / 60}-minute continuous match`} · ${STYLES[m.teams[0].tactics.style].label} / ${STYLES[m.teams[1].tactics.style].label}`;
  const star = sorted[0],
    creator = [...m.players].sort((a, b) => b.stats.keyPasses - a.stats.keyPasses)[0],
    defender = [...m.players].sort(
      (a, b) =>
        b.stats.tackles +
        b.stats.blocks +
        b.stats.saves -
        (a.stats.tackles + a.stats.blocks + a.stats.saves),
    )[0];
  $('#top-performers').innerHTML = [
    [
      star,
      'PLAYER OF THE MATCH',
      `${star.stats.goals} goals · ${star.stats.assists} assists · ${star.stats.takeons} take-ons`,
    ],
    [
      creator,
      'CHANCE CREATOR',
      `${creator.stats.keyPasses} chances · ${creator.stats.assists} assists`,
    ],
    [
      defender,
      'DEFENSIVE IMPACT',
      `${defender.stats.tackles} tackles · ${defender.stats.blocks} blocks · ${defender.stats.saves} saves`,
    ],
  ]
    .map(
      ([p, label, detail]) =>
        `<article class="performer" style="--team-color:${m.teams[p.team].color}"><span>${label}</span><div><strong>${label === 'CHANCE CREATOR' && !p.stats.keyPasses ? 'No chances created' : label === 'DEFENSIVE IMPACT' && !(p.stats.tackles + p.stats.blocks + p.stats.saves) ? 'No defensive actions' : escapeHtml(p.name)}</strong><b>${(label === 'CHANCE CREATOR' && !p.stats.keyPasses) || (label === 'DEFENSIVE IMPACT' && !(p.stats.tackles + p.stats.blocks + p.stats.saves)) ? '—' : performanceRating(p, m).toFixed(1)}</b></div><small>${detail}</small></article>`,
    )
    .join('');
  $('#report-stats').innerHTML = statRows(m, true)
    .map(
      ([label, a, b]) =>
        `<div class="report-stat"><strong>${a}</strong><span>${label}</span><strong>${b}</strong></div>`,
    )
    .join('');
  $('#report-players').innerHTML = m.teams
    .map(
      (team, t) =>
        `<div class="rating-team"><h4 style="color:${team.color}">${escapeHtml(team.name)}</h4><div class="table-scroll"><table><thead><tr><th>Player</th><th>Rating</th><th>G</th><th>A</th><th>KP</th><th>TK</th><th>SV</th></tr></thead><tbody>${m.players
          .filter(p => p.team === t)
          .map(
            p =>
              `<tr><td><span>${p.number}</span> ${escapeHtml(p.name)}<small>${p.role} · ${p.stats.completed}/${p.stats.passes} passes · ${p.stats.takeons}/${p.stats.dribbleAttempts} take-ons · ${p.stats.fouls} fouls${p.yellowCards ? ' · ' + p.yellowCards + ' YC' : ''}${p.sentOff ? ' · SENT OFF' : ''}</small></td><td><b class="rating-pill">${performanceRating(p, m).toFixed(1)}</b></td>${['goals', 'assists', 'keyPasses', 'tackles', 'saves'].map(k => `<td>${p.stats[k]}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table></div></div>`,
    )
    .join('');
  $('#report-goals').innerHTML = m.goalHistory.length
    ? m.goalHistory
        .map(
          e =>
            `<div class="goal-story"><time>${matchClock(e.time, e.half ?? (e.time < 2700 ? 1 : 2))}</time><div><strong>${escapeHtml(e.text)}</strong><small>${e.ownGoal ? 'Own goal' : `${e.shotType || 'Finish'} · ${GOAL_ZONES[e.zone]?.label || (e.box ? 'inside the box' : 'outside the box')}`}</small></div></div>`,
        )
        .join('')
    : '<p class="quiet-feed">No goals. The defenses kept their clean sheets.</p>';
  $('#match-report').showModal();
}
$('#report-button').onclick = showReport;
$('#close-report').onclick = () => $('#match-report').close();
$('#report-new').onclick = () => {
  $('#match-report').close();
  newGame();
};
function resize() {
  const stage = $('.pitch-stage'),
    shell = $('.pitch-shell');
  if (!stage || screen !== 'match') return;
  if (window.innerWidth >= 900 || pitchFullscreen.active) {
    const r = stage.getBoundingClientRect(),
      unit = Math.min(r.width / 130, r.height / 80);
    shell.style.width = `${Math.max(1, unit * 130)}px`;
    shell.style.height = `${Math.max(1, unit * 80)}px`;
  } else {
    shell.style.width = '100%';
    shell.style.height = 'auto';
  }
  const rect = canvas.getBoundingClientRect(),
    dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  view = { scale: canvas.height / 80, xScale: canvas.width / 115, ox: 5, oy: 5 };
}
const pitchFullscreen = bindPitchFullscreen({
  target: $('#match-panel'),
  button: $('#fullscreen-pitch'),
  onResize: () => requestAnimationFrame(resize),
});
function renderTVControls() {
  $('#tv-pause').textContent =
    match.mode === 'halftime'
      ? 'Second half'
      : !started
        ? 'Start'
        : playback.paused
          ? 'Resume'
          : 'Pause';
  $('#tv-pause').disabled = busy || match.finished;
  $('#tv-tactics').hidden = tacticsLocked(0);
}
$('#tv-exit').onclick = () => pitchFullscreen.exit();
bindPlaybackButton($('#tv-pause'), togglePlay);
$('#tv-tactics').onclick = async () => {
  await pitchFullscreen.exit();
  tacticsTeam = 0;
  loadTactics();
  setTab('tactics');
};
new ResizeObserver(resize).observe($('.pitch-stage'));
window.addEventListener('resize', resize);
function kitText(color) {
  const hex = color.replace('#', ''),
    r = parseInt(hex.slice(0, 2), 16),
    g = parseInt(hex.slice(2, 4), 16),
    b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 145 ? '#14201c' : '#fff';
}
function pt(x, y) {
  return [(x + view.ox) * (view.xScale || view.scale), (y + view.oy) * view.scale];
}
function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(...pt(x1, y1));
  ctx.lineTo(...pt(x2, y2));
  ctx.stroke();
}
function circle(x, y, r, fill, stroke) {
  const [px, py] = pt(x, y);
  ctx.beginPath();
  ctx.arc(px, py, r * view.scale, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function rect(x, y, w, h) {
  const [px, py] = pt(x, y);
  ctx.strokeRect(px, py, w * view.xScale, h * view.scale);
}
function drawPitch() {
  const s = view.scale;
  ctx.fillStyle = '#223a2c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#2a4231' : '#2d4634';
    const [x, y] = pt(i * 10.5, 0);
    ctx.fillRect(x, y, 10.5 * view.xScale, 68 * s);
  }
  ctx.strokeStyle = '#a4b99870';
  ctx.lineWidth = 0.13 * s;
  rect(0, 0, 105, 68);
  line(52.5, 0, 52.5, 68);
  circle(52.5, 34, 9.15, null, '#a4b99870');
  circle(52.5, 34, 0.22, '#becfb580');
  rect(0, 13.84, 16.5, 40.32);
  rect(88.5, 13.84, 16.5, 40.32);
  rect(0, 24.84, 5.5, 18.32);
  rect(99.5, 24.84, 5.5, 18.32);
  circle(11, 34, 0.22, '#becfb590');
  circle(94, 34, 0.22, '#becfb590');
  ctx.beginPath();
  ctx.ellipse(...pt(11, 34), 9.15 * view.xScale, 9.15 * s, 0, -0.925, 0.925);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(...pt(94, 34), 9.15 * view.xScale, 9.15 * s, 0, Math.PI - 0.925, Math.PI + 0.925);
  ctx.stroke();
  [
    [0, 0, 0, Math.PI / 2],
    [105, 0, Math.PI / 2, Math.PI],
    [0, 68, -Math.PI / 2, 0],
    [105, 68, Math.PI, Math.PI * 1.5],
  ].forEach(([x, y, a, b]) => {
    ctx.beginPath();
    ctx.arc(...pt(x, y), s, a, b);
    ctx.stroke();
  });
  ctx.strokeStyle = '#b8c6ae80';
  ctx.lineWidth = 0.16 * s;
  rect(-2.3, 30.34, 2.3, 7.32);
  rect(105, 30.34, 2.3, 7.32);
  ctx.strokeStyle = '#b8c6ae25';
  ctx.lineWidth = 0.07 * s;
  for (const x of [-2.3, 105]) {
    for (let i = 1; i < 4; i++) line(x + i * 0.575, 30.34, x + i * 0.575, 37.66);
    for (let i = 1; i < 11; i++) line(x, 30.34 + i * 0.665, x + 2.3, 30.34 + i * 0.665);
  }
  ctx.font = `${1.05 * s}px ui-sans-serif, sans-serif`;
  ctx.fillStyle = '#b0c1ac70';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    match.direction(0) > 0 ? `${match.teams[0].short} →` : `← ${match.teams[0].short}`,
    ...pt(1, 71),
  );
  ctx.textAlign = 'right';
  ctx.fillText(
    match.direction(1) > 0 ? `${match.teams[1].short} →` : `← ${match.teams[1].short}`,
    ...pt(104, 71),
  );
}
function drawShape() {
  ctx.lineWidth = 0.16 * view.scale;
  ctx.setLineDash([0.5 * view.scale, 0.6 * view.scale]);
  for (const t of [0, 1]) {
    ctx.strokeStyle = t === 0 ? '#d9f58055' : '#baaff055';
    for (const slots of formationLines(match.teams[t].tactics.formation)) {
      const ps = slots
        .map(i => match.activePlayers.find(p => p.team === t && p.slot === i))
        .filter(Boolean)
        .sort((a, b) => a.y - b.y);
      ctx.beginPath();
      ps.forEach((p, i) => (i === 0 ? ctx.moveTo(...pt(p.x, p.y)) : ctx.lineTo(...pt(p.x, p.y))));
      ctx.stroke();
    }
    const p = match.players[selected];
    if (p.team === t && !p.sentOff) {
      ctx.strokeStyle = match.teams[t].color + '66';
      line(p.x, p.y, p.tx, p.ty);
      circle(p.tx, p.ty, 0.35, null, match.teams[t].color + '88');
    }
  }
  ctx.setLineDash([]);
}
function actionLabel(text, x, y, color, alpha = 1) {
  const s = view.scale,
    dpr = canvas.width / canvas.clientWidth;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${Math.max(1.22 * s, 9 * dpr)}px ui-sans-serif,system-ui,sans-serif`;
  const width = ctx.measureText(text).width + 1.25 * s;
  const [px, py] = pt(x, y);
  const left = clamp(px - width / 2, s, canvas.width - width - s);
  ctx.fillStyle = '#101a17e8';
  ctx.beginPath();
  ctx.roundRect(left, py - 1.15 * s, width, 2.35 * s, 0.4 * s);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + width / 2, py + 0.08 * s);
  ctx.restore();
}
function drawBallTrail() {
  const b = match.ball,
    s = view.scale,
    points = match.ballTrail;
  if (b.kind !== 'shot' || points.length < 2) return;
  const strength = b.strength || 0.2,
    palette =
      b.shotType === 'Curler' ? '#bcecff' : b.shotType === 'Knuckleball' ? '#e7c0ff' : '#ffe09a';
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      p = points[i];
    if (Math.hypot(a.x - p.x, a.y - p.y) > 5 || p.kind !== 'shot') continue;
    ctx.globalAlpha = (i / points.length) * (0.4 + strength * 0.45);
    ctx.strokeStyle = palette;
    ctx.lineWidth = (0.18 + strength * 0.3) * s;
    ctx.shadowColor = palette;
    ctx.shadowBlur = strength > 0.75 ? 1.5 * s : 0;
    const speed = Math.hypot(b.vx, b.vy) || 1,
      ja = b.shotType === 'Knuckleball' ? Math.sin((a.age || 0) * 28) * 0.32 : 0,
      jp = b.shotType === 'Knuckleball' ? Math.sin((p.age || 0) * 28) * 0.32 : 0;
    line(
      a.x - (b.vy / speed) * ja,
      a.y - a.z * 0.6 + (b.vx / speed) * ja,
      p.x - (b.vy / speed) * jp,
      p.y - p.z * 0.6 + (b.vx / speed) * jp,
    );
  }
  ctx.restore();
}
function drawEffects() {
  const s = view.scale;
  for (const e of match.effects) {
    const progress = 1 - e.life / e.maxLife,
      alpha = Math.min(1, e.life * 4),
      strength = e.strength || 0.2,
      color =
        e.type === 'shot'
          ? '#ffe09a'
          : e.type === 'tackle'
            ? '#ffcf91'
            : match.teams[e.team]?.color || '#ffe0a8';
    ctx.save();
    ctx.globalAlpha = alpha;
    if (e.type === 'goal') {
      ctx.lineWidth = 0.25 * s;
      for (let j = 0; j < 3; j++)
        circle(e.x, e.y, 2 + progress * 13 + j * 1.8, null, color + (j ? '55' : 'cc'));
      for (let j = 0; j < 24; j++) {
        const angle = j * 2.39996,
          radius = 2 + progress * (7 + (j % 5) * 2),
          x = e.x + Math.cos(angle) * radius,
          y = e.y + Math.sin(angle) * radius;
        ctx.fillStyle = j % 3 ? '#f0ffe5' : color;
        ctx.fillRect(...pt(x, y), 0.26 * s, 0.6 * s);
      }
      ctx.restore();
      continue;
    }
    if (e.type === 'tackle') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.18 * s;
      for (let j = 0; j < Math.round(4 + strength * 5); j++) {
        const a = (j * Math.PI * 2) / Math.round(4 + strength * 5),
          inner = 0.9 + progress * 2,
          outer = inner + (1 + strength * 1.2) * (1 - progress);
        line(
          e.x + Math.cos(a) * inner,
          e.y + Math.sin(a) * inner,
          e.x + Math.cos(a) * outer,
          e.y + Math.sin(a) * outer,
        );
      }
    } else if (e.type === 'shot') {
      const angle = Math.atan2(e.ty - e.y, e.tx - e.x);
      ctx.strokeStyle = color;
      ctx.lineWidth = (0.13 + strength * 0.1) * s;
      const [x, y] = pt(e.x, e.y);
      ctx.beginPath();
      ctx.arc(x, y, (1.3 + progress * 2.5) * s, angle + 1.4, angle + 4.8);
      ctx.stroke();
      if (strength > 0.75) {
        for (const side of [-1, 1])
          line(
            e.x - Math.cos(angle) * progress * 4 - Math.sin(angle) * side,
            e.y - Math.sin(angle) * progress * 4 + Math.cos(angle) * side,
            e.x - Math.cos(angle) * (progress * 4 + 2) - Math.sin(angle) * side,
            e.y - Math.sin(angle) * (progress * 4 + 2) + Math.cos(angle) * side,
          );
      }
    } else if (e.type === 'feint') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.23 * s;
      ctx.beginPath();
      ctx.arc(...pt(e.x, e.y), (1.8 + progress * 1.3) * s, e.angle - 1.4, e.angle + 1.4);
      ctx.stroke();
    } else if (e.type === 'catch' || e.type === 'parry') {
      ctx.lineWidth = 0.15 * s;
      circle(e.x, e.y, 1.6 + progress * 1.7, null, '#b8eee7');
    } else if (e.type === 'delivery') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.14 * s;
      ctx.setLineDash([0.4 * s, 0.6 * s]);
      circle(e.x, e.y, 1.8 + progress * 1.2, null, color);
      ctx.setLineDash([]);
    }
    actionLabel(e.label || e.type.toUpperCase(), e.x, e.y - 4 - progress * 0.6, color, alpha);
    ctx.restore();
  }
}
function drawReceiptNames() {
  if (!canvas.clientWidth) return;
  const s = view.scale,
    dpr = canvas.width / canvas.clientWidth,
    font = Math.max(1.45 * s, 14 * dpr),
    placed = [];
  ctx.save();
  ctx.font = `550 ${font}px ui-sans-serif,system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d5d8d6';
  ctx.shadowColor = '#0c171bd9';
  ctx.shadowBlur = 2 * dpr;
  ctx.shadowOffsetY = dpr;
  for (const p of [...match.activePlayers].sort((a, b) => b.possessionAt - a.possessionAt)) {
    const label = receiptLabel(
      p,
      match.elapsed,
      CONFIG.display.receiptLabelDuration,
      CONFIG.display.receiptLabelHold,
    );
    if (!label) continue;
    const width = Math.min(
        ctx.measureText(label.text).width,
        Math.min(26 * s, canvas.width - 16 * dpr),
      ),
      [px, py] = pt(p.x, p.y),
      x = clamp(px, width / 2 + 8 * dpr, canvas.width - width / 2 - 8 * dpr);
    let y = py + Math.max(2.6 * s * CONFIG.display.playerRadius, font * 1.2);
    for (
      let n = 0;
      n < placed.length &&
      placed.some(
        r => Math.abs(x - r.x) < (width + r.width) / 2 + 4 * dpr && Math.abs(y - r.y) < font * 1.15,
      );
      n++
    )
      y += font * 1.2;
    y = clamp(y, font, canvas.height - font);
    placed.push({ x, y, width });
    ctx.globalAlpha = label.opacity;
    ctx.fillText(label.text, x, y, width);
  }
  ctx.restore();
}
function draw() {
  drawPitch();
  if (!rosterReady) return;
  if (showShape) drawShape();
  const s = view.scale;
  for (const p of match.activePlayers) {
    const color = match.teams[p.team].color;
    if (showTrails && p.trail.length > 1) {
      ctx.lineWidth = 0.23 * s;
      ctx.lineCap = 'round';
      for (let i = 1; i < p.trail.length; i++) {
        ctx.globalAlpha = (i / p.trail.length) * 0.1;
        ctx.strokeStyle = color;
        line(p.trail[i - 1].x, p.trail[i - 1].y, p.trail[i].x, p.trail[i].y);
      }
      ctx.globalAlpha = 1;
    }
    if (p.id === selected) {
      ctx.lineWidth = 0.2 * s;
      circle(p.x, p.y, 1.9, null, color + 'ab');
      ctx.lineWidth = 0.1 * s;
      circle(p.x, p.y, 2.25, null, color + '28');
    }
    if (p.id === hovered && p.id !== selected) {
      ctx.lineWidth = 0.13 * s;
      circle(p.x, p.y, 1.8, null, color + '99');
    }
    circle(p.x + 0.16, p.y + 0.3, 1.3, '#08170c55');
    if (match.ball.owner === p.id) {
      ctx.lineWidth = 0.12 * s;
      circle(p.x, p.y, 1.62, null, '#ffffff80');
    }
    const animation = p.animation;
    const phase = animation
      ? clamp((match.elapsed - animation.start) / animation.duration, 0, 1)
      : 0;
    const r = Math.max(1.27, 6.5 / (canvas.clientWidth / 115)) * CONFIG.display.playerRadius;
    if (animation && ['dive', 'tackle', 'shot'].includes(animation.type)) {
      const [ax, ay] = pt(p.x, p.y);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(animation.angle || p.facing);
      ctx.fillStyle = color + '55';
      ctx.beginPath();
      ctx.ellipse(
        -Math.sin(phase * Math.PI) * r * s * 0.7,
        0,
        r * s * (1 + Math.sin(phase * Math.PI) * 1.1),
        r * s * 0.7,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
    ctx.lineWidth = 0.22 * s;
    circle(
      p.x,
      p.y,
      r,
      p.role === 'GK' ? (p.team === 0 ? '#ebb981' : '#82cbd0') : color,
      match.teams[p.team].secondary || '#ffffff',
    );
    if (animation?.type === 'beaten' || animation?.type === 'stumble') {
      ctx.strokeStyle = '#ffcf8277';
      ctx.lineWidth = 0.14 * s;
      circle(p.x, p.y, r + 0.55, null, '#ffcf8277');
    }
    const velocity = Math.hypot(p.vx, p.vy);
    if (velocity > p.topSpeed() * 0.86) {
      ctx.strokeStyle = color + 'a0';
      ctx.lineWidth = 0.17 * s;
      for (const off of [-0.6, 0.6]) {
        const px = p.x - Math.cos(p.facing) * 2 - Math.sin(p.facing) * off,
          py = p.y - Math.sin(p.facing) * 2 + Math.cos(p.facing) * off;
        line(
          px,
          py,
          px - Math.cos(p.facing) * (velocity - 5) * 0.65,
          py - Math.sin(p.facing) * (velocity - 5) * 0.65,
        );
      }
    }
    ctx.lineWidth = 0.1 * s;
    const [cx, cy] = pt(p.x, p.y);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(p.facing) * 1.27 * s, cy + Math.sin(p.facing) * 1.27 * s);
    ctx.lineTo(cx + Math.cos(p.facing) * 1.65 * s, cy + Math.sin(p.facing) * 1.65 * s);
    ctx.strokeStyle = color + 'bb';
    ctx.stroke();
    ctx.fillStyle = kitText(color);
    ctx.font = `650 ${Math.max(1.24 * s, 8 * (canvas.width / canvas.clientWidth))}px ui-sans-serif,system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(playerInitials(p), cx, cy + 0.06 * s, r * s * 1.75);
    if (p.yellowCards) {
      ctx.fillStyle = '#f7d34e';
      ctx.strokeStyle = '#292611';
      ctx.lineWidth = 0.12 * s;
      ctx.beginPath();
      ctx.roundRect(cx + r * s * 0.65, cy - r * s * 1.2, 0.7 * s, 1.02 * s, 0.1 * s);
      ctx.fill();
      ctx.stroke();
    }
  }
  drawEffects();
  const b = match.ball;
  drawBallTrail();
  circle(b.x + 0.17, b.y + 0.25, 0.46, '#08100ab0');
  const bx = b.x,
    by = b.y - b.z * 0.6;
  ctx.shadowBlur = 3 * s;
  ctx.shadowColor = '#ffffff33';
  circle(
    bx,
    by,
    Math.max(0.46 + b.z * 0.05, 2.0 / (canvas.clientWidth / 115)) * CONFIG.display.ballRadius,
    '#fafcf4',
    '#16261a',
  );
  ctx.shadowBlur = 0;
  circle(bx - 0.11, by - 0.12, 0.1, '#ffffff');
  if (b.kind === 'shot') {
    const v = Math.hypot(b.vx, b.vy);
    if (v > 0) {
      ctx.strokeStyle = '#ffffe275';
      ctx.lineWidth = 0.17 * s;
      line(bx, by, bx - (b.vx / v) * 2, by - (b.vy / v) * 2);
    }
  }
  if (playback.paused) {
    ctx.fillStyle = '#0b150614';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawReceiptNames();
  const focus = hovered !== null ? match.players[hovered] : null;
  if (focus && !focus.sentOff) {
    const label = `${focus.name} · ${focus.role} · OVR ${overallRating(focus)} · ${focus.yellowCards ? 'Booked · ' : ''}${focus.displayAction(match.elapsed)}`;
    ctx.font = `500 ${1.3 * s}px ui-sans-serif,sans-serif`;
    const w = ctx.measureText(label).width + 2 * s;
    const [x, y] = pt(focus.x, focus.y - 3.4);
    const left = clamp(x - w / 2, 4 * s, canvas.width - w - 4 * s);
    ctx.fillStyle = '#101a16ed';
    ctx.beginPath();
    ctx.roundRect(left, y - 1.35 * s, w, 2.8 * s, 0.5 * s);
    ctx.fill();
    ctx.fillStyle = '#edf2e9';
    ctx.textAlign = 'center';
    ctx.fillText(label, left + w / 2, y + 0.1 * s);
  }
}
function playerAt(e) {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 115 - 5,
    y = ((e.clientY - r.top) / r.height) * 80 - 5;
  let best = null,
    nearest = 3;
  for (const p of match.activePlayers) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < nearest) {
      nearest = d;
      best = p.id;
    }
  }
  return best;
}
canvas.addEventListener('pointermove', e => {
  hovered = playerAt(e);
  canvas.style.cursor = hovered === null ? 'default' : 'pointer';
});
canvas.addEventListener('pointerleave', () => (hovered = null));
canvas.addEventListener('click', e => {
  const id = playerAt(e);
  if (id !== null) {
    selectPlayer(id);
    setTab('player');
  }
});

function trails() {
  for (const p of match.activePlayers) {
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 12) p.trail.shift();
  }
  match.ballTrail.push({
    x: match.ball.x,
    y: match.ball.y,
    z: match.ball.z,
    kind: match.ball.kind,
    age: match.ball.age,
  });
  if (match.ballTrail.length > 10) match.ballTrail.shift();
}
function frame(now) {
  if (screen !== 'match') {
    playback.frame(now, true);
    requestAnimationFrame(frame);
    return;
  }
  const delta = playback.frame(
    now,
    busy || match.finished || document.hidden || screen !== 'match',
  );
  if (delta > 0) {
    if (recording) {
      playhead = Math.min(recording.viewDuration || 60, playhead + delta);
      const previousClip = clipNumber;
      clipNumber = applyReplayFrame(match, recording, playhead);
      if (previousClip !== clipNumber) {
        sound.stop();
        matchSounds.reset(match);
        for (const p of match.players) p.trail = [];
        lastEvents = '';
      }
      if (playhead >= (recording.viewDuration || 60)) {
        match = recording.result;
        recording = null;
        matchSounds.reset(match);
        playback.setPaused(true, now);
        selectPlayer(selected);
        loadTactics();
        if (match.mode === 'halftime') presentHalftime();
        else updateUI();
      }
    } else {
      const ticks = playback.ticks(delta);
      for (let i = 0; i < ticks && !match.finished; i++) {
        match.step(1 / 60);
        if (match.mode === 'halftime') {
          presentHalftime();
          break;
        }
        trailTime += 1 / 60;
        if (trailTime > 0.05) {
          trailTime = 0;
          trails();
        }
      }
    }
  }
  if (delta > 0)
    matchSounds.update(match, {
      audible: !document.hidden && match.mode !== 'halftime' && !match.finished,
    });
  if (screen === 'match') {
    uiTimer++;
    if (uiTimer >= 7) {
      updateUI();
      uiTimer = 0;
    }
    draw();
  }
  requestAnimationFrame(frame);
}
async function launchGame(settings) {
  gameMode = settings.mode;
  difficulty = settings.difficulty;
  if (gameMode === 'pvp' && !['quick', 'full'].includes(viewMode)) viewMode = 'quick';
  match = new Match(
    crypto.getRandomValues(new Uint32Array(1))[0],
    viewMode === 'quick' ? 180 : 300,
  );
  const config = match.exportConfig();
  config.competition = { mode: gameMode, difficulty, funding: settings.funding || 'takeover' };
  settings.teams.forEach((t, i) => {
    const kit = KITS[t.kit];
    Object.assign(config.teams[i], {
      name: t.name,
      short: playerInitials({ name: t.name }),
      color: t.color || kit.primary,
      secondary: t.secondary || kit.secondary,
      clubId: t.clubId || null,
      clubName: t.clubName || null,
    });
    config.teams[i].tactics.formation = t.formation;
  });
  if (settings.players) config.players = settings.players;
  match.importConfig(config);
  rosterReady = !!settings.players;
  await resetMatch({ redraw: !settings.players });
  coachAI(match, true);
  syncTeams();
  selectPlayer(selected);
  loadTactics();
  updateUI();
  resize();
}
function newGame() {
  gameUI.showHome();
}
function syncTeams() {
  for (const [i, side] of ['home', 'away'].entries()) {
    const team = match.teams[i];
    document.documentElement.style.setProperty(`--${side}-color`, team.color);
    document.documentElement.style.setProperty(`--${side}-trim`, team.secondary || team.color);
    document
      .querySelector(`.line-ratings.${side}`)
      .setAttribute('aria-label', `${team.name} ratings`);
    $(`#${side}-name`).textContent = team.name;
    $(`#${side}-name`).title = team.name;
    $(`#${side}-badge`).textContent = team.short;
    $(`#${side}-badge`).style.cssText =
      `background:${team.color};border-color:${team.secondary};color:${kitText(team.color)}`;
    document.querySelector(`[data-team="${i}"]`).textContent = team.name;
    $('#squad-team').options[i].textContent = team.name;
    const legend = document.querySelectorAll('.pitch-legend>span')[i ? 2 : 0];
    legend.replaceChildren();
    const dot = document.createElement('i');
    dot.style.background = team.color;
    legend.append(dot, document.createTextNode(' ' + team.short));
  }
  $('#match-mode-label').textContent =
    gameMode === 'ai'
      ? `CLASSIC · ${DIFFICULTIES[difficulty].label.toUpperCase()}`
      : gameMode === 'pvp'
        ? 'PLAYER VS PLAYER'
        : 'SANDBOX';
  document.querySelectorAll('[data-mode]').forEach(b => {
    b.disabled = gameMode === 'pvp' && ['highlights', 'instant'].includes(b.dataset.mode);
    b.title = b.disabled
      ? 'Player vs player uses continuous play for shared tactical decisions.'
      : '';
    b.classList.toggle('active', b.dataset.mode === viewMode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === viewMode));
  });
  $('#lineup-team').innerHTML = match.teams
    .map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`)
    .join('');
}
function renderLineupEditor() {
  const ps = match.players.filter(p => p.team === lineupTeam),
    team = match.teams[lineupTeam];
  if (!ps.some(p => p.id === lineupSelection)) lineupSelection = ps.find(p => p.role === 'ST').id;
  const focus = match.players[lineupSelection];
  selected = lineupSelection;
  const locked = lineupLocked();
  $('#lineup-dialog').dataset.locked = String(locked);
  miniPitch(
    $('#lineup-pitch'),
    FORMATIONS[team.tactics.formation],
    FORMATIONS[team.tactics.formation].map((_, slot) => ps.find(p => p.slot === slot)),
    {
      color: team.color,
      secondary: team.secondary,
      selected: focus.slot,
      onSelect: (_, p) => {
        lineupSelection = p.id;
        renderLineupEditor();
        showPlayerCard(p, p.role, {
          team: team.name,
          color: team.color,
          secondary: team.secondary,
        });
      },
    },
  );
  $('#lineup-team').value = lineupTeam;
  $('#lineup-selection').textContent = focus.name;
  $('#lineup-detail').textContent =
    `${focus.role} · OVR ${overallRating(focus)} · ${Math.round(positionFamiliarity(focus) * 100)}% familiar · ${playerTier(focus).name}`;
  $('#lineup-note').textContent =
    gameMode !== 'sandbox'
      ? gameMode === 'ai' && lineupTeam === 1
        ? 'AI controlled.'
        : 'Formation and positions can only be changed at halftime.'
      : locked
        ? 'Inspect your XI. Positions can be rearranged before kickoff and at half-time.'
        : 'Select a circle to inspect, swap positions, or find the best fit for this formation.';
  $('#lineup-auto').hidden = gameMode !== 'sandbox' && locked;
  $('#lineup-swap').closest('label').hidden = gameMode !== 'sandbox' && locked;
  $('#lineup-auto').disabled = locked || ps.some(p => p.sentOff);
  $('#lineup-replace').hidden = gameMode !== 'sandbox';
  $('#lineup-replace').disabled = catalogLocked();
  $('#lineup-swap').disabled = locked;
  $('#lineup-swap').innerHTML = ps
    .map(
      p =>
        `<option value="${p.id}" ${p.sentOff ? 'disabled' : ''}>${escapeHtml(p.role + ' · ' + p.name)}${p.sentOff ? ' · Sent off' : ''}</option>`,
    )
    .join('');
  $('#lineup-swap').value = focus.id;
  renderSquadList(
    $('#lineup-roster'),
    FORMATIONS[team.tactics.formation],
    FORMATIONS[team.tactics.formation].map((_, slot) => ps.find(p => p.slot === slot)),
    {
      onSelect: (_, p) => {
        lineupSelection = p.id;
        renderLineupEditor();
        showPlayerCard(p, p.role, {
          team: team.name,
          color: team.color,
          secondary: team.secondary,
        });
      },
    },
  );
}
$('#lineup-button').onclick = () => {
  lineupTeam = match.players[selected].team;
  lineupSelection = selected;
  renderLineupEditor();
  $('#lineup-dialog').showModal();
};
$('#close-lineup').onclick = () => $('#lineup-dialog').close();
$('#lineup-dialog').addEventListener('close', () => selectPlayer(lineupSelection));
$('#lineup-team').onchange = e => {
  lineupTeam = Number(e.target.value);
  renderLineupEditor();
};
$('#lineup-inspect').onclick = () => {
  $('#lineup-dialog').close();
  selectPlayer(lineupSelection);
  setTab('player');
};
$('#lineup-replace').onclick = () => {
  if (catalogLocked()) return;
  $('#lineup-dialog').close();
  selectPlayer(lineupSelection);
  openCatalog();
};
$('#lineup-swap').onchange = e => {
  if (lineupLocked()) return;
  const target = Number(e.target.value);
  if (match.swapLineup(lineupSelection, target)) {
    lineupSelection = target;
    renderLineupEditor();
    selectPlayer(target);
    updateUI();
  }
};
$('#lineup-auto').onclick = () => {
  if (lineupLocked() || match.players.some(p => p.team === lineupTeam && p.sentOff)) return;
  const players = match.players.filter(p => p.team === lineupTeam),
    fit = bestSlots(players, match.teams[lineupTeam].tactics.formation, {
      keeperId: match.mode === 'halftime' ? lineupTeam * 11 : null,
    });
  if (match.mode === 'halftime') {
    fit.forEach((p, slot) => {
      p.slot = slot;
      p.role = FORMATIONS[match.teams[lineupTeam].tactics.formation][slot][2];
    });
  } else {
    const c = match.exportConfig();
    fit.forEach((p, slot) => (c.players[lineupTeam * 11 + slot] = match.playerProfile(p)));
    match.importConfig(c);
  }
  renderLineupEditor();
  selectPlayer(lineupSelection);
  updateUI();
};
document.addEventListener('visibilitychange', () => {
  playback.last = performance.now();
  playback.accumulator = 0;
});
selectPlayer(selected);
loadTactics();
updateUI();
gameUI = createGameUI({
  loadCatalog,
  onLaunch: launchGame,
  onSound: cue => sound.play(cue),
  onScreen: name => {
    sound.stop();
    screen = name;
    if (name !== 'match') {
      pitchFullscreen.exit();
      playback.setPaused(true, performance.now());
    } else requestAnimationFrame(resize);
  },
  onResume: () => {
    resize();
    updateUI();
  },
});
requestAnimationFrame(frame);
