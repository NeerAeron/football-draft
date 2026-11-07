// Public entry of the match simulation: deterministic, fixed-step, continuous
// 11v11 football. The implementation is split into cohesive modules:
//   match.js      state, clock, periods, config import/export, the step loop
//   player.js     Player: ratings view (skill, awareness), kinematics
//   planning.js   every player's target each planning pass (keeper, carrier,
//                 press/cover, marking shape, attacking support)
//   defence.js    marking points, press/cover bids, mark assignment, lanes
//   decisions.js  the carrier's choice: cross, shoot, carry, pass, feint
//   passing.js    option scoring, lane risk, flight, distribution, passes
//   shooting.js   shot choice/execution, outcomes, on-target projection
//   possession.js taking the ball, first-touch quality, collection reach
//   ball.js       ball flight, saves, blocks, receptions, bounds and goals
//   movement.js   motion, stamina, challenges and duels
//   fouls.js      offside, double touch, fouls and cards
//   restarts.js   set-piece positioning and execution
//   constants.js  pitch size, formats, shared pure helpers
export { Match } from './match.js';
export { Player } from './player.js';
export { W, H, GOAL, LENGTHS, DURATION_PROFILES } from './constants.js';
export { clamp } from '../util/math.js';
export { ATTRS } from '../players/ratings.js';
