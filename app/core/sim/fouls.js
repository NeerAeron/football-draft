// Infringements: offside, double touch, fouls, cards.
// Methods are installed on Match.prototype by match.js.
import { offenceInBox } from './rules.js';
import { cardRisk } from './discipline.js';

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
        standIn.emergencyKeeper = true;
        standIn.role = 'GK';
        standIn.action = 'Taking over in goal';
      }
    }
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
      penalty ? 1.7 : 0.85,
    );
  }
}
