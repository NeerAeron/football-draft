// Advanced tuning page (config.html): every CONFIG field by section, saved on this device.
// Draft odds are shown for the draft session (core/draft/session.js) on a full pool.
import {
  DEFAULT_CONFIG,
  CONFIG_FIELDS,
  configField,
  loadConfig,
  saveConfig,
  normalizeConfig,
  setRuntimeConfig,
  configValue,
  setConfigValue,
} from '../core/config/config.js';
import { catalogIndex, draftRules } from '../core/draft/pools.js';
import { clubSquads } from '../core/players/club-lineups.js';
import { loadWarmCatalog } from '../ui/lib/catalog-warm.js';
import { BADGES } from '../core/players/traits.js';
import { ATTRS, playerTier } from '../core/players/ratings.js';
import { escapeHtml } from '../core/util/text.js';
const $ = s => document.querySelector(s),
  esc = escapeHtml;
let draft = loadConfig(),
  active = 'draft',
  data = null,
  clubLeague = '',
  clubQuery = '',
  clubLimit = 40,
  role = 'ST',
  timer;
const sections = [
  [
    'draft',
    'Draft rules',
    'Nations field and call-ups, spin odds, re-rolls, the opponent ladder and Links. Daily Challenges and challenge links always use the defaults.',
    p => p.startsWith('draft.'),
  ],
  [
    'leagues',
    'League odds',
    'First-spin chances on a full pool, from the tier weights in Draft rules. Drafted players and the keeper guard change later spins.',
    () => false,
  ],
  [
    'clubs',
    'Club odds',
    'Clubs spins land a league first, then a club of that league (clubs with enough players). Chances within the selected league on a full pool.',
    () => false,
  ],
  [
    'playerTiers',
    'Player tiers',
    'Natural-position overall determines tier and badge allowance.',
    p => p.startsWith('playerTiers.'),
  ],
  [
    'teamTiers',
    'Team tiers',
    'Median of the top ten natural player ratings. Partial clubs use their available players.',
    p => p.startsWith('teamTiers.'),
  ],
  [
    'ai',
    'AI decisions',
    'Club XIs and in-match coaching. Match physics stay the same.',
    p => p.startsWith('ai.'),
  ],
  [
    'gameplay',
    'Gameplay',
    '1.00 is the baseline. Actual rates emerge from the players, tactics and match situation.',
    p => p.startsWith('gameplay.'),
  ],
  [
    'discipline',
    'Cards',
    'Card severity and caution after a booking.',
    p => p.startsWith('discipline.'),
  ],
  [
    'stamina',
    'Stamina & time',
    'Stamina recovery and added time. Sprint reserves use real seconds.',
    p => p.startsWith('stamina.') || p.startsWith('periods.'),
  ],
  [
    'formats',
    'Match formats',
    'Chance creation and execution for each match length.',
    p => p.startsWith('formats.'),
  ],
  [
    'ratings',
    'Overall & positions',
    'Overall weights are normalized within each position.',
    p => p.startsWith('ratings.'),
  ],
  [
    'badges',
    'Badge boosts',
    'Bonuses are added to base abilities up to the shared cap.',
    p => p.startsWith('badges.'),
  ],
  [
    'display',
    'Display & motion',
    'Circle sizes are multipliers. These controls do not change collision geometry.',
    p => p.startsWith('display.'),
  ],
];
const status = (text, error = false) => {
  $('#config-status').textContent = text;
  $('#config-status').classList.toggle('error', error);
};
function edit(path, value) {
  setConfigValue(draft, path, value);
  status('Unsaved changes');
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      setRuntimeConfig(draft);
      refreshSummary();
    } catch (e) {
      status(e.message, true);
    }
  }, 180);
}
const percentField = f =>
  f.path.startsWith('badges.tendencies.') ||
  [
    'halftimeRecovery',
    'minimumFit',
    'storedTendencyWeight',
    'familiarityBase',
    'familiarityBonus',
    'unfamiliarFit',
    'fatigueThreshold',
  ].includes(f.key);
function input(field) {
  const scale = percentField(field) ? 100 : 1,
    value = configValue(draft, field.path) ?? field.defaultValue;
  if (typeof field.defaultValue === 'boolean')
    return `<input type="checkbox" data-setting="${field.path}" ${value ? 'checked' : ''} aria-label="${esc(field.label)}">`;
  return `<input type="number" data-setting="${field.path}" value="${Number((value * scale).toFixed(4))}" min="${field.min * scale}" max="${field.max * scale}" step="${Math.abs((value - field.min) / field.step - Math.round((value - field.min) / field.step)) > 1e-7 ? 'any' : field.step * scale}" aria-label="${esc(field.path.startsWith('badges.boosts.') ? ATTRS[field.key] || field.label : field.label)}">`;
}
function bindInputs() {
  document.querySelectorAll('[data-setting]').forEach(
    node =>
      (node.oninput = () => {
        const field = configField(node.dataset.setting);
        if (node.type === 'number' && (!node.validity.valid || node.value === '')) {
          status('Check the value for ' + field.label + '.', true);
          return;
        }
        edit(
          field.path,
          node.type === 'checkbox'
            ? node.checked
            : node.type === 'number'
              ? Number(node.value) / (percentField(field) ? 100 : 1)
              : node.value,
        );
      }),
  );
}
const GROUP_LABELS = {
  draft: 'Leagues',
  'draft.nations': 'Nations: field and call-ups',
  'draft.leagueTierWeights': 'Leagues spin: weight by league tier',
  'draft.clubs': 'Clubs spin',
  'draft.clubs.leagueTierWeights': 'Clubs spin: league weight by tier',
  'draft.clubs.tierWeights': 'Clubs spin: club weight by club tier',
  'draft.rerolls': 'Re-rolls per drafter',
  'draft.ladder': 'Opponent strength vs a typical draft (effective rating)',
  'draft.links': 'Links',
  'draft.links.club': 'Links · same club',
  'draft.links.nation': 'Links · same nation',
  'draft.links.league': 'Links · same league',
};
function groupLabel(path) {
  if (GROUP_LABELS[path]) return GROUP_LABELS[path];
  const parts = path.split('.');
  if (parts[0] === 'formats') return parts[1] === '180' ? '3-minute match' : '5-minute match';
  if (parts[0] === 'badges' && parts[1] === 'tendencies') return 'Tendency · ' + parts[2];
  if (parts[0] === 'badges' && parts[1] === 'boosts')
    return BADGES.find(b => b.id === parts[2])?.label || parts[2];
  if (parts[0] === 'playerTiers') return parts[1];
  if (parts[0] === 'ratings' && parts[1] === 'roleWeights') return 'Overall weights';
  if (parts[0] === 'ratings' && parts[1] === 'roleOffsets') return 'Position calibration';
  return (
    parts
      .slice(1)
      .join(' · ')
      .replace(/([a-z])([A-Z])/g, '$1 $2') || sections.find(s => s[0] === active)?.[1]
  );
}
async function catalog() {
  if (!data) {
    data = await loadWarmCatalog();
    navigation(); // league and club counts
  }
  return data;
}
function navigation() {
  const query = $('#config-search').value.trim().toLowerCase();
  $('#config-navigation').innerHTML = sections
    .map(([id, label, , match]) => {
      const count =
        id === 'leagues'
          ? (index()?.leagues.length ?? '')
          : id === 'clubs'
            ? (index()?.clubs.size ?? '')
            : CONFIG_FIELDS.filter(
                f =>
                  match(f.path) &&
                  (!query || (f.path + ' ' + f.label).toLowerCase().includes(query)),
              ).length;
      return `<button type="button" data-section="${id}" class="${id === active ? 'active' : ''}">${label}<small>${count}</small></button>`;
    })
    .join('');
  document.querySelectorAll('[data-section]').forEach(
    b =>
      (b.onclick = () => {
        active = b.dataset.section;
        render();
      }),
  );
}
async function render() {
  navigation();
  const section = sections.find(s => s[0] === active),
    query = $('#config-search').value.trim().toLowerCase();
  $('#config-title').textContent = section[1];
  $('#config-reset-section').hidden = ['leagues', 'clubs'].includes(active);
  $('#config-description').textContent = section[2];
  $('#config-summary').textContent = '';
  if (['leagues', 'clubs'].includes(active)) {
    await renderOdds();
    return;
  }
  const fields = CONFIG_FIELDS.filter(
    f =>
      section[3](f.path) &&
      (!query || (f.path + ' ' + f.label).toLowerCase().includes(query)) &&
      (active !== 'ratings' ||
        !f.path.startsWith('ratings.roleWeights.') ||
        f.path.split('.')[2] === role),
  );
  const groups = new Map();
  for (const f of fields) {
    const group = f.path.split('.').slice(0, -1).join('.');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(f);
  }
  $('#config-fields').innerHTML =
    (active === 'ratings'
      ? `<label class="role-filter">Position<select id="rating-role">${Object.keys(
          draft.ratings.roleWeights,
        )
          .map(p => `<option${p === role ? ' selected' : ''}>${p}</option>`)
          .join('')}</select></label>`
      : '') +
    [...groups]
      .map(
        ([group, fs]) =>
          `<fieldset><legend>${esc(groupLabel(group))}</legend>${fs
            .map(f => {
              const label = f.path.startsWith('badges.tendencies.')
                ? BADGES.find(b => b.id === f.key)?.label || f.label
                : f.path.startsWith('badges.boosts.') || f.path.startsWith('ratings.roleWeights.')
                  ? ATTRS[f.key] || f.label
                  : f.label;
              return `<label class="config-row"><span>${esc(label)}${percentField(f) ? ' (%)' : ''}<small>Default ${percentField(f) ? Number((f.defaultValue * 100).toFixed(3)) + '%' : f.defaultValue}</small></span>${input(f)}</label>`;
            })
            .join('')}</fieldset>`,
      )
      .join('');
  if (!fields.length)
    $('#config-fields').insertAdjacentHTML(
      'beforeend',
      '<p>No matching settings in this section.</p>',
    );
  if ($('#rating-role'))
    $('#rating-role').onchange = e => {
      role = e.target.value;
      render();
    };
  bindInputs();
  refreshSummary();
}
async function refreshSummary() {
  if (!['draft', 'teamTiers', 'playerTiers', 'ai', 'ratings'].includes(active)) return;
  try {
    const current = active;
    await catalog();
    if (current !== active) return;
    if (active === 'ratings') {
      const weights = draft.ratings.roleWeights[role],
        sum = Object.values(weights).reduce((a, b) => a + b, 0);
      $('#config-summary').innerHTML = `<div class="weight-summary">${Object.entries(weights)
        .filter(([, v]) => v)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<span>${esc(ATTRS[k])} <b>${((v / sum) * 100).toFixed(1)}%</b></span>`)
        .join('')}</div>`;
      return;
    }
    if (active === 'draft') {
      const ix = index(),
        spinnable = ix.leagues.reduce((n, l) => n + l.spinnableClubs.length, 0);
      $('#config-summary').innerHTML =
        `<div class="summary-chips"><span>Nations field <b>${ix.field.length}</b></span><span>Leagues <b>${ix.leagues.length}</b></span><span>Spinnable clubs <b>${spinnable}</b></span></div>`;
      return;
    }
    const clubs = clubSquads(data);
    if (active === 'teamTiers')
      $('#config-summary').innerHTML = `<div class="summary-chips">${Object.keys(draft.teamTiers)
        .map(
          t =>
            `<span><b>${t}</b> ${clubs.filter(c => c.tier === t).length} clubs · ${clubs.filter(c => c.tier === t && c.formations.length).length} complete XIs</span>`,
        )
        .join('')}</div>`;
    if (active === 'playerTiers') {
      const counts = {};
      for (const p of data.players) {
        const tier = playerTier(p).name;
        counts[tier] = (counts[tier] || 0) + 1;
      }
      $('#config-summary').innerHTML = `<div class="summary-chips">${Object.keys(draft.playerTiers)
        .map(t => `<span>${t} <b>${counts[t] || 0}</b></span>`)
        .join('')}</div>`;
    }
    if (active === 'ai')
      $('#config-summary').innerHTML =
        `<div class="summary-chips"><span>Clubs with a complete XI <b>${clubs.filter(c => c.formations.length).length}</b> of ${clubs.length}</span></div>`;
  } catch (e) {
    status(e.message, true);
  }
}
// The draft-session index for the edited rules (cached per catalog + rules + ratings).
function index() {
  if (!data) return null;
  try {
    return catalogIndex(data, draftRules(draft.draft));
  } catch {
    return catalogIndex(data, draftRules(DEFAULT_CONFIG.draft));
  }
}
const percent = (weight, total) => (total ? ((weight / total) * 100).toFixed(2) + '%' : '—');
// Same weights as DraftSession#draw on a full pool (no exclusions, every slot open).
function leagueOdds(ix) {
  const rules = draft.draft,
    leagueWeight = l => rules.leagueTierWeights[l.tier] ?? 0,
    clubsWeight = l =>
      l.spinnableClubs.length
        ? (rules.clubs.leagueTierWeights?.[l.tier] ?? rules.leagueTierWeights[l.tier] ?? 0)
        : 0;
  const totals = [leagueWeight, clubsWeight].map(w => ix.leagues.reduce((n, l) => n + w(l), 0));
  return ix.leagues.map(l => ({
    league: l,
    leagues: percent(leagueWeight(l), totals[0]),
    clubs: percent(clubsWeight(l), totals[1]),
  }));
}
async function renderOdds() {
  $('#config-fields').textContent = 'Loading…';
  const selected = active;
  try {
    await catalog();
    if (selected !== active) return;
    const ix = index(),
      query = $('#config-search').value.trim().toLowerCase();
    if (active === 'leagues') {
      const rows = leagueOdds(ix).filter(r =>
        (r.league.name + ' ' + r.league.id).toLowerCase().includes(query),
      );
      $('#config-fields').innerHTML =
        `<div class="config-table"><table><thead><tr><th>League</th><th>Players</th><th>Spinnable clubs</th><th>Leagues spin</th><th>Clubs spin</th></tr></thead><tbody>${rows
          .map(
            ({ league: l, leagues, clubs }) =>
              `<tr data-league="${esc(l.id)}"><td><strong>${l.tier} · ${esc(l.name)}</strong></td><td>${l.players.length}</td><td>${l.spinnableClubs.length}</td><td>${leagues}</td><td>${clubs}</td></tr>`,
          )
          .join('')}</tbody></table></div>`;
    } else {
      const choices = ix.leagues.filter(l => l.spinnableClubs.length);
      if (!choices.some(l => l.id === clubLeague)) clubLeague = choices[0]?.id || '';
      const league = ix.leagueById.get(clubLeague),
        weight = c => draft.draft.clubs.tierWeights?.[c.tier] ?? 1,
        total = (league?.spinnableClubs || []).reduce((n, c) => n + weight(c), 0),
        clubs = (league?.spinnableClubs || []).filter(c =>
          (c.name + ' ' + c.id).toLowerCase().includes((clubQuery || query).toLowerCase()),
        );
      $('#config-fields').innerHTML =
        `<div class="odds-filters"><select id="odds-league" aria-label="League">${choices.map(l => `<option value="${esc(l.id)}"${l.id === clubLeague ? ' selected' : ''}>${l.tier} · ${esc(l.name)}</option>`).join('')}</select><input id="odds-club-search" type="search" placeholder="Find a club" value="${esc(clubQuery)}" aria-label="Find a club"></div><div class="config-table"><table><thead><tr><th>Club</th><th>Best-XI OVR</th><th>Players</th><th>Club chance</th></tr></thead><tbody>${clubs
          .slice(0, clubLimit)
          .map(
            c =>
              `<tr data-club="${esc(c.id)}"><td><strong>${c.tier || '–'} · ${esc(c.name)}</strong></td><td>${c.strength.toFixed(1)}</td><td>${c.players.length}</td><td>${percent(weight(c), total)}</td></tr>`,
          )
          .join(
            '',
          )}</tbody></table></div>${clubs.length > clubLimit ? '<button id="more-club-odds" type="button">Show more</button>' : ''}`;
      $('#odds-league').onchange = e => {
        clubLeague = e.target.value;
        clubLimit = 40;
        renderOdds();
      };
      $('#odds-club-search').onchange = e => {
        clubQuery = e.target.value;
        clubLimit = 40;
        renderOdds();
      };
      if ($('#more-club-odds'))
        $('#more-club-odds').onclick = () => {
          clubLimit += 40;
          renderOdds();
        };
    }
    navigation();
  } catch (e) {
    $('#config-fields').textContent = '';
    status(e.message, true);
  }
}
$('#config-search').oninput = () => {
  clearTimeout(timer);
  timer = setTimeout(render, 180);
};
$('#config-save').onclick = () => {
  try {
    const invalid = [...document.querySelectorAll('[data-setting]')].find(
      n => !n.validity.valid || (n.type === 'number' && n.value === ''),
    );
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      throw Error('Correct the highlighted setting before saving.');
    }
    draft = saveConfig(draft);
    setRuntimeConfig(draft);
    status('Saved. New games will use these settings.');
  } catch (e) {
    status(e.message, true);
  }
};
$('#config-reset-section').onclick = () => {
  const match = sections.find(s => s[0] === active)[3];
  for (const f of CONFIG_FIELDS.filter(f => match(f.path)))
    setConfigValue(draft, f.path, f.defaultValue);
  try {
    setRuntimeConfig(draft);
    render();
    status('Section reset. Save to apply.');
  } catch (e) {
    render();
    status(e.message, true);
  }
};
$('#config-reset-all').onclick = () => {
  draft = structuredClone(DEFAULT_CONFIG);
  setRuntimeConfig(draft);
  render();
  status('Defaults restored. Save to apply.');
};
$('#config-export').onclick = () => {
  try {
    const value = normalizeConfig(draft),
      blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'football-draft-config.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    status(e.message, true);
  }
};
$('#config-import').onchange = async e => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1000000) throw Error('Choose a settings JSON under 1 MB.');
    draft = normalizeConfig(JSON.parse(await file.text()));
    setRuntimeConfig(draft);
    render();
    status('Imported. Save to apply.');
  } catch (e) {
    status(e.message, true);
  } finally {
    e.target.value = '';
  }
};
render();

document.querySelector('.import-button').onkeydown = e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('#config-import').click();
  }
};
