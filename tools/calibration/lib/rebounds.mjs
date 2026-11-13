// Rebounds, measured from engine state only (used by blunders.mjs; no simulation RNG).
//
//   const track = reboundTracker(m);
//   while (!m.finished) { m.step(1 / 60); for (const r of track.step()) … }
//
// A rebound is a shot kept out that stays in play: a keeper's parry (any save that is not a
// catch), a defender's block of a shot, or the woodwork. Each one is followed for 3 s: did
// the attacking side shoot again, and did that shot score (within 2.5 s of it)? `defender`
// and `attacker` are the distances (m) of each side's nearest outfielder to the ball at the
// save; `left` marks the blunder — a second shot although a defender was the closer man.

/** How long after the save a shot counts as coming from the rebound (s). */
export const REBOUND_WINDOW = 3;
const GOAL_WINDOW = 2.5;

/** 'parry' | 'block' | 'post' for an event that leaves a rebound, else null. */
export function reboundKind(e) {
  if (e.type === 'save') return e.saveType && e.saveType !== 'catch' ? 'parry' : null;
  if (e.type === 'block') return e.cross || e.shotEventId == null ? null : 'block';
  return e.type === 'post' ? 'post' : null;
}

export function reboundTracker(m) {
  let seen = m.events.length;
  const live = [];
  return {
    /** Call after every step; returns the rebounds whose outcome is now known. */
    step() {
      const b = m.ball,
        fresh = m.events.length - seen;
      seen = m.events.length;
      for (let i = fresh - 1; i >= 0; i--) {
        const e = m.events[i],
          kind = reboundKind(e);
        if (!kind || m.mode !== 'play' || b.owner !== null) continue;
        // The side defending the goal: the saver's or blocker's; a post event is the shooter's.
        const team = kind === 'post' ? 1 - e.team : e.team;
        let defender = Infinity,
          attacker = Infinity;
        for (const p of m.activePlayers) {
          if (p.role === 'GK') continue;
          const d = Math.hypot(p.x - b.x, p.y - b.y);
          if (p.team === team) defender = Math.min(defender, d);
          else attacker = Math.min(attacker, d);
        }
        live.push({
          at: +m.elapsed.toFixed(2),
          time: m.time,
          kind,
          saveType: e.saveType ?? null,
          team,
          defender: +defender.toFixed(1),
          attacker: +attacker.toFixed(1),
          shots: m.stats[1 - team].shots,
          goals: m.score[1 - team],
          shotAfter: null,
          goal: false,
          left: false,
        });
      }
      const done = [];
      for (let i = live.length - 1; i >= 0; i--) {
        const r = live[i],
          dt = m.elapsed - r.at;
        if (r.shotAfter === null && dt <= REBOUND_WINDOW && m.stats[1 - r.team].shots > r.shots) {
          r.shotAfter = +dt.toFixed(2);
          r.left = r.defender < r.attacker;
        }
        if (r.shotAfter !== null && m.score[1 - r.team] > r.goals) r.goal = true;
        if (
          m.finished ||
          r.goal ||
          (r.shotAfter === null ? dt > REBOUND_WINDOW : dt > r.shotAfter + GOAL_WINDOW)
        ) {
          live.splice(i, 1);
          done.push(r);
        }
      }
      return done.reverse();
    },
  };
}
