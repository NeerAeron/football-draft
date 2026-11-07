// Challenge link landing (#/challenge?c=<token>&r=<w-d-l.grade>): "You've been challenged"
// with the friend's result and the rules, then the same draft (same seed, options and default
// rules ⇒ same spins and opponents). Daily links point at that day's Daily Challenge.
import { useEffect, useState } from 'preact/hooks';
import { html } from '../../lib/html.js';
import { href, navigate } from '../../lib/router.js';
import { loadCatalog } from '../../../services/catalog.js';
import { dailyIdFromNumber, dailyNumber } from '../../../core/competition/daily.js';
import { formationLabel } from '../../../core/players/formations.js';
import { Button } from '../../components/button.js';
import { Chip } from '../../components/chip.js';
import { Icon } from '../../components/icon.js';
import { GradeBadge } from '../../components/grade-badge.js';
import { EmptyState } from '../../components/empty-state.js';
import { startDraft } from '../../lib/draft-store.js';
import { readChallengeQuery, typeOf, todayDailyId } from '../../lib/run-store.js';
import { modeLabel, levelLabel } from './team-view.js';

const KIND = {
  cup: { title: 'World Cup Run', draft: 'run', mode: 'run', returnTo: '/run' },
  quick: { title: 'Quick Match', draft: 'quick', mode: 'quick', returnTo: '/' },
  versus: { title: 'Versus', draft: 'versus', mode: 'versus', returnTo: '/' },
};

export default function ChallengeScreen({ query }) {
  const { challenge: c, score } = readChallengeQuery(query);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadCatalog().catch(() => {}); // warm up for the draft
  }, []);

  if (!c)
    return html`<div class="screen container-narrow" data-screen="challenge">
      <${EmptyState}
        icon="link"
        tone="coral"
        level=${1}
        title="This challenge link is broken"
        message="Ask your friend to copy it again — or start your own run."
        action=${html`<${Button} variant="primary" href=${href('/')}>Go to Home<//>`}
      />
    </div>`;

  if (c.kind === 'daily') {
    const day = dailyIdFromNumber(c.daily),
      today = todayDailyId();
    const isToday = day === today;
    return html`<div class="screen container-narrow challenge" data-screen="challenge">
      <section
        class="challenge-card card card--gold card--pad-lg"
        aria-labelledby="challenge-title"
      >
        <p class="eyebrow is-gold">You've been challenged</p>
        <h1 class="challenge-card__title" id="challenge-title">${`Daily #${c.daily}`}</h1>
        ${score && html`<${FriendScore} score=${score} />`}
        <p class="text-2">
          ${
            isToday
              ? 'Same spins, same opponents, one attempt. Can you beat it?'
              : `That was the Daily Challenge of ${day}. Today's is #${dailyNumber(today)} — same rules, new spins.`
          }
        </p>
        <${Button}
          variant="primary"
          size="lg"
          block
          iconEnd="arrow-right"
          href=${href('/daily')}
          data-testid="accept-challenge"
          >${isToday ? 'Play today’s Daily' : `Play Daily #${dailyNumber(today)}`}<//
        >
      </section>
    </div>`;
  }

  const kind = KIND[c.kind] || KIND.cup;
  const type = typeOf(c.mode);
  const accept = async () => {
    setBusy(true);
    try {
      await startDraft({
        kind: kind.draft,
        type,
        difficulty: c.difficulty,
        formation: c.formation,
        seed: c.seed,
        options: { hideRatings: c.hideRatings, uniqueNations: c.uniqueNations },
        useDefaultRules: true,
        // draft-store keeps `meta` as is; the run reads meta.challenge (createRunFromDraft).
        meta: {
          challenge: {
            token: query.c,
            by: score
              ? `${score.w}-${score.d}-${score.l}${score.grade ? ' · ' + score.grade : ''}`
              : null,
          },
        },
        returnTo: kind.returnTo,
      });
    } catch (error) {
      console.error('[challenge] could not start the draft', error);
      setBusy(false);
    }
  };
  const setup = href(
    '/play/:mode',
    { mode: kind.mode },
    { type, difficulty: c.difficulty, formation: c.formation, seed: c.seed, challenge: 1 },
  );
  return html`<div class="screen container-narrow challenge" data-screen="challenge">
    <section class="challenge-card card card--hero card--pad-lg" aria-labelledby="challenge-title">
      <div class="challenge-card__badge" aria-hidden="true">
        <${Icon} name="swords" size=${30} />
      </div>
      <p class="eyebrow">You've been challenged</p>
      <h1 class="challenge-card__title" id="challenge-title">${kind.title}</h1>
      ${
        score
          ? html`<${FriendScore} score=${score} />`
          : html`<p class="text-2">A friend sent you their draft.</p>`
      }
      <p class="challenge-card__lead">
        Same spins, same opponents. Draft your XI from the same nations and leagues — then beat
        their result.
      </p>
      <ul class="challenge-rules" role="list">
        <li><${Chip} icon="globe">${modeLabel(c.mode)}<//></li>
        <li><${Chip} icon="gauge">${levelLabel(c.difficulty)}<//></li>
        <li><${Chip} icon="layout-grid">${formationLabel(c.formation)}<//></li>
        ${c.hideRatings && html`<li><${Chip} icon="eye-off" tone="holo">Ratings hidden<//></li>`}
        ${c.uniqueNations && html`<li><${Chip} icon="flag">One per nation<//></li>`}
        ${c.sides === 2 && html`<li><${Chip} icon="users">Two players<//></li>`}
      </ul>
      <${Button}
        variant="primary"
        size="xl"
        block
        iconEnd="arrow-right"
        onClick=${accept}
        loading=${busy}
        data-testid="accept-challenge"
        >Accept challenge<//
      >
      <a class="challenge-card__setup" href=${setup}>Review the settings first</a>
    </section>
    <p class="challenge-foot text-3 text-xs">
      ${`Challenge code ${query.c}`} ${' · '}
      <button type="button" class="challenge-foot__home" onClick=${() => navigate('/')}>
        Not now
      </button>
    </p>
  </div>`;
}

function FriendScore({ score }) {
  return html`<div class="friend-score">
    ${score.grade && html`<${GradeBadge} grade=${score.grade} size="md" />`}
    <div class="friend-score__text">
      <span class="friend-score__label">Their result</span>
      <span class="friend-score__wdl num">${`${score.w}–${score.d}–${score.l}`}</span>
    </div>
  </div>`;
}
