import { CONFIG } from '../core/config/config.js';
import { escapeHtml } from '../core/util/text.js';
import { Draft, KITS, BUDGET_LABELS } from '../core/draft/draft.js';
import { FORMATIONS, formationLabel } from '../core/players/formations.js';
import { DIFFICULTIES, createAIOpponent, chooseAIFormation } from '../core/draft/opponent.js';
import { overallRating, playerTier, POSITIONS } from '../core/players/ratings.js';
import {
  miniPitch,
  renderSquadList,
  showPlayerCard,
  rankPlayers,
  abilitySummary,
} from './squad-ui.js';
export { miniPitch } from './squad-ui.js';
import { TAGS, badgeDescription } from '../core/players/traits.js';
import { clubSquads, assignClubLineup, partialClubLineup } from '../core/players/club-lineups.js';
import { randomLineups } from '../core/players/lineups.js';
import { Match } from '../core/sim/engine.js';
import { createDraftReel } from './draft-reel.js';
import { createBudgetConfirmation } from './budget-confirmation.js';
import { selectionSound } from '../services/sound.js';
const esc = escapeHtml;
const $ = s => document.querySelector(s);
export function createGameUI({ loadCatalog, onLaunch, onScreen, onResume, onSound = () => {} }) {
  let chosenMode = 'ai',
    draft = null,
    settings = null,
    selectedSlot = -1,
    limit = 24,
    token = 0,
    hasMatch = false,
    spinning = null,
    data = null,
    clubs = [],
    sandbox = null,
    pendingPick = null;
  const budgetConfirmation = createBudgetConfirmation($('#budget-confirm-dialog'));
  const reels = Object.fromEntries(
    ['league', 'team'].map(kind => [
      kind,
      createDraftReel(
        $(`#${kind}-reel`),
        item =>
          `${kind === 'league' ? `<img src="${esc(item.logo)}" alt=""/>` : `<span class="club-disc" style="background:${esc(item.primary || '#33443e')};border-color:${esc(item.secondary || '#dae6da')}"></span>`}<span><b class="tier-mark">${item.tier}</b> ${esc(item.name)}</span>`,
      ),
    ]),
  );
  const clubColors = [null, null],
    setScreen = name => {
      for (const id of ['home-screen', 'draft-screen', 'match-screen'])
        $(`#${id}`).hidden = id !== `${name}-screen`;
      document.body.dataset.screen = name;
      onScreen(name);
    };
  const teamKit = i => clubColors[i] || KITS[Number($(`#team-kit-${i}`).value) || 0];
  const readSettings = () => ({
    mode: chosenMode,
    difficulty: $('#difficulty').value,
    funding: $('#funding').value,
    teams: [0, 1].map(i => ({
      name: chosenMode === 'ai' ? (i ? 'AI' : 'You') : `Player ${i + 1}`,
      kit: Number($(`#team-kit-${i}`).value) || 0,
      color: teamKit(i).primary,
      secondary: teamKit(i).secondary,
      formation: $(`#team-formation-${i}`).value,
      clubId: chosenMode === 'sandbox' ? $(`#sandbox-club-${i}`).value : null,
    })),
  });
  function showHome() {
    token++;
    pendingPick = null;
    budgetConfirmation.cancel();
    Object.values(reels).forEach(r => r.cancel());
    spinning = null;
    setScreen('home');
    $('#resume-game').hidden = !hasMatch;
  }
  function selectMode(mode) {
    chosenMode = mode;
    document.querySelectorAll('[data-game-mode]').forEach(b => {
      const active = b.dataset.gameMode === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
      b.closest('.mode-card').classList.toggle('selected', active);
    });
    $('#classic-options').hidden = mode !== 'ai';
    $('#setup-team-1').hidden = mode === 'ai';
    $('#setup-name-0').textContent = mode === 'ai' ? 'You' : 'Player 1';
    $('#setup-name-1').textContent = 'Player 2';
    for (const i of [0, 1]) {
      $(`#sandbox-club-field-${i}`).hidden = mode !== 'sandbox';
      renderSetupFormation(i);
    }
    $('#begin-game').textContent = mode === 'sandbox' ? 'Play sandbox' : 'Start draft';
    if (mode === 'sandbox')
      ensureCatalog().catch(() => {
        $('#setup-error').textContent = 'Players could not load. Try again.';
      });
  }
  for (const i of [0, 1]) {
    const kit = $(`#team-kit-${i}`);
    kit.innerHTML = KITS.map((k, n) => `<option value="${n}">${k.name}</option>`).join('');
    kit.value = i ? 1 : 0;
    for (const [n, k] of KITS.entries()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kit-swatch';
      b.style.background = `linear-gradient(135deg,${k.primary} 50%,${k.secondary} 50%)`;
      b.title = k.name;
      b.setAttribute('aria-label', k.name);
      b.onclick = () => {
        clubColors[i] = null;
        kit.value = n;
        paintKits(i);
      };
      $(`#kit-options-${i}`).append(b);
    }
    kit.onchange = () => {
      if (kit.value !== 'club') clubColors[i] = null;
      paintKits(i);
    };
    $(`#team-formation-${i}`).innerHTML = Object.keys(FORMATIONS)
      .sort()
      .map(id => `<option value="${id}">${formationLabel(id)}</option>`)
      .join('');
    $(`#team-formation-${i}`).value = '433';
    $(`#team-formation-${i}`).onchange = () => renderSetupFormation(i);
    paintKits(i);
    $(`#sandbox-club-${i}`).onchange = () => {
      const club = clubs.find(c => c.id === $(`#sandbox-club-${i}`).value);
      if (!club) {
        clubColors[i] = null;
        kit.value = i ? 1 : 0;
        paintKits(i);
        return;
      }
      if (club.formations.length)
        $(`#team-formation-${i}`).value = chooseAIFormation(club.players, {
          level: 'hard',
          random: () => 0.5,
        }).formation;
      if (club.primary && club.secondary) {
        clubColors[i] = { primary: club.primary, secondary: club.secondary };
        if (![...kit.options].some(o => o.value === 'club'))
          kit.add(new Option('Club colors', 'club'));
        kit.value = 'club';
      } else {
        clubColors[i] = null;
        kit.value = i ? 1 : 0;
      }
      paintKits(i);
    };
  }
  function paintKits(i) {
    const value = $(`#team-kit-${i}`).value;
    [...$(`#kit-options-${i}`).children].forEach((b, n) => {
      const active = String(n) === value;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderSetupFormation(i);
  }
  function renderSetupFormation(i) {
    const formation = $(`#team-formation-${i}`).value;
    if (!FORMATIONS[formation]) return;
    const kit = teamKit(i),
      club =
        chosenMode === 'sandbox' ? clubs.find(c => c.id === $(`#sandbox-club-${i}`).value) : null;
    const players = club ? partialClubLineup(club.players, formation) : [],
      rows = FORMATIONS[formation],
      inspect = (slot, p, role = rows[slot][2]) =>
        showPlayerCard(p, role, {
          team: club?.name || '',
          color: kit.primary,
          secondary: kit.secondary,
        });
    miniPitch($(`#setup-formation-preview-${i}`), rows, players, {
      preview: true,
      color: kit.primary,
      secondary: kit.secondary,
      slotDisabled: (_, p) => !p,
      onSelect: inspect,
    });
    $(`#setup-roster-${i}`).hidden = !club;
    if (club) renderSquadList($(`#setup-roster-${i}`), rows, players, { onSelect: inspect });
  }
  async function ensureCatalog() {
    if (data) return data;
    const loaded = await loadCatalog();
    if (data) return data;
    data = loaded;
    clubs = clubSquads(data);
    for (const i of [0, 1]) {
      const select = $(`#sandbox-club-${i}`);
      for (const league of data.leagues.filter(l => l.available)) {
        const group = document.createElement('optgroup');
        group.label = `${league.tier} · ${league.name}`;
        for (const club of clubs.filter(c => c.leagueId === league.id)) {
          const option = new Option(
            `${club.tier} · ${club.name}${club.formations.length ? '' : ` · ${club.players.length} players`}`,
            club.id,
          );
          group.append(option);
        }
        if (group.children.length) select.append(group);
      }
    }
    return data;
  }
  $('#difficulty').innerHTML = Object.entries(DIFFICULTIES)
    .map(([id, d]) => `<option value="${id}">${d.label}</option>`)
    .join('');
  $('#difficulty').value = 'medium';
  document
    .querySelectorAll('[data-game-mode]')
    .forEach(b => (b.onclick = () => selectMode(b.dataset.gameMode)));
  selectMode(chosenMode);
  $('#resume-game').onclick = () => {
    setScreen('match');
    onResume();
  };
  $('#home-button').onclick = showHome;
  $('#brand-home').onclick = e => {
    e.preventDefault();
    showHome();
  };
  $('#draft-back').onclick = showHome;
  $('#game-setup').onsubmit = async e => {
    e.preventDefault();
    const active = ++token;
    settings = readSettings();
    $('#setup-error').textContent = '';
    $('#begin-game').disabled = true;
    try {
      const catalog = await ensureCatalog();
      if (active !== token) return;
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      if (settings.mode === 'sandbox') {
        const template = new Match(seed);
        settings.teams.forEach((t, i) => template.setTactic(i, 'formation', t.formation));
        const lineups = randomLineups(template.players, catalog.players, seed);
        for (const [i, t] of settings.teams.entries())
          if (t.clubId) {
            const club = clubs.find(c => c.id === t.clubId),
              lineup = partialClubLineup(club.players, t.formation);
            lineups.splice(i * 11, 11, ...lineup);
          }
        if (lineups.some(p => !p)) {
          sandbox = { players: lineups, slot: lineups.findIndex(p => !p), limit: 40 };
          $('#sandbox-search').value = '';
          renderSandbox();
          $('#sandbox-squad-dialog').showModal();
          return;
        }
        await launch(lineups);
        return;
      }
      let opponent = null;
      if (settings.mode === 'ai') {
        const choice = createAIOpponent(catalog, settings.difficulty);
        opponent = choice.players;
        Object.assign(settings.teams[1], {
          name: choice.name,
          formation: choice.formation,
          clubName: choice.name,
          clubId: choice.id,
          tier: choice.tier,
          color: choice.primary || KITS[1].primary,
          secondary: choice.secondary || KITS[1].secondary,
        });
      }
      draft = new Draft(catalog, {
        seed,
        formations: settings.teams.map(t => t.formation),
        opponent,
        funding: settings.funding,
      });
      spinning = null;
      nextTurn();
      setScreen('draft');
    } catch (error) {
      $('#setup-error').textContent = error.message || 'Players could not load. Please try again.';
    } finally {
      $('#begin-game').disabled = false;
    }
  };
  function renderSandbox() {
    const team = Math.floor(sandbox.slot / 11),
      slot = sandbox.slot % 11,
      role = FORMATIONS[settings.teams[team].formation][slot][2],
      used = new Set(
        sandbox.players
          .slice(team * 11, team * 11 + 11)
          .filter(Boolean)
          .map(p => p.profileId),
      );
    const missing = sandbox.players.filter(p => !p).length;
    $('#sandbox-squad-note').textContent = missing
      ? `${missing} open place${missing === 1 ? '' : 's'}.`
      : 'Both XIs are ready.';
    for (const i of [0, 1]) {
      const t = settings.teams[i],
        rows = FORMATIONS[t.formation],
        players = sandbox.players.slice(i * 11, i * 11 + 11),
        inspect = (next, p) =>
          showPlayerCard(p, rows[next][2], {
            team: t.name,
            color: t.color,
            secondary: t.secondary,
          });
      $(`#sandbox-squad-name-${i}`).textContent = t.name;
      miniPitch($(`#sandbox-squad-pitch-${i}`), rows, players, {
        color: t.color,
        secondary: t.secondary,
        selected: i === team ? slot : -1,
        onSelect: (next, p) => {
          sandbox.slot = i * 11 + next;
          $('#sandbox-position').value = rows[next][2];
          sandbox.limit = 40;
          renderSandbox();
          if (p) inspect(next, p);
        },
      });
      renderSquadList($(`#sandbox-squad-roster-${i}`), rows, players, { onSelect: inspect });
    }
    $('#sandbox-slot-label').textContent = `${settings.teams[team].name} · choose ${role}`;
    $('#sandbox-squad-ready').disabled = missing > 0;
    $('#sandbox-autofill').disabled = !missing;
    const query = $('#sandbox-search').value.trim().toLocaleLowerCase(),
      list = $('#sandbox-candidates');
    list.replaceChildren();
    const rankingRole = $('#sandbox-position').value,
      options = rankPlayers(data.players, rankingRole, query);
    for (const p of options.slice(0, sandbox.limit)) {
      const button = document.createElement('button'),
        reason = used.has(p.profileId)
          ? 'In this XI'
          : (role === 'GK') !== (p.primaryPosition === 'GK')
            ? 'Different position type'
            : '';
      button.type = 'button';
      button.className = 'catalog-player';
      button.dataset.tier = playerTier(p).name.toLowerCase();
      button.disabled = !!reason;
      button.innerHTML = `<span><strong>${esc(p.name)}</strong><small>${esc(p.primaryPosition)} · ${esc(p.source.club)}</small><small>${reason || 'Pick as ' + role + ' · ' + overallRating(p, true, role) + ' OVR'}</small></span><b>${overallRating(p, true, rankingRole || p.primaryPosition)}</b>`;
      button.onclick = () => {
        sandbox.players[sandbox.slot] = p;
        const next = sandbox.players.findIndex(p => !p);
        if (next >= 0) sandbox.slot = next;
        sandbox.limit = 40;
        renderSandbox();
      };
      list.append(button);
    }
    $('#sandbox-more').hidden = options.length <= sandbox.limit;
  }
  $('#sandbox-position').innerHTML =
    '<option value="">Base overall</option>' +
    POSITIONS.map(p => `<option value="${p}">${p} rankings</option>`).join('');
  $('#sandbox-position').onchange = () => {
    sandbox.limit = 40;
    renderSandbox();
  };
  $('#sandbox-search').oninput = () => {
    sandbox.limit = 40;
    renderSandbox();
  };
  $('#sandbox-more').onclick = () => {
    sandbox.limit += 40;
    renderSandbox();
  };
  $('#sandbox-squad-close').onclick = () => $('#sandbox-squad-dialog').close();
  $('#sandbox-autofill').onclick = () => {
    for (let i = 0; i < 22; i++)
      if (!sandbox.players[i]) {
        const team = Math.floor(i / 11),
          role = FORMATIONS[settings.teams[team].formation][i % 11][2],
          used = new Set(
            sandbox.players
              .slice(team * 11, team * 11 + 11)
              .filter(Boolean)
              .map(p => p.profileId),
          );
        sandbox.players[i] = data.players
          .filter(p => (role === 'GK') === (p.primaryPosition === 'GK') && !used.has(p.profileId))
          .sort((a, b) => overallRating(b, false, role) - overallRating(a, false, role))[0];
      }
    renderSandbox();
  };
  $('#sandbox-squad-ready').onclick = () => {
    if (sandbox.players.some(p => !p)) return;
    $('#sandbox-squad-dialog').close();
    launch(sandbox.players);
  };
  async function launch(players) {
    const [home, away] = settings.teams;
    if (home.color.toLowerCase() === away.color.toLowerCase()) {
      const primary = away.color;
      away.color = away.secondary;
      away.secondary = primary;
    }
    hasMatch = true;
    setScreen('match');
    await onLaunch({ ...settings, players });
  }
  function nextTurn() {
    selectedSlot = -1;
    limit = 24;
    $('#draft-position').value = '';
    $('#draft-search').value = '';
    renderDraft();
  }
  function picked(p) {
    onSound(selectionSound(playerTier(p).name));
    nextTurn();
  }
  async function choosePlayer(slot, p) {
    if (spinning || pendingPick || draft.complete) return;
    const offer = draft.budgetOffer(p);
    if (!offer) return;
    if (!offer.requiresConfirmation) {
      if (draft.pick(slot, p.profileId)) picked(p);
      return;
    }
    const request = { draft, token, serial: draft.revealSerial };
    pendingPick = request;
    const label = BUDGET_LABELS[offer.slotGroup],
      budget = draft.budgetState(),
      left = budget.limits[offer.slotGroup] - budget.used[offer.slotGroup] - 1;
    $('#budget-confirm-title').textContent = `Use a ${label} slot?`;
    $('#budget-confirm-message').textContent =
      `${p.name} is a ${playerTier(p).name}. This pick uses a ${label} slot, leaving ${left} open.`;
    $('#budget-confirm-accept').textContent = `Draft ${p.name}`;
    try {
      const accepted = await budgetConfirmation.request();
      if (
        !accepted ||
        pendingPick !== request ||
        draft !== request.draft ||
        token !== request.token ||
        draft.revealSerial !== request.serial ||
        document.body.dataset.screen !== 'draft'
      )
        return;
      if (draft.pick(slot, p.profileId, { confirmedBudgetSlot: offer.slotGroup })) picked(p);
    } catch {
      $('#draft-last').textContent = 'Could not open the confirmation. Please try again.';
    } finally {
      if (pendingPick === request) pendingPick = null;
    }
  }
  async function spin(kind, respin = false) {
    if (
      spinning ||
      pendingPick ||
      draft.complete ||
      (respin
        ? !draft.respinOptions(kind).length
        : kind === 'league'
          ? draft.league
          : !draft.needsClub || draft.club)
    )
      return;
    try {
      const reelItems = draft.reelOptions(kind),
        result = respin
          ? draft.respin(kind)
          : kind === 'league'
            ? draft.spinLeague()
            : draft.spinTeam(),
        active = ++token;
      limit = 24;
      $('#draft-search').value = '';
      spinning = kind;
      renderDraft();
      const completed = await reels[kind].spin(reelItems, result, {
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        onTick: () => onSound('tick'),
      });
      if (!completed || active !== token || document.body.dataset.screen !== 'draft') return;
      spinning = null;
      onSound('reveal');
      renderDraft();
    } catch (error) {
      spinning = null;
      renderDraft();
      $('#draft-last').textContent = error.message;
    }
  }
  function renderRespins() {
    for (const kind of ['league', 'team']) {
      const button = $(`#${kind}-respin`),
        remaining = draft.respins[draft.turn][kind];
      button.hidden = kind === 'league' ? !draft.league : !draft.club;
      button.textContent = `${kind === 'league' ? 'League' : 'Team'} re-spin · ${remaining}`;
      button.disabled = !!spinning || draft.complete || !draft.respinOptions(kind).length;
    }
  }
  function renderDraft() {
    const league = draft.league,
      club = draft.club;
    const budget = draft.budgetState();
    $('#budget-meter').hidden = !budget.enabled;
    if (budget.enabled)
      $('#budget-meter').innerHTML =
        '<h3>Budget slots</h3>' +
        Object.entries(BUDGET_LABELS)
          .map(
            ([key, label]) =>
              `<div><span>${label}</span><b>${budget.used[key]} / ${budget.limits[key]}</b></div>`,
          )
          .join('');
    const opponent = settings.teams[1];
    $('#draft-opponent-panel').classList.toggle('opponent-card', draft.solo);
    $('#opponent-identity').hidden = !draft.solo;
    if (draft.solo) {
      const panel = $('#draft-opponent-panel');
      panel.style.setProperty('--opponent-primary', opponent.color);
      panel.style.setProperty('--opponent-secondary', opponent.secondary);
      $('#opponent-tier').textContent = opponent.tier;
      $('#opponent-competition').textContent = opponent.clubId
        ? data.leagues.find(l => l.id === data.teams.find(c => c.id === opponent.clubId)?.leagueId)
            ?.name || 'Club challenge'
        : `All Stars · ${CONFIG.ai.impossibleOverall}+`;
    }
    $('#draft-turn').textContent = draft.complete
      ? 'Your teams are ready'
      : `${settings.teams[draft.turn].name} picks`;
    $('#draft-progress').textContent = `${draft.history.length} / ${draft.solo ? 11 : 22} drafted`;
    $('#coin-result').textContent = draft.solo
      ? `${DIFFICULTIES[settings.difficulty].label} · ${settings.funding === 'budget' ? 'Budget' : 'Financial Takeover'}`
      : `Coin toss: ${settings.teams[draft.first].name} picks first.`;
    const last = draft.history.at(-1);
    $('#draft-last').textContent = last
      ? `${settings.teams[last.team].name} drafted ${last.name} · ${last.clubName || last.leagueName}.${last.budgetReplacement ? ` Uses a ${BUDGET_LABELS[last.budgetSlot]} slot.` : ''}`
      : '';
    $('#draft-choices').hidden = draft.complete;
    $('#draft-finish').hidden = !draft.complete;
    for (const team of [0, 1]) {
      const t = settings.teams[team];
      $(`#draft-name-${team}`).textContent = t.name;
      $(`#draft-shape-${team}`).textContent = formationLabel(draft.formations[team]);
      const rows = FORMATIONS[draft.formations[team]],
        inspect = (slot, p, role = rows[slot][2]) =>
          showPlayerCard(p, role, { team: t.name, color: t.color, secondary: t.secondary });
      miniPitch($(`#draft-pitch-${team}`), rows, draft.picks[team], {
        color: t.color,
        secondary: t.secondary,
        selected: team === draft.turn ? selectedSlot : -1,
        slotDisabled: (_, p) => !p && (!!spinning || draft.complete || team !== draft.turn),
        onSelect: (slot, p) => {
          if (p) {
            inspect(slot, p);
            return;
          }
          selectedSlot = slot;
          $('#draft-position').value = rows[slot][2];
          limit = 24;
          renderDraft();
        },
      });
      renderSquadList($(`#draft-squad-${team}`), rows, draft.picks[team], { onSelect: inspect });
    }
    if (draft.complete) return;
    $('#league-spin').disabled = !!spinning || !!league;
    $('#league-spin').textContent =
      spinning === 'league' ? 'Spinning…' : league ? 'League locked' : 'Spin league';
    $('#league-spinner').classList.toggle('spinning', spinning === 'league');
    $('#league-name').textContent =
      spinning === 'league'
        ? 'Choosing your league…'
        : league
          ? `${league.tier} · ${league.name}`
          : 'Which league is next?';
    $('#league-detail').textContent =
      league && !spinning
        ? draft.needsClub
          ? 'Next: spin a club'
          : 'League-wide player pool'
        : '';
    $('#team-spinner').hidden = !draft.needsClub || spinning === 'league';
    $('#team-spin').disabled = !!spinning || !!club;
    $('#team-spin').textContent =
      spinning === 'team' ? 'Spinning…' : club ? 'Club locked' : 'Spin club';
    $('#team-spinner').classList.toggle('spinning', spinning === 'team');
    $('#team-spin-name').textContent =
      spinning === 'team'
        ? 'Choosing your club…'
        : club
          ? `${club.tier} · ${club.name}`
          : 'Which club is next?';
    $('#team-detail').textContent = club ? `${draft.available().length} players available` : '';
    if (!spinning) {
      reels.league.show(draft.reelOptions('league'), league);
      reels.team.show(draft.reelOptions('team'), club);
    }
    $('#draft-search').disabled = $('#draft-position').disabled = !!spinning || !draft.unlocked;
    renderChoices();
  }
  function renderChoices() {
    const list = $('#draft-player-list');
    list.replaceChildren();
    const selectedRole = FORMATIONS[draft.formations[draft.turn]][selectedSlot]?.[2];
    $('#draft-placement-label').textContent = selectedRole
      ? `Assign to selected ${selectedRole} circle`
      : 'Automatic · best-rated open position';
    $('#draft-auto-position').hidden = selectedSlot < 0;
    if (spinning || !draft.unlocked) {
      $('#draft-more').hidden = true;
      $('#draft-results').textContent = spinning
        ? 'The draw is rolling…'
        : draft.needsClub
          ? 'Spin a club to reveal your players.'
          : 'Spin a league to begin this pick.';
      renderRespins();
      return;
    }
    const role = $('#draft-position').value,
      search = $('#draft-search').value.trim().toLocaleLowerCase();
    const profiles = rankPlayers(draft.visible(), role, search);
    $('#draft-role').textContent = role ? `${role} rankings` : 'All players';
    const available = profiles.filter(p => draft.placement(p, selectedSlot).available).length;
    $('#draft-results').textContent =
      available < profiles.length
        ? `${profiles.length} players · ${available} available`
        : `${profiles.length} players`;
    for (const p of profiles.slice(0, limit)) {
      const tier = playerTier(p),
        offer = draft.budgetOffer(p),
        placement = draft.placement(p, selectedSlot),
        { slot, role: assignment, reason } = placement,
        blocked = !placement.available,
        card = document.createElement('button');
      card.type = 'button';
      card.className = 'draft-card';
      card.dataset.tier = tier.name.toLowerCase();
      card.disabled = blocked;
      card.classList.toggle('budget-locked', blocked);
      if (blocked) card.title = reason;
      card.innerHTML = `<span class="draft-card-top"><b class="draft-ovr">${overallRating(p, true, role || p.primaryPosition)}</b><span><strong>${esc(p.name)}</strong><small>${esc(p.primaryPosition)} · ${esc(p.source?.club || '')}</small></span><em>${tier.name}<small>${p.tags.length}/${tier.capacity} badges</small></em></span>${abilitySummary(p)}<span class="draft-tags">${p.tags
        .map(id => {
          const tag = TAGS.find(t => t.id === id);
          return `<span title="${esc(tag ? badgeDescription(tag, p) : '')}">${esc(tag?.label)}</span>`;
        })
        .join(
          '',
        )}</span><small class="draft-assignment">${blocked ? reason : 'Pick as ' + assignment + ' · ' + overallRating(p, true, assignment) + ' OVR'}</small>`;
      if (!blocked && offer?.requiresConfirmation) {
        card
          .querySelector('.draft-assignment')
          .append(` · Uses ${BUDGET_LABELS[offer.slotGroup]} slot`);
        card.setAttribute('aria-haspopup', 'dialog');
      }
      card.onclick = () => choosePlayer(slot, p);
      list.append(card);
    }
    draft.recordShown(profiles.slice(0, limit).map(p => p.profileId));
    renderRespins();
    $('#draft-more').hidden = profiles.length <= limit;
    if (!profiles.length)
      list.textContent =
        'No players match. Clear the filters to see this draw’s available players.';
  }
  $('#draft-auto-position').onclick = () => {
    selectedSlot = -1;
    renderDraft();
  };
  $('#draft-position').innerHTML =
    '<option value="">All positions</option>' +
    POSITIONS.map(p => `<option value="${p}">${p}</option>`).join('');
  $('#draft-position').onchange = () => {
    selectedSlot = -1;
    limit = 24;
    renderDraft();
  };
  $('#league-spin').onclick = () => spin('league');
  $('#team-spin').onclick = () => spin('team');
  $('#league-respin').onclick = () => spin('league', true);
  $('#team-respin').onclick = () => spin('team', true);
  $('#draft-search').oninput = () => {
    limit = 24;
    renderChoices();
  };
  $('#draft-more').onclick = () => {
    limit += 24;
    renderChoices();
  };
  $('#draft-finish').onclick = () => launch(draft.picks.flat());
  showHome();
  return {
    showHome,
    showMatch() {
      hasMatch = true;
      setScreen('match');
    },
    get screen() {
      return document.body.dataset.screen;
    },
  };
}
