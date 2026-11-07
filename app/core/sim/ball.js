// Ball flight: contacts, saves, blocks, receptions, bounds and goals.
// Methods are installed on Match.prototype by match.js.
import { clamp, dist, lerp } from '../util/math.js';
import { goalZone } from './goal-zones.js';
import { offsideSnapshot } from './rules.js';
import { W, H, GOAL, segment } from './constants.js';

export class BallMethods {
  moveBall(dt) {
    const b = this.ball,
      prev = { x: b.x, y: b.y };
    b.previous = { x: b.x, y: b.y, z: b.z };
    if (b.kind === 'shot') {
      b.vy += (b.curve || 0) * dt;
      if (b.shotType === 'Knuckleball') b.vy += Math.sin(b.age * 23) * 7 * dt;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z = Math.max(0, b.z + b.vz * dt);
    b.vz -= 9.81 * dt;
    if (b.z === 0) {
      b.vz = Math.abs(b.vz) > 0.9 ? -b.vz * 0.3 : 0;
      const speed = Math.hypot(b.vx, b.vy),
        drag = Math.max(0, 1 - ((b.kind === 'pass' ? b.roll || 3.8 : 2) * dt) / (speed || 1));
      b.vx *= drag;
      b.vy *= drag;
    }
    if (
      b.kind === 'pass' &&
      b.destination &&
      ((b.x - b.destination.x) * b.vx + (b.y - b.destination.y) * b.vy > 0 ||
        Math.hypot(b.vx, b.vy) < 5)
    ) {
      b.missedReceiver = true;
      this.planTimer = 0;
    }
    const flightTeam =
      b.shotTeam ??
      b.shotRecord?.team ??
      this.players[b.goalCredit?.shooter ?? b.kicker]?.team ??
      b.lastTouch;
    const incomingGoal =
      b.kind === 'shot' || (this.rel(b.x, flightTeam) > 77 && this.projectedOnTarget());
    const candidates = this.activePlayers
      .filter(p => this.canCollect(p))
      .map(p => ({ p, ...segment(p, prev, b) }))
      .filter(
        o =>
          o.d <
          (this.canHandle(o.p) && incomingGoal
            ? 1.3 + o.p.skill('goalkeeping') * 0.011
            : this.collectionReach(o.p)),
      )
      .sort((a, c) => a.t - c.t || a.d - c.d);
    if (b.kind === 'shot' && b.offsideState) {
      const g = this.keeper(1 - b.shotTeam);
      for (const id of b.offsideState.candidates) {
        const p = this.players[id],
          screen = segment(p, b, g);
        if (
          dist(p, g) < 2 &&
          screen.t > 0.05 &&
          screen.t < 0.98 &&
          screen.d < 0.65 &&
          this.checkOffside(p)
        )
          return;
      }
    }
    for (const c of candidates) {
      const p = c.p;
      if (b.z > (this.canHandle(p) && incomingGoal ? 2.7 : 1.6 + p.skill('heading') * 0.007))
        continue;
      if (this.checkOffside(p)) return;
      if (this.checkRestartTouch(p)) return;
      if (this.canHandle(p) && incomingGoal && p.team !== flightTeam) {
        if (b.saver === p.id) continue;
        b.saver = p.id;
        const speed = Math.hypot(b.vx, b.vy),
          lateral = Math.abs((p.x - b.x) * b.vy - (p.y - b.y) * b.vx) / (speed || 1),
          onTarget = this.projectedOnTarget();
        const prob = clamp(
          0.34 +
            p.skill('goalkeeping') * 0.0063 -
            lateral * 0.14 -
            Math.max(0, speed - 25) * 0.016 +
            this.profile.saveBoost +
            (b.penaltyKick ? -0.08 - this.profile.saveBoost : 0) +
            (b.shotRecord ? 0 : 0.18 + Math.max(0, 24 - speed) * 0.015) +
            (p.has('gkoneonone') && b.shotOrigin && dist(p, b.shotOrigin) < 16 ? 0.035 : 0),
          0.04,
          b.shotRecord ? 0.95 : 0.995,
        );
        p.action = 'Diving';
        p.animation = {
          type: 'dive',
          start: this.elapsed,
          duration: 0.6,
          angle: Math.atan2(b.y - p.y, b.x - p.x),
        };
        const effectiveSave = clamp(prob * this.tuning.gameplay.saveAbility, 0.01, 0.995);
        if (this.rand() < effectiveSave) {
          this.resolveShot(onTarget ? 'saved' : 'off target');
          if (onTarget && b.shotRecord) {
            this.stats[p.team].saves++;
            p.stats.saves++;
            this.addEvent(`${p.name.split(' ').pop()} makes the save.`, p.team, 'save', {
              playerId: p.id,
              chance: effectiveSave,
              chanceLabel: 'save',
              strength: clamp(speed / 38, 0, 1),
            });
          }
          b.penaltyTaker = null;
          b.restartTaker = null;
          b.indirect = null;
          if (
            this.rand() <
            0.48 + p.skill('goalkeeping') * 0.003 + (p.has('safehands') ? 0.1 : 0)
          ) {
            this.own(p, true);
            p.hold = 0;
            if (onTarget) this.flair('catch', p, 0.55, { label: 'SAVED', strength: 0.35 });
          } else {
            if (onTarget) this.flair('parry', p, 0.7, { label: 'PARRIED', strength: 0.65 });
            b.vx *= -0.2;
            b.vy = (b.y > p.y ? 1 : -1) * (4 + this.rand() * 6);
            b.vz = 2;
            b.kind = 'loose';
            b.lastTouch = p.team;
            b.kicker = p.id;
            b.age = 0;
            p.cooldown = 0.6;
          }
          return;
        }
        continue;
      }
      if (b.z > 1.6 + p.skill('heading') * 0.007) continue;
      if (b.kind === 'shot') {
        if (p.team === b.shotTeam) continue;
        if (this.rand() < 0.35 + p.skill('defending') * 0.003) {
          this.resolveShot('blocked');
          b.vx *= -0.22;
          b.vy += this.noise() * 6;
          b.vz = 1.5;
          b.kind = 'loose';
          b.lastTouch = p.team;
          b.kicker = p.id;
          b.age = 0;
          b.indirect = null;
          b.penaltyTaker = null;
          b.restartTaker = null;
          b.penaltyKick = false;
          p.cooldown = 0.3;
          p.stats.blocks++;
          this.addEvent(`${p.name.split(' ').pop()} blocks the shot.`, p.team, 'block', {
            playerId: p.id,
            strength: 0.4,
          });
          return;
        }
        p.cooldown = 0.2;
        continue;
      }
      const height = b.z,
        speed = Math.hypot(b.vx, b.vy),
        teammate = b.kind === 'pass' && b.kicker !== null && this.players[b.kicker].team === p.team;
      if (!teammate && b.kind === 'pass' && p.role !== 'GK') {
        const facing = (Math.cos(p.facing) * -b.vx + Math.sin(p.facing) * -b.vy) / (speed || 1);
        const disguise =
          (1 - clamp(((b.passCraft ?? 60) - 60) * 0.0085, 0, 0.34)) *
          (1 -
            clamp(((b.passCraft ?? 60) - p.pressAwareness()) / 30, 0, 1) *
              0.2 *
              this.tuning.gameplay.passingQuality);
        const read = clamp(
          (0.53 +
            p.pressAwareness() * 0.0042 +
            p.pressingReading() * 0.05 -
            Math.max(0, speed - 17) * 0.008 +
            facing * 0.035 +
            (p.has('interceptor') ? 0.08 : 0)) *
            this.profile.readWindow *
            disguise,
          0.28,
          0.96,
        );
        if (this.rand() > read) {
          p.cooldown = 0.15;
          continue;
        }
      }
      // Measure sideways reach from the flight line. Distance to this frame's
      // short segment wrongly labels a centered, approaching pass a stretch.
      const touchOffset =
        speed > 1 ? Math.abs((p.x - prev.x) * b.vy - (p.y - prev.y) * b.vx) / speed : c.d;
      const pressure = this.pressure(p),
        baseControl = this.firstTouchChance(
          p,
          height,
          speed,
          this.executionPressure(p),
          teammate,
          touchOffset,
        );
      // Closing pressure can win a duel; it should not make a ball already at
      // the feet invisible to its nearest player.
      const settled = (b.kind === 'loose' || b.missedReceiver) && height < 0.3 && speed < 3.2;
      const control = settled ? 1 - (1 - baseControl) * 0.12 : baseControl;
      if (this.rand() < control) {
        if (teammate && height > 1.15 && this.contestAerial(p)) return;
        const aerial =
          teammate &&
          height > 0.45 &&
          this.inBox(p) &&
          this.rand() < (0.25 + p.tendency('shoot') * 0.6) * (height > 1.15 ? 0.9 : 1);
        if (!teammate && b.kind === 'pass')
          this.addEvent(`${p.name.split(' ').pop()} intercepts.`, p.team, 'intercept', {
            playerId: p.id,
          });
        const recoveringBackpass =
          b.pendingPass &&
          this.players[b.pendingPass.from]?.team === p.team &&
          b.lastTouch === p.team;
        const handling = this.canHandle(p) && !teammate && !recoveringBackpass;
        if (this.own(p, handling) && aerial) this.shoot(p, { aerialHeight: height });
        return;
      }
      p.stats.miscontrols++;
      this.stats[p.team].miscontrols++;
      if (teammate && b.kicker !== null)
        b.pendingPass = { from: b.kicker, delivery: b.delivery, chance: b.chance };
      b.vx *= 0.4;
      b.vy *= 0.4;
      b.kind = 'loose';
      b.lastTouch = p.team;
      b.target = null;
      b.indirect = null;
      b.penaltyTaker = null;
      b.offsideState = teammate
        ? offsideSnapshot(this, p)
        : speed < 15 && height < 1 && pressure < 0.4 && p.skill('control') > 65
          ? null
          : b.offsideState;
      b.restartTaker = null;
      // Recovering balance after a poor reception takes longer under pressure;
      // players keep chasing, and better control shortens the recovery.
      p.cooldown = teammate
        ? 0.32 + clamp((100 - p.skill('control')) * 0.006, 0, 0.3) + Math.min(pressure, 0.8) * 0.12
        : 0.2;
      p.controlErrorAt = this.elapsed;
      p.controlUntil = this.elapsed + p.cooldown;
      if (teammate) {
        p.action = 'Miscontrolled first touch';
        p.animation = {
          type: 'stumble',
          start: this.elapsed,
          duration: Math.min(0.35, p.cooldown),
        };
      }
      this.planTimer = 0;
      // The touch changed the flight. Recompute nearby candidates next frame
      // instead of awarding another contact along the old trajectory.
      return;
    }
  }
  checkBounds() {
    const b = this.ball;
    if (b.x < 0 || b.x > W) {
      const right = b.x > W;
      let crossY = b.y,
        crossZ = b.z;
      if (b.previous && b.previous.x >= 0 && b.previous.x <= W) {
        const f = ((right ? W : 0) - b.previous.x) / (b.x - b.previous.x || 1);
        crossY = lerp(b.previous.y, b.y, f);
        crossZ = lerp(b.previous.z, b.z, f);
      }
      const frameHit =
        (Math.abs(Math.abs(crossY - 34) - GOAL / 2) < 0.16 && crossZ < 2.6) ||
        (Math.abs(crossZ - 2.44) < 0.13 && Math.abs(crossY - 34) < GOAL / 2 + 0.1);
      if (frameHit && b.kind === 'shot') {
        this.resolveShot('post');
        b.x = right ? 104.8 : 0.2;
        b.y = crossY;
        b.z = crossZ;
        b.vx *= -0.55;
        b.vy += this.noise() * 2;
        b.kind = 'loose';
        b.previous = null;
        this.addEvent('Off the woodwork!', b.shotTeam, 'post', { strength: 0.8 });
        return;
      }
      if (Math.abs(crossY - 34) < GOAL / 2 && crossZ < 2.44) {
        const team = this.direction(0) === (right ? 1 : -1) ? 0 : 1;
        if (b.indirect !== null && b.indirect !== undefined) {
          const own = this.players[b.indirect].team !== team;
          this.startRestart(
            own ? 'Corner' : 'Goal kick',
            own ? team : 1 - team,
            right ? (own ? 104.7 : 99.5) : own ? 0.3 : 5.5,
            own ? (crossY < 34 ? 0.3 : 67.7) : 34,
          );
          return;
        }
        this.resolveShot(this.ball.shotRecord?.team === team ? 'goal' : 'off target');
        this.score[team]++;
        const scorer = this.players[b.goalCredit?.shooter ?? b.owner ?? b.kicker],
          ownGoal = scorer && scorer.team !== team,
          assist =
            !ownGoal && b.goalCredit?.assist != null ? this.players[b.goalCredit.assist] : null,
          origin =
            b.goalCredit?.origin ||
            b.shotOrigin ||
            b.deliveryOrigin ||
            (scorer
              ? this.origin(scorer)
              : {
                  x: b.x,
                  y: b.y,
                  attackX: this.rel(b.x, team),
                  box: false,
                  zone: goalZone(this.rel(b.x, team), b.y),
                });
        if (ownGoal) {
          origin.attackX = this.rel(origin.x, team);
          origin.box = origin.attackX >= 88.5 && Math.abs(origin.y - 34) <= 20.16;
          origin.zone = goalZone(origin.attackX, origin.y);
        }
        if (scorer && !ownGoal) {
          scorer.stats.goals++;
          if (!b.shotRecord) {
            this.stats[team].shots++;
            this.stats[team].onTarget++;
            scorer.stats.shots++;
            scorer.stats.onTarget++;
            if (origin.box) this.stats[team].boxShots++;
          }
        }
        if (assist) {
          assist.stats.assists++;
          this.stats[team].assistedGoals++;
        }
        if (origin.box) this.stats[team].boxGoals++;
        if (Math.abs(origin.y - 34) <= 9.16) this.stats[team].centralGoals++;
        else this.stats[team].wideGoals++;
        const event = this.addEvent(
          `${scorer && !ownGoal ? scorer.name.split(' ').pop() : this.teams[team].name} scores${ownGoal ? ' · own goal' : ''}${assist ? ' · ' + assist.name.split(' ').pop() + ' assist' : ''}!`,
          team,
          'goal',
          {
            playerId: ownGoal ? null : scorer?.id,
            assistId: assist?.id,
            strength: 1,
            box: !!origin.box,
            zone: origin.zone || goalZone(origin.attackX ?? this.rel(origin.x, team), origin.y),
            shotType:
              b.goalCredit?.shotType ||
              b.shotType ||
              (b.kind === 'pass'
                ? b.delivery === 'cross'
                  ? 'Cross into goal'
                  : 'Pass into goal'
                : 'Finish'),
            origin,
            ownGoal: !!ownGoal,
          },
        );
        this.goalHistory.push(event);
        this.effect('goal', { x: right ? 104 : 1, y: 34, team }, 2.5, {
          label: 'GOAL',
          strength: 1,
          scorer: scorer?.name,
          assist: assist?.name,
        });
        this.startRestart('Goal', 1 - team, 52.5, 34, 2.5);
        return;
      }
      this.resolveShot('off target');
      const defending = this.direction(0) === (right ? -1 : 1) ? 0 : 1;
      if (b.lastTouch === defending)
        this.startRestart('Corner', 1 - defending, right ? 104.7 : 0.3, b.y < 34 ? 0.3 : 67.7);
      else this.startRestart('Goal kick', defending, right ? 99.5 : 5.5, 34);
      return;
    }
    if (b.y < 0 || b.y > H) {
      this.resolveShot('off target');
      this.startRestart('Throw-in', 1 - b.lastTouch, clamp(b.x, 1, 104), b.y < 0 ? 0.2 : 67.8);
    }
  }
}
