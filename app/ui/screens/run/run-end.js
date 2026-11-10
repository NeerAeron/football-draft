// The end of a World Cup Run: champion (trophy + confetti) or elimination, grade + named
// verdict, record, Player of the Tournament, "Held you back", the XI, share text + image,
// "Challenge a friend" and Play again.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { href } from '../../lib/router.js';
import { GradeBadge } from '../../components/grade-badge.js';
import { Confetti } from '../../components/confetti.js';
import { Button } from '../../components/button.js';
import { PlayerCard } from '../../components/player-card.js';
import { PlayerRow } from '../../components/player-row.js';
import { PitchView } from '../../components/pitch-view.js';
import { StatTile } from '../../components/meter.js';
import { Icon } from '../../components/icon.js';
import { achievement } from '../../components/toast.js';
import { shareText } from '../../../core/competition/share.js';
import { challengeLink, runChallenge, pageBase, userTeamName } from '../../lib/run-store.js';
import { runNews } from '../../lib/records.js';
import { PathStrip, FlagMosaic, scoreText } from './run-parts.js';
import { Trophy } from './trophy.js';
import { SharePanel } from './share-panel.js';
import {
  xiViews,
  nationList,
  awardView,
  shareCardFor,
  modeLabel,
  levelLabel,
} from './team-view.js';
import { fmt1 } from '../../lib/format.js';

/** One line on how the run ended: "Beat England 2–1 in the final" / "Lost 1–2 to Croatia". */
export function endLine(snapshot) {
  const played = snapshot.rounds.filter(r => r.result);
  const last = played.at(-1);
  if (!last) return '';
  const res = last.result,
    name = last.opponent.name;
  const pens = res.shootout;
  if (snapshot.status === 'champion')
    return pens
      ? `Beat ${name} on penalties in the final`
      : `Beat ${name} ${scoreText(res)} in the final`;
  if (last.stage === 'group') {
    const pos = snapshot.group.table.find(r => r.user)?.position;
    return `Finished ${['1st', '2nd', '3rd', '4th'][pos - 1] || pos} in Group A`;
  }
  return pens
    ? `Lost to ${name} on penalties${pens.score ? ` (${pens.score[0]}–${pens.score[1]})` : ''}`
    : `Lost ${scoreText(res)} to ${name} in the ${last.label.toLowerCase()}`;
}

function celebrate(snapshot, meta, onCelebrated) {
  if (meta.celebrated) return;
  const g = snapshot.grade;
  // What this run added to the trophy cabinet on Home (lib/records.js).
  const { news } = runNews(meta.id),
    level = levelLabel(snapshot.difficulty);
  if (snapshot.status === 'champion')
    achievement({
      title: g?.grade === 'S+' ? 'Perfect Eight' : 'World Champions',
      description:
        g?.grade === 'S+'
          ? 'Eight matches, eight wins. The perfect run.'
          : `You lifted the cup with a ${snapshot.record.w}-${snapshot.record.d}-${snapshot.record.l} run.`,
    });
  if (news.includes('cabinet'))
    achievement({
      title: 'Cabinet complete',
      description: 'A World Cup on every difficulty. Nothing left to prove.',
      icon: 'crown',
    });
  else if (news.includes('title'))
    achievement({
      title: 'New trophy',
      description: `Your first World Cup on ${level}. It is in your cabinet on Home.`,
      icon: 'award',
    });
  else if (news.includes('best'))
    achievement({
      title: 'Personal best',
      description: `Your furthest run on ${level} so far.`,
      icon: 'trending-up',
    });
  const giant = snapshot.rounds.find(
    r =>
      r.result &&
      (r.result.outcome === 'W' || r.result.shootout?.winner === 'user') &&
      r.opponent.effective - snapshot.user.effective >= 3,
  );
  if (giant)
    achievement({
      title: 'Giant Killer',
      description: `Knocked over ${giant.opponent.name}, rated ${fmt1(giant.opponent.rating)}.`,
      icon: 'swords',
    });
  onCelebrated?.();
}

export function RunEnd({ catalog, run, snapshot, meta, onCelebrated }) {
  const champion = snapshot.status === 'champion';
  const grade = snapshot.grade;
  const views = useMemo(() => xiViews(catalog, run.userSide()), [catalog, run]);
  const nations = useMemo(() => nationList(views), [views]);
  const pott = useMemo(() => run.playerOfTheTournament(), [run, snapshot]);
  const held = useMemo(() => run.heldYouBack(2), [run, snapshot]);
  const [fire, setFire] = useState(0);
  useEffect(() => {
    if (champion) setFire(1);
    const t = setTimeout(() => celebrate(snapshot, meta, onCelebrated), 900);
    return () => clearTimeout(t);
  }, []);

  const challenge = runChallenge(meta, snapshot);
  const link = challengeLink(challenge, { record: snapshot.record, grade: grade?.grade });
  const text = shareText(snapshot, {
    rating: meta.hideRatings ? null : snapshot.user.rating,
    hideRatings: meta.hideRatings,
    uniqueNations: meta.uniqueNations,
    url: link,
  });
  const card = useMemo(
    () =>
      shareCardFor({
        snapshot,
        views,
        formation: run.user.formation,
        title: 'World Cup Run',
        hideRatings: meta.hideRatings,
      }),
    [snapshot, views],
  );
  const cleanSheets = snapshot.rounds.filter(r => r.result && r.result.goalsAgainst === 0).length;
  const pottView = pott && awardView(catalog, pott);

  return html`<div
    class=${cx('run-end', champion ? 'is-champion' : 'is-out')}
    data-testid="run-end"
  >
    <${Confetti} fire=${fire} count=${220} origin=${{ x: 0.5, y: 0.3 }} />
    <section class="run-end__hero" aria-labelledby="run-end-title">
      <div class="run-end__spot" aria-hidden="true"></div>
      ${
        champion
          ? html`<div class="run-end__cup"><${Trophy} size=${168} glow /></div>`
          : html`<div class="run-end__out" aria-hidden="true">
              <${Icon} name="flag" size=${40} />
            </div>`
      }
      <p class="eyebrow ${champion ? 'is-gold' : 'is-muted'}">
        ${`World Cup Run · ${modeLabel(snapshot.mode)} · ${levelLabel(snapshot.difficulty)}`}
      </p>
      <h1 class="run-end__title" id="run-end-title">
        ${champion ? 'World Champions' : snapshot.stage === 'group' ? 'Group stage exit' : `Out in the ${snapshot.stageLabel}`}
      </h1>
      <p class="run-end__line">${endLine(snapshot)}</p>
      <div class="run-end__grade">
        <${GradeBadge}
          grade=${grade?.grade || 'F'}
          size="xl"
          verdict=${grade?.verdict}
          detail=${`${snapshot.record.w}–${snapshot.record.d}–${snapshot.record.l} · ${userTeamName(snapshot.user.name)}`}
        />
      </div>
      <${PathStrip} snapshot=${snapshot} class="run-end__path" />
    </section>

    <div class="run-end__stats">
      <${StatTile}
        label="Record"
        value=${`${snapshot.record.w}–${snapshot.record.d}–${snapshot.record.l}`}
        tone=${champion ? 'gold' : 'default'}
      />
      <${StatTile} label="Goals" value=${`${snapshot.record.gf}–${snapshot.record.ga}`} />
      <${StatTile} label="Clean sheets" value=${cleanSheets} />
      <${StatTile}
        label="Team OVR"
        value=${meta.hideRatings ? '??' : fmt1(snapshot.user.rating)}
        tone="volt"
      />
    </div>

    <div class="run-end__grid">
      <div class="run-end__main stack stack-lg">
        <${SharePanel}
          text=${text}
          card=${card}
          link=${link}
          title="World Cup Run"
          filename=${`world-cup-run-${snapshot.record.w}-${snapshot.record.d}-${snapshot.record.l}.png`}
        />
        <section class="card card--pad-md run-end__awards" aria-labelledby="awards-title">
          <h2 class="section-title" id="awards-title">Awards</h2>
          ${
            pottView
              ? html`<div class="pott">
                  <${PlayerCard} player=${pottView} size="m" hideRatings=${meta.hideRatings} />
                  <div class="pott__text">
                    <p class="eyebrow is-gold">
                      <${Icon} name="award" size=${14} /> Player of the Tournament
                    </p>
                    <p class="pott__name">${pottView.name}</p>
                    <p class="pott__line">
                      ${[
                        html`<b class="num" key="a">${fmt1(pott.average)}</b>`,
                        ' avg rating · ',
                        html`<b class="num" key="g">${pott.goals}</b>`,
                        pott.goals === 1 ? ' goal · ' : ' goals · ',
                        html`<b class="num" key="s">${pott.assists}</b>`,
                        pott.assists === 1 ? ' assist' : ' assists',
                      ]}
                    </p>
                    <p class="pott__sub">
                      ${`${pott.matches} ${pott.matches === 1 ? 'match' : 'matches'} at ${pott.role}`}
                    </p>
                  </div>
                </div>`
              : html`<p class="text-3">
                  Play matches on the pitch to crown a Player of the Tournament.
                </p>`
          }
          ${
            held.length > 0 &&
            html`<div class="held">
              <h3 class="held__title"><${Icon} name="trending-down" size=${18} /> Held you back</h3>
              <ul role="list" class="player-list held__list">
                ${held.map(h => {
                  const v = awardView(catalog, h);
                  return (
                    v &&
                    html`<li key=${h.profileId}>
                      <${PlayerRow}
                        player=${v}
                        stats=${0}
                        hideRatings=${meta.hideRatings}
                        meta=${
                          meta.hideRatings
                            ? h.reason.replace(/\d+(\.\d+)?/g, '?')
                            : h.reason.replace(/(\d+\.\d)\d+/g, '$1')
                        }
                      />
                    </li>`
                  );
                })}
              </ul>
            </div>`
          }
        </section>
      </div>
      <aside class="run-end__side stack stack-lg">
        <section class="card card--pad-md run-end__xi" aria-labelledby="xi-title">
          <div class="spread">
            <h2 class="section-title" id="xi-title">Your XI</h2>
            <${FlagMosaic} nations=${nations} size=${24} max=${5} />
          </div>
          <${PitchView}
            formation=${run.user.formation}
            players=${views.map(v => v.view)}
            hideRatings=${meta.hideRatings}
            label="Your XI"
          />
        </section>
        <div class="run-end__actions">
          <${Button}
            variant="primary"
            size="lg"
            block
            icon="rotate-ccw"
            href=${href('/play/:mode', { mode: 'run' }, { type: meta.type || 'nations', go: 1 })}
            data-testid="play-again"
            >Play again<//
          >
          <div class="run-end__more">
            <${Button}
              variant="ghost"
              icon="sliders-horizontal"
              href=${href('/play/:mode', { mode: 'run' }, { type: meta.type || 'nations' })}
              >Change setup<//
            >
            <${Button} variant="ghost" icon="house" href=${href('/')}>Home<//>
          </div>
        </div>
        <p class="run-end__fine text-3 text-xs">
          ${`Share link plays the same spins: ${pageBase().replace(/^https?:\/\//, '')}`}
        </p>
      </aside>
    </div>
    <div class="action-bar run-end__bar">
      <${Button}
        variant="primary"
        size="lg"
        block
        icon="rotate-ccw"
        href=${href('/play/:mode', { mode: 'run' }, { type: meta.type || 'nations', go: 1 })}
        >Play again<//
      >
    </div>
  </div>`;
}
