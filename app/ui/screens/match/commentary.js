// Commentary lines from engine events (docs/engine-events.md). Pure and deterministic: the
// wording variant is picked from the event id, never from simulation RNG, so a replay or a
// re-render says the same thing.
//
//   commentary(event, { players, teams }) →
//     { id, text, tone, icon, team, minute, level } | null
//   level 3 = goal (announced to screen readers), 2 = key moment (listed), 1 = ticker only.
import { commonName } from '../../../core/players/player-labels.js';
import { PERIOD_END } from '../../../core/sim/periods.js';

/** Football minute: 0–59 s → 1', stoppage → "45+2'", extra time → "105+1'". */
export function minuteLabel(time = 0, half = 1) {
  const end = PERIOD_END[half - 1] ?? 5400;
  if (time >= end) return `${end / 60}+${Math.floor((time - end) / 60) + 1}'`;
  return `${Math.floor(time / 60) + 1}'`;
}

const pick = (list, id, salt = 0) => list[Math.abs((id || 0) * 7 + salt * 13) % list.length];
const nameOf = (ctx, id) => {
  const p = id != null ? ctx.players?.[id] : null;
  return p ? commonName(p) || p.name : null;
};
const teamOf = (ctx, t) => ctx.teams?.[t]?.name || (t === 0 ? 'Home' : 'Away');
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

const FINISH = {
  Header: ['rises highest and heads it in', 'powers a header into the net', 'nods it home'],
  Volley: ['volleys it into the net', 'catches it sweetly on the volley'],
  Penalty: ['scores from the spot', 'converts from the spot', 'buries the penalty'],
  Curler: ['curls it into the top corner', 'bends a beauty inside the post'],
  'Power shot': ['smashes it in', 'lashes it into the roof of the net', 'leathers it home'],
  'Driven shot': ['drills it low into the corner', 'fires it past the keeper'],
  'Placed finish': ['slots it home', 'passes it into the corner', 'rolls it past the keeper'],
  Knuckleball: ['a dipping knuckleball beats the keeper', 'a wicked knuckleball flies in'],
};

function goalLine(e, ctx) {
  const scorer = nameOf(ctx, e.playerId),
    assist = nameOf(ctx, e.assistId),
    story = e.story || [],
    team = teamOf(ctx, e.team);
  let text;
  if (e.ownGoal) text = `Own goal! ${scorer ? `${scorer} turns it into his own net` : 'Disaster'}.`;
  else {
    const finish = pick(FINISH[e.shotType] || FINISH['Placed finish'], e.id);
    text = `GOAL! ${scorer || team} ${e.shotType === 'Knuckleball' ? `— ${finish}` : finish}!`;
  }
  const tags = [];
  // Never "the winner": a highlight reel plays these lines before the result is known.
  if (story.includes('hat-trick')) tags.push(`Hat-trick for ${scorer}!`);
  else if (story.includes('haul')) tags.push(`${scorer} again — what a day!`);
  else if (story.includes('comeback')) tags.push(`${team} complete the comeback!`);
  else if (story.includes('equaliser'))
    tags.push(story.includes('late') ? 'Late equaliser!' : `${team} are level.`);
  else if (story.includes('go-ahead') && story.includes('late')) tags.push('Late drama!');
  else if (story.includes('brace')) tags.push(`That's two for ${scorer}.`);
  else if (story.includes('opener')) tags.push(`${team} lead.`);
  if (assist && !e.ownGoal && !e.penalty) tags.push(`Assist: ${assist}.`);
  return { text: [text, ...tags].join(' '), tone: 'goal', icon: 'goal', level: 3 };
}

function saveLine(e, ctx) {
  const k = nameOf(ctx, e.playerId) || 'The keeper',
    s = nameOf(ctx, e.shooterId),
    d = e.difficulty ?? 0.4;
  let text;
  if (d >= 0.75)
    text = pick(
      [`What a save from ${k}!`, `Unbelievable stop by ${k}!`, `${k} with a world-class save!`],
      e.id,
    );
  else if (e.saveType === 'tip over')
    text = pick([`Tipped over by ${k}!`, `${k} fingertips it over the bar!`], e.id);
  else if (e.saveType === 'parry into danger')
    text = pick([`${k} parries it… right into danger!`, `${k} can only palm it out!`], e.id);
  else if (e.saveType === 'parry')
    text = pick([`Parried away by ${k}!`, `${k} beats it out.`, `Strong hands from ${k}.`], e.id);
  else text = pick([`Comfortable for ${k}.`, `${k} gathers it.`, `Straight at ${k}.`], e.id);
  if (e.bigChance && s && d >= 0.45) text += ` ${s} denied!`;
  const level = d >= 0.45 || e.bigChance ? 2 : 1;
  return { text, tone: 'save', icon: 'hand', level };
}

function shootoutLine(e, ctx) {
  const n = nameOf(ctx, e.playerId) || teamOf(ctx, e.team),
    k = nameOf(ctx, e.keeperId) || 'the keeper',
    score = e.shootoutScore ? `${e.shootoutScore[0]}–${e.shootoutScore[1]}` : '';
  const prefix = e.suddenDeath ? 'Sudden death: ' : '';
  const body =
    e.outcome === 'goal'
      ? pick([`${n} scores.`, `${n} makes no mistake.`, `${n} tucks it away.`], e.id)
      : e.outcome === 'saved'
        ? pick([`Saved! ${k} guesses right.`, `${k} saves from ${n}!`], e.id)
        : e.outcome === 'post'
          ? `${n} hits the post!`
          : pick([`${n} blazes it over!`, `${n} drags it wide!`], e.id);
  const end = e.decisive
    ? ` ${teamOf(ctx, e.outcome === 'goal' ? e.team : 1 - e.team)} win it!`
    : '';
  return {
    text: `${prefix}${body}${score ? ` (${score})` : ''}${end}`,
    tone: e.outcome === 'goal' ? 'goal' : 'miss',
    icon: e.outcome === 'goal' ? 'circle-check' : 'circle-x',
    level: e.decisive ? 3 : 2,
  };
}

/** One event → a commentary line, or null when it is not worth a line (or not resolved yet). */
export function commentary(e, ctx = {}) {
  if (!e) return null;
  const who = nameOf(ctx, e.playerId);
  let line = null;
  switch (e.type) {
    case 'goal':
      line = goalLine(e, ctx);
      break;
    case 'save':
      line = saveLine(e, ctx);
      break;
    case 'near-miss':
      line = {
        text:
          e.miss === 'over'
            ? pick(
                [
                  'Just over the bar!',
                  `${who} clips the top of the net!`,
                  `Inches over from ${who}!`,
                ],
                e.id,
              )
            : pick(
                ['Inches wide!', `Agonisingly wide from ${who}!`, `${who} — just past the post!`],
                e.id,
              ),
        tone: 'chance',
        icon: 'crosshair',
        level: 2,
      };
      break;
    case 'post':
      line = {
        text:
          e.frame === 'bar'
            ? pick(['Off the crossbar!', `${who} rattles the bar!`], e.id)
            : pick(['Off the post!', `${who} hits the woodwork!`, `The post denies ${who}!`], e.id),
        tone: 'chance',
        icon: 'target',
        level: 2,
      };
      break;
    case 'shot':
      if (e.outcome === 'in flight' || e.outcome == null) return null; // wait for the outcome
      if (e.outcome === 'off target' && e.bigChance)
        line = {
          text: pick(
            [`Big chance missed! ${who} should score.`, `How has ${who} missed that?`],
            e.id,
          ),
          tone: 'chance',
          icon: 'crosshair',
          level: 2,
        };
      else if (e.outcome === 'off target')
        line = {
          text:
            (e.distance ?? 0) > 22
              ? pick(
                  [
                    `${who} tries his luck from distance — off target.`,
                    `Ambitious from ${who}, wide.`,
                  ],
                  e.id,
                )
              : pick([`${who} fires wide.`, `Off target from ${who}.`], e.id),
          tone: 'info',
          icon: 'crosshair',
          level: 1,
        };
      break;
    case 'block':
      if (e.bigChance)
        line = { text: `Last-ditch block from ${who}!`, tone: 'save', icon: 'shield', level: 2 };
      else line = { text: `Blocked by ${who}.`, tone: 'info', icon: 'shield', level: 1 };
      break;
    case 'penalty':
      line = {
        text: `Penalty! ${who || 'He'} is brought down in the box.`,
        tone: 'card',
        icon: 'circle-dot',
        level: 2,
      };
      break;
    case 'yellow':
      line = {
        text: pick(
          [`Booked: ${who}.`, `Yellow card for ${who}.`, `${who} goes into the book.`],
          e.id,
        ),
        tone: 'card',
        icon: 'card-yellow',
        level: 2,
      };
      break;
    case 'red':
      line = {
        text: e.secondYellow
          ? `Second yellow! ${who} is off.`
          : `Straight red! ${who} is sent off.`,
        tone: 'card',
        icon: 'card-red',
        level: 2,
      };
      break;
    case 'offside':
      line = { text: `${who} flagged offside.`, tone: 'info', icon: 'flag', level: 1 };
      break;
    case 'cross':
    case 'cutback':
    case 'through':
      if ((e.strength ?? 0) >= 0.75)
        line = {
          text: pick(
            [
              `Lovely ${e.type === 'through' ? 'through ball' : e.type} from ${who}.`,
              `${cap(e.type === 'through' ? 'threaded' : 'whipped')} in by ${who}.`,
            ],
            e.id,
          ),
          tone: 'info',
          icon: 'zap',
          level: 1,
        };
      break;
    case 'dribble':
      if ((e.strength ?? 0) >= 0.8)
        line = {
          text: pick([`${who} skins his man!`, `Lovely footwork from ${who}.`], e.id),
          tone: 'info',
          icon: 'zap',
          level: 1,
        };
      break;
    case 'tackle':
      if ((e.strength ?? 0) >= 0.85)
        line = {
          text: pick([`Crunching tackle by ${who}.`, `Superb challenge from ${who}.`], e.id),
          tone: 'info',
          icon: 'shield',
          level: 1,
        };
      break;
    case 'added':
      line = { text: `+${e.minutes} minutes added.`, tone: 'info', icon: 'clock', level: 1 };
      break;
    case 'half':
      line = { text: 'Half-time.', tone: 'whistle', icon: 'whistle', level: 1 };
      break;
    case 'extra-time':
      line = {
        text: e.period === 1 ? 'Extra time! 30 more minutes.' : 'Extra time, second half.',
        tone: 'whistle',
        icon: 'whistle',
        level: 2,
      };
      break;
    case 'full':
      line = {
        text: e.shootout ? 'Level at full time — penalties!' : 'Full-time.',
        tone: 'whistle',
        icon: 'whistle',
        level: e.shootout ? 2 : 1,
      };
      break;
    case 'shootout-start':
      line = {
        text: `Penalties! ${teamOf(ctx, e.first)} go first.`,
        tone: 'whistle',
        icon: 'whistle',
        level: 1,
      };
      break;
    case 'shootout':
      line = shootoutLine(e, ctx);
      break;
    case 'kickoff':
      line = { text: 'Kick-off!', tone: 'whistle', icon: 'whistle', level: 1 };
      break;
    default:
      return null;
  }
  if (!line) return null;
  return {
    id: e.id,
    team: e.team ?? null,
    minute: e.type.startsWith('shootout') ? 'PEN' : minuteLabel(e.time, e.half),
    ...line,
  };
}

/** Commentary for a whole event list (newest first, as the engine keeps it) → oldest first. */
export function commentaryLines(events, ctx, minLevel = 1) {
  const out = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const line = commentary(events[i], ctx);
    if (line && line.level >= minLevel) out.push(line);
  }
  return out;
}
