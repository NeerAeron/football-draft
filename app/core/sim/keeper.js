// Keeper dive model. A keeper reacts after a rating-dependent delay, then
// dives: reach grows with the time left before the ball passes. Whether a
// shot is saved depends on how far the keeper must stretch (shot placement,
// height) and how hard it is struck; the save's outcome (catch, parry wide,
// parry into danger, tip over) follows from the same quantities.
// Methods are installed on Match.prototype by match.js.
import { clamp } from '../util/math.js';
import { GOAL, hypot } from './constants.js';

export class KeeperMethods {
  // Reaction delay (s) and dive speed (m/s) from the keeper's rating.
  keeperReaction(g) {
    return 0.2 - (g.skill('goalkeeping') - 50) * 0.0022 - (g.has('reflexes') ? 0.04 : 0);
  }
  // How far (m) the keeper can reach when the ball passes at ball age `age`.
  // A dive covers ground for 0.42 s; with more time than that he has moved his feet first.
  keeperReach(g, age = this.ball.age) {
    const gk = g.skill('goalkeeping'),
      dive = (2.4 + gk * 0.032) * (0.8 + 0.2 * g.energy),
      time = age - this.keeperReaction(g);
    return 0.85 + gk * 0.003 + dive * clamp(time, 0, 0.42) + 2 * clamp(time - 0.42, 0, 0.45);
  }
  // Shot-stopping quality before stretch and power (0.6–1): a rating-80 keeper
  // is 0.904; keeperRange scales how far ratings move it either way.
  keeperQuality(g) {
    return clamp(
      0.904 + (g.skill('goalkeeping') - 80) * 0.0048 * this.tuning.gameplay.keeperRange,
      0.6,
      1,
    );
  }
  // The keeper g meets an incoming ball. Returns true when he handled it
  // (the frame's contacts end), false when it is out of reach.
  keeperSave(g) {
    const b = this.ball,
      speed = hypot(b.vx, b.vy) || 1,
      rx = g.x - b.x,
      ry = g.y - b.y,
      along = (rx * b.vx + ry * b.vy) / speed,
      lateral = Math.abs(rx * b.vy - ry * b.vx) / speed;
    if (along < -0.6) return false;
    // Placement: sideways distance to the flight line plus any height above
    // a comfortable catch; reach: dive time left before the ball passes.
    const high = clamp((b.z - 1.8) / 0.65, 0, 1),
      miss = hypot(lateral, Math.max(0, b.z - 1.8) * 1.1),
      arrival = b.age + Math.max(0, along) / speed,
      reach = this.keeperReach(g, arrival);
    if (miss > reach) return false;
    if (b.saver === g.id) return false;
    b.saver = g.id;
    const gk = g.skill('goalkeeping'),
      stretch = clamp(miss / reach, 0, 1),
      power = clamp((speed - 15) / 17, 0, 1),
      onTarget = this.projectedOnTarget(),
      record = b.shotRecord;
    // Time to set himself: 0 for a point-blank reflex save, 1 once he has seen the shot all
    // the way (roughly 20 m and out). A set keeper is surer of his hands and a stretch costs
    // him less, so shots from distance need a corner AND pace to beat him. Penalties are a
    // guess, and a header from a cross arrives while he is still moving across his line.
    const time = arrival - this.keeperReaction(g),
      set = b.penaltyKick
        ? 0
        : clamp((time - 0.15) / 0.3, 0, 1) * (b.shotType === 'Header' ? 0.4 : 1);
    const quality = this.keeperQuality(g),
      sure = quality - 0.03 * (1 - set) + Math.max(0, 0.975 - quality) * 0.8 * set;
    const prob = clamp(
      sure * (1 - (0.6 * stretch * stretch + 0.22 * power * stretch) * (1.6 - 0.9 * set)) +
        // The format's save adjustment weighs most on reflex saves: a short match needs its
        // box chances to count, not soft goals from distance.
        this.profile.saveBoost * (1 - 0.6 * set) +
        (b.penaltyKick ? -0.3 : 0) +
        (record ? 0 : 0.15) +
        (g.has('gkoneonone') &&
        b.shotOrigin &&
        hypot(g.x - b.shotOrigin.x, g.y - b.shotOrigin.y) < 16
          ? 0.04
          : 0),
      0.04,
      record ? 0.97 : 0.995,
    );
    const save = clamp(prob * this.tuning.gameplay.saveAbility, 0.01, 0.995);
    g.action = 'Diving';
    g.animation = {
      type: 'dive',
      start: this.elapsed,
      duration: 0.6,
      angle: Math.atan2(b.y - g.y, b.x - g.x),
      stretch,
    };
    if (this.rand() >= save) return false;
    this.resolveShot(onTarget ? 'saved' : 'off target');
    let event = null;
    if (onTarget && record && !record.shootout) {
      this.stats[g.team].saves++;
      g.stats.saves++;
      event = this.addEvent(`${g.name.split(' ').pop()} makes the save.`, g.team, 'save', {
        playerId: g.id,
        chance: save,
        chanceLabel: 'save',
        strength: clamp(speed / 38, 0, 1),
        shotEventId: record.eventId,
        shooterId: record.player,
        xg: record.xg,
        bigChance: record.bigChance,
        difficulty: clamp(1 - save, 0, 1),
        saveType: 'catch',
      });
    }
    b.penaltyTaker = null;
    b.restartTaker = null;
    b.indirect = null;
    const catchChance = clamp(
      0.95 -
        power * 0.45 -
        stretch * 0.55 -
        high * 0.25 +
        (gk - 75) * 0.006 +
        (g.has('safehands') ? 0.1 : 0),
      0.05,
      0.95,
    );
    if (this.rand() < catchChance) {
      this.own(g, true);
      g.hold = 0;
      if (onTarget) this.flair('catch', g, 0.55, { label: 'SAVED', strength: 0.35 });
      return true;
    }
    const type = this.deflectSave(g, high, stretch, power, gk);
    if (event) event.saveType = type;
    if (onTarget)
      this.flair('parry', g, 0.7, {
        label: type === 'tip over' ? 'TIPPED OVER' : 'PARRIED',
        strength: 0.65,
      });
    return true;
  }
  // Push the ball away: over the bar, around the post / out wide, or back into
  // the box. Wide and over often go behind for a corner.
  deflectSave(g, high, stretch, power, gk) {
    const b = this.ball,
      out = this.direction(g.team),
      line = this.abs(0, g.team),
      depth = Math.max(0.3, Math.abs(b.x - line)),
      side = Math.abs(b.y - 34) > 0.3 ? Math.sign(b.y - 34) : b.vy >= 0 ? 1 : -1;
    let type;
    if (high > 0.35 && Math.abs(b.y - 34) < GOAL / 2 + 0.3) {
      type = 'tip over';
      b.z = Math.max(b.z, 2.3);
      b.vz = 2.2 + this.rand() * 1.5;
      b.vx = -out * (3 + this.rand() * 2);
      b.vy *= 0.3;
    } else if (
      this.rand() < clamp(0.42 + (gk - 70) * 0.012 + stretch * 0.3 - power * 0.1, 0.2, 0.9)
    ) {
      type = 'parry';
      b.vy = side * (5 + this.rand() * 4);
      b.vz = 1.2 + this.rand() * 1.2;
      // Around the post and behind, unless that would carry it inside the post.
      const behind = -out * (1.5 + this.rand() * 2.5),
        crossing = b.y + (b.vy * depth) / Math.abs(behind);
      b.vx =
        this.rand() < 0.85 && Math.abs(crossing - 34) > GOAL / 2 + 0.8
          ? behind
          : out * (0.5 + this.rand() * 2);
    } else {
      type = 'parry';
      b.vx = out * (3 + this.rand() * 3);
      b.vy = (this.rand() - 0.5) * 5;
      b.vz = 1.2 + this.rand();
    }
    b.kind = 'loose';
    b.lastTouch = g.team;
    b.kicker = g.id;
    b.deflectedBy = g.id;
    b.deflectedAt = this.elapsed;
    b.age = 0;
    g.cooldown = 0.6;
    return type === 'parry' && this.reboundDanger(g) ? 'parry into danger' : type;
  }
}
