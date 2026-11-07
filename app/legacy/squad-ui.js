import {
  ATTRS,
  overallRating,
  playerTier,
  categoryRating,
  RATING_GROUPS,
} from '../core/players/ratings.js';
import { playerInitials } from '../core/players/lineups.js';
import { TAGS, badgeDescription } from '../core/players/traits.js';

const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const SUMMARY_GROUPS = [
  ['pace', 'PAC'],
  ['control', 'DRI'],
  ['shooting', 'SHO'],
  ['defending', 'DEF'],
  ['passing', 'PAS'],
  ['physical', 'PHY'],
].map(([id, shortLabel]) => ({ ...RATING_GROUPS.find(g => g.id === id), shortLabel }));
export const abilitySummary = p =>
  `<span class="draft-abilities">${SUMMARY_GROUPS.map(g => `<span><abbr title="${g.id === 'control' ? 'Dribbling' : g.label}">${g.shortLabel}</abbr><b>${categoryRating(p, g)}</b></span>`).join('')}</span>`;
const searchable = text =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
export function rankPlayers(players, role = '', query = '') {
  const term = searchable(query).trim();
  return players
    .filter(p =>
      searchable(
        `${p.name} ${p.fullName || ''} ${p.source?.club || ''} ${p.source?.nationality || ''}`,
      ).includes(term),
    )
    .sort(
      (a, b) =>
        overallRating(b, false, role || b.primaryPosition) -
          overallRating(a, false, role || a.primaryPosition) || a.name.localeCompare(b.name),
    );
}
export function squadOrder(rows, players) {
  return rows
    .flatMap((row, slot) =>
      players[slot]
        ? [
            {
              player: players[slot],
              slot,
              role: row[2],
              overall: overallRating(players[slot], false, row[2]),
            },
          ]
        : [],
    )
    .sort((a, b) => b.overall - a.overall || a.slot - b.slot);
}
export function miniPitch(
  container,
  rows,
  players,
  {
    selected = -1,
    onSelect = () => {},
    color = '#79c7ee',
    secondary = '#fff',
    disabled = false,
    slotDisabled = () => false,
    preview = false,
  } = {},
) {
  container.replaceChildren();
  container.classList.add('mini-pitch');
  container.classList.toggle('formation-preview', preview);
  const rgb = color.match(/[a-f0-9]{2}/gi)?.map(h => parseInt(h, 16)) || [255, 255, 255];
  rows.forEach(([x, y, role], slot) => {
    const p = players[slot],
      b = document.createElement('button');
    b.type = 'button';
    b.className = `mini-player${p ? ' filled' : ''}${slot === selected ? ' selected' : ''}`;
    b.dataset.slot = slot;
    b.style.left = `${8 + (y / 68) * 84}%`;
    b.style.top = `${95 - (x / 80) * 87}%`;
    b.style.setProperty('--kit', color);
    b.style.setProperty('--kit-trim', secondary);
    b.style.setProperty(
      '--kit-ink',
      rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 145 ? '#14201c' : '#fff',
    );
    b.disabled = disabled || slotDisabled(slot, p);
    b.classList.toggle('sent-off', !!p?.sentOff);
    b.innerHTML = `<span>${p ? esc(playerInitials(p)) : preview ? role : '+'}</span><small>${p?.sentOff ? 'SENT OFF' : role}${p && !p.sentOff ? ` · ${overallRating(p, true, role)}` : ''}</small>`;
    b.title = p
      ? `${p.name} · ${p.sentOff ? 'Sent off' : `${role} · OVR ${overallRating(p, true, role)} · ${playerTier(p).name}`}`
      : preview
        ? role
        : `Pick a ${role}`;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(slot === selected));
    b.onclick = () => onSelect(slot, p);
    container.append(b);
  });
}
export function renderSquadList(
  container,
  rows,
  players,
  {
    onSelect = (slot, p, role) => showPlayerCard(p, role),
    emptyText = 'Your picks will appear here.',
  } = {},
) {
  const ordered = squadOrder(rows, players);
  container.replaceChildren();
  container.classList.add('squad-list');
  const heading = document.createElement('div');
  heading.className = 'squad-list-heading';
  heading.innerHTML = `<span>Selected XI · ${ordered.length}/11</span><b>${ordered.length ? Math.round(ordered.reduce((sum, p) => sum + p.overall, 0) / ordered.length) + ' OVR' : '—'}</b>`;
  container.append(heading);
  if (!ordered.length) {
    const empty = document.createElement('p');
    empty.className = 'squad-empty';
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'squad-list-players';
  for (const { player: p, slot, role, overall } of ordered) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'squad-player';
    b.dataset.tier = playerTier(p).name.toLowerCase();
    b.innerHTML = `<span class="squad-player-name"><span><small>${role}${p.sentOff ? ' · Red card' : ''}</small><strong>${esc(p.name)}</strong></span><b>${Math.round(overall)}</b></span>${abilitySummary(p)}`;
    b.setAttribute('aria-label', `Inspect ${p.name}, ${role}, overall ${Math.round(overall)}`);
    b.onclick = () => onSelect(slot, p, role);
    list.append(b);
  }
  container.append(list);
}
export function showPlayerCard(
  p,
  role = p.primaryPosition,
  { team = '', color = '#79c7ee', secondary = '#fff' } = {},
) {
  const dialog = document.querySelector('#squad-player-dialog'),
    card = document.querySelector('#squad-player-card'),
    tier = playerTier(p);
  card.dataset.tier = tier.name.toLowerCase();
  card.style.setProperty('--card-kit', color);
  card.style.setProperty('--card-trim', secondary);
  const positions = [p.primaryPosition, ...(p.secondaryPositions || [])].join(' / '),
    energy = Math.round((p.energy ?? 1) * 100);
  const groups = RATING_GROUPS.filter(
    g => g.id !== 'goalkeeping' || p.primaryPosition === 'GK' || role === 'GK',
  );
  card.innerHTML = `<div class="full-card-heading"><span class="card-shirt" aria-hidden="true">${esc(playerInitials(p))}</span><div><h2 id="squad-player-title">${esc(p.name)}</h2><p>${esc(tier.name)} · ${esc(p.source?.club || team || 'Free agent')}</p></div><span class="card-overall"><b>${overallRating(p, true, role)}</b><small>${esc(role)} OVR</small></span></div><dl class="full-card-meta"><div><dt>Positions</dt><dd>${esc(positions)}</dd></div><div><dt>Current position</dt><dd>${esc(role)}${team ? ' · ' + esc(team) : ''}</dd></div><div><dt>Dominant foot</dt><dd>${esc(p.foot || 'right')}</dd></div><div><dt>Match stamina</dt><dd>${energy}%</dd></div></dl><div class="energy-track"><div style="width:${energy}%"></div></div><div class="tag-heading"><h3>Badges</h3><span>${p.tags.length}/${tier.capacity}</span></div><div class="draft-tags full-card-badges">${p.tags
    .map(id => {
      const tag = TAGS.find(t => t.id === id);
      return `<span tabindex="0" title="${esc(tag ? badgeDescription(tag, p) : '')}">${esc(tag?.label || id)}</span>`;
    })
    .join(
      '',
    )}</div>${abilitySummary(p)}${p.primaryPosition === 'GK' ? `<p class="card-keeper">Goalkeeping <b>${p.attrs.goalkeeping}</b></p>` : ''}<details class="ratings-expanded"><summary>Expand ratings</summary><div class="full-card-ratings">${groups
    .map(
      g =>
        `<section><h3>${g.label}</h3>${Object.keys(g.weights)
          .map(key => `<div><span>${ATTRS[key]}</span><b>${p.attrs[key]}</b></div>`)
          .join('')}</section>`,
    )
    .join('')}</div></details>`;
  document.querySelector('#squad-player-close').onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
}
