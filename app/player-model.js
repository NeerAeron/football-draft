import {CONFIG} from './config.js';
// Stable preferences describe what a player tries; abilities describe execution.
import {normalizeAttributes} from './ratings.js';
const bound=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export {OVERALL_WEIGHTS,overallRating} from './ratings.js';
export function makeIdentity(role,slot,random,attrs){
  attrs=normalizeAttributes(attrs);
  const back=['LB','RB'].includes(role),forward=['LW','RW','ST'].includes(role);
  const jitter=(base)=>bound(base+(random()-.5)*.24,.12,.88);
  return {foot:slot===1||slot===8?'left':'right',weakFoot:Math.round(42+random()*36),tendencies:{
    advance:jitter(forward?.70:role==='CB'?.42:.57),risk:jitter(forward?.57:.43),
    carry:jitter(['LW','RW'].includes(role)?.69:role==='CB'?.28:.45),
    roam:jitter(role==='CB'?.24:forward?.64:.49),overlap:jitter(back?.51:.30),
    aggression:jitter(role==='CB'||role==='DM'?.62:.43),discipline:jitter(.70),
    timing:jitter(.45+attrs.vision*.003),shoot:jitter(forward?.66:.40),
    hold:jitter(role==='DM'?.65:role==='CB'?.78:.25),inside:jitter(.45+(attrs.shooting-attrs.crossing)*.005),
    aerial:jitter(.4+(attrs.heading+attrs.strength-140)*.006),sweep:jitter(.4+(attrs.acceleration+attrs.vision-120)*.004)
  }};
}
export function preference(p,key){
  const a=p.attrs,recovery=.55*a.pace+.45*a.acceleration,back=p.role==='CB';
  const ability={advance:.55+(recovery-70)*.004+(a.control-70)*.002-(back?.15:0),
    carry:.45+(a.dribbling-a.shortPassing)*.006+(a.control-70)*.002+(a.acceleration-70)*.0015,
    risk:.43+(a.vision-70)*.003+(a.composure-70)*.002,
    shoot:.40+(Math.max(a.shooting,a.longShots)-a.shortPassing)*.004+(a.composure-70)*.001,
    overlap:.45+(a.crossing-a.defending)*.005+(a.stamina-70)*.002+(recovery-70)*.003,
    timing:.45+a.vision*.002+a.awareness*.001,
    roam:.5+(recovery-70)*.003+(a.stamina-70)*.002-(back?.18:0),
    aggression:.5+(a.defending-70)*.002+(a.strength-70)*.002,
    discipline:.65+(a.awareness-70)*.002+(a.composure-70)*.002,
    hold:.45+(a.awareness-a.shooting)*.004-(recovery-70)*.003,
    inside:.45+(a.shooting-a.crossing)*.005+(a.control-70)*.002,
    aerial:.4+(a.heading+a.strength-140)*.006,
    sweep:.4+(a.acceleration+a.vision-120)*.004};
  const sourceWeight=(p.tuning?.ratings||CONFIG.ratings).storedTendencyWeight;let value=sourceWeight*(p.tendencies?.[key]??.5)+(1-sourceWeight)*bound(ability[key]??.5,.05,.95);
  for(const [tag,change] of Object.entries((p.tuning?.badges||CONFIG.badges).tendencies[key]||{}))if(p.tags?.includes(tag))value+=change;
  return bound(value,.05,.95);
}
export function footExecution(p,angle){
  const turn=Math.atan2(Math.sin(angle-p.facing),Math.cos(angle-p.facing));
  // Facing a ball to one's non-dominant side makes an awkward release more likely.
  const side=p.foot==='left'?-1:1,weak=turn*side<-.35;
  return {foot:weak?(p.foot==='left'?'right':'left'):p.foot,weak,
    quality:weak?.66+(p.weakFoot??60)*.0034:1};
}
