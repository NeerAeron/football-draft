// Kit colours for the pitch: readable tokens on the green, distinct goalkeeper kits.
import { parseHex, contrastRatio, readableOn } from '../../../lib/color.js';

const PITCH = '#1a6b40';
const GK_KITS = ['#f2e14c', '#ff8a3d', '#3fd8c6', '#ef6bf2', '#9b8cff', '#ffffff', '#1b1f2a'];

const distance = (a, b) => {
  const x = parseHex(a),
    y = parseHex(b);
  return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : 999;
};

/** teams [{ color, secondary }] → [{ primary, secondary, ink, gk, gkInk }] */
export function makeKits(teams = []) {
  const kits = teams.map(team => {
    let primary = parseHex(team.color) ? team.color : '#cdf545',
      secondary = parseHex(team.secondary) ? team.secondary : readableOn(primary);
    // A green kit that melts into the grass swaps to its secondary colour.
    const melts = c => distance(c, PITCH) < 60 || contrastRatio(c, PITCH) < 1.08;
    if (melts(primary) && !melts(secondary)) [primary, secondary] = [secondary, primary];
    if (distance(primary, secondary) < 70) secondary = readableOn(primary);
    return { primary, secondary, ink: readableOn(primary), original: team.color };
  });
  // Never undo the away side's clash change (matchSetup): keep the two shirts apart.
  if (kits[1] && distance(kits[0].primary, kits[1].primary) < 80)
    for (const k of kits)
      if (parseHex(k.original) && k.primary !== k.original) {
        [k.primary, k.secondary] = [k.original, k.primary];
        k.ink = readableOn(k.primary);
        break;
      }
  for (const k of kits) delete k.original;
  const taken = kits.map(k => k.primary);
  for (const kit of kits) {
    let best = GK_KITS[0],
      score = -1;
    for (const c of GK_KITS) {
      const s = Math.min(...taken.map(t => distance(c, t)), distance(c, PITCH) * 0.8);
      if (s > score) {
        score = s;
        best = c;
      }
    }
    kit.gk = best;
    kit.gkInk = readableOn(best);
    taken.push(best);
  }
  return kits;
}
