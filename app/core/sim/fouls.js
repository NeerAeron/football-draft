// Infringements: offside, double touch, fouls, cards.
// Methods are installed on Match.prototype by match.js.
import { offenceInBox } from './rules.js';
import { cardRisk } from './discipline.js';
import { positionFamiliarity } from '../players/ratings.js';

// Lines of the team shape, for reshaping after a dismissal.
const LINE = { CB: 0, LB: 0, RB: 0, DM: 1, CM: 1, LM: 1, RM: 1, AM: 2, LW: 2, RW: 2, ST: 2 };

export class FoulMethods {
  checkRestartTouch(p) {
    if (this.ball.restartTaker !== p.id && this.ball.penaltyTaker !== p.id) return false;
    this.addEvent(`${p.name.split(' ').pop()} touches the restart twice.`, 1 - p.team, 'foul', {
      playerId: p.id,
    });
    this.startRestart('Indirect free kick', 1 - p.team, p.x, p.y);
    return true;
  }
  checkOffside(p) {
    if (p.sentOff) return false;
    const snap = this.ball.offsideState;
    if (!snap || p.team !== snap.team || !snap.candidates.includes(p.id)) return false;
    this.stats[p.team].offsides++;
    p.stats.offsides++;
    this.addEvent(`${p.name.split(' ').pop()} is offside.`, p.team, 'offside', {
      playerId: p.id,
      line: snap.line,
    });
    this.effect('whistle', p, 0.9, { label: 'OFFSIDE', strength: 0.35 });
    this.startRestart('Offside', 1 - p.team, p.x, p.y, 0.75);
    return true;
  }
  issueCard(p, card, reason = 'Reckless challenge') {
    if (p.sentOff) return false;
    if (card === 'yellow') {
      p.yellowCards++;
      p.stats.yellowCards++;
      this.stats[p.team].yellowCards++;
    }
    const secondYellow = card === 'yellow' && p.yellowCards === 2,
      red = card === 'red' || secondYellow;
    this.addEvent(
      `${p.name} · ${red ? (secondYellow ? 'second yellow, sent off' : 'red card') : 'yellow card'}`,
      p.team,
      red ? 'red' : 'yellow',
      { playerId: p.id, secondYellow, reason },
    );
    this.effect('whistle', p, 1, {
      label: red ? 'RED CARD' : 'YELLOW CARD',
      strength: red ? 0.8 : 0.4,
    });
    if (!red) return true;
    p.sentOff = true;
    p.dismissedRole = p.role;
    p.stats.redCards++;
    this.stats[p.team].redCards++;
    p.vx = p.vy = 0;
    p.action = 'Sent off';
    p.animation = null;
    p.trail = [];
    this.rebuildActive();
    if (!this.keeper(p.team)) {
      const standIn = this.activePlayers
        .filter(q => q.team === p.team)
        .sort(
          (a, b) =>
            b.skill('goalkeeping') - a.skill('goalkeeping') ||
            b.skill('heading') - a.skill('heading'),
        )[0];
      if (standIn) {
        const role = standIn.role;
        standIn.emergencyKeeper = true;
        standIn.role = 'GK';
        standIn._stamp = 0;
        standIn.action = 'Taking over in goal';
        // The stand-in left his own position empty: cover that one.
        this.coverDismissal(standIn, role);
      }
    } else this.coverDismissal(p, p.dismissedRole);
    if (this.ball.owner === p.id) {
      this.ball.owner = null;
      this.ball.kind = 'loose';
      this.ball.vx = this.ball.vy = 0;
    }
    if (this.ball.target === p.id) {
      this.ball.target = null;
      this.ball.missedReceiver = true;
    }
    if (this.pendingTackle?.id === p.id) this.pendingTackle = null;
    for (const q of this.activePlayers) {
      q.rethinkAt = 0;
      q.markId = null;
    }
    this.presser = [null, null];
    this.planTimer = 0;
    if (this.activePlayers.filter(q => q.team === p.team).length < 7) {
      this.abandonedTeam = p.team;
      this.finished = true;
      this.mode = 'fulltime';
      this.phase = 'Match abandoned';
      this.addEvent(
        `${this.teams[p.team].name} have fewer than seven players. Match abandoned.`,
        p.team,
        'full',
      );
    }
    return true;
  }
  // Down a man, a side closes the hole instead of playing on around it, the way a coach
  // reshapes at once: the back line and the midfield stay whole and a forward is given up.
  // A lost defender is replaced by the midfielder who knows the position best, and a
  // forward (the second striker, else an attacking midfielder or winger) drops into the
  // midfield; a lost lone striker is replaced by another attacker. Players swap formation
  // slots with the man who left, so every later formation change keeps the shape.
  // `off` holds the free slot (the dismissed player, or the stand-in keeper), `role` is the
  // position that slot plays. Applies to both sides; no RNG.
  coverDismissal(off, role) {
    let line = LINE[role];
    if (line === undefined) return;
    const mates = this.activePlayers.filter(
        q => q.team === off.team && q.role !== 'GK' && q.id !== off.id,
      ),
      best = (list, target) =>
        list
          .map(q => ({ q, fit: positionFamiliarity(q, target) }))
          .sort((a, c) => c.fit - a.fit || a.q.energy - c.q.energy || a.q.id - c.q.id)[0]?.q,
      take = q => {
        const from = q.role;
        off.shiftedFrom ??= off.slot;
        q.shiftedFrom ??= q.slot;
        [q.slot, off.slot] = [off.slot, q.slot];
        q.role = this.formation(q)[2];
        q._stamp = 0;
        q.action = 'Covering the gap';
        role = from;
        line = LINE[from];
        return q;
      };
    const moved = [];
    if (line === 0) {
      const cover = best(
        mates.filter(q => LINE[q.role] === 1),
        role,
      );
      if (cover) moved.push(take(cover));
    }
    const strikers = mates.filter(q => q.role === 'ST' && !moved.includes(q)),
      others = mates.filter(q => LINE[q.role] === 2 && q.role !== 'ST' && !moved.includes(q));
    if (line === 2) {
      // Somebody has to lead the line.
      if (role === 'ST' && !strikers.length && others.length) moved.push(take(best(others, 'ST')));
    } else if (line === 1) {
      const spare = strikers.length >= 2 ? strikers : others;
      if (spare.length) moved.push(take(best(spare, role)));
    }
    if (moved.length)
      this.addEvent(
        `${this.teams[off.team].name} reshape: ${moved
          .map(q => `${q.name.split(' ').pop()} to ${q.role}`)
          .join(', ')}.`,
        off.team,
        'reshape',
        { playerIds: moved.map(q => q.id), roles: moved.map(q => q.role) },
      );
  }
  awardFoul(offender, victim, point = { x: victim.x, y: victim.y }) {
    const penalty = offenceInBox(this, offender, point),
      team = victim.team;
    const risk = cardRisk(this, offender, victim, this.challengeModel(victim, offender), penalty);
    offender.stats.fouls++;
    victim.stats.foulsWon++;
    this.stats[offender.team].fouls++;
    this.stats[team].foulsWon++;
    if (penalty) this.stats[team].penalties++;
    this.addEvent(
      `${offender.name.split(' ').pop()} fouls ${victim.name.split(' ').pop()}${penalty ? ' · penalty awarded' : ''}.`,
      team,
      penalty ? 'penalty' : 'foul',
      { playerId: victim.id, offenderId: offender.id, origin: { ...point } },
    );
    this.effect('whistle', { ...point, team }, penalty ? 1.4 : 0.85, {
      label: penalty ? 'PENALTY' : 'FOUL',
      strength: penalty ? 0.8 : 0.3,
    });
    if (this.rand() < risk.red)
      this.issueCard(
        offender,
        'red',
        risk.dogso ? 'Denied a clear goal chance' : 'Excessive force',
      );
    else if (this.rand() < risk.yellow)
      this.issueCard(
        offender,
        'yellow',
        risk.dogso ? 'Denied a goal chance while challenging for the ball' : 'Reckless challenge',
      );
    if (this.finished) return;
    this.startRestart(
      penalty ? 'Penalty' : 'Free kick',
      team,
      penalty ? this.abs(94, team) : point.x,
      penalty ? 34 : point.y,
      penalty ? 2.6 : 0.85,
    );
  }
}
