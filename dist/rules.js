// Laws are geometric. No event counters, score correction or target-rate quotas.
export const OFFSIDE_EXEMPT=new Set(['Corner','Throw-in','Goal kick']);
export function offsideSnapshot(match,kicker,restart=null){
  if(OFFSIDE_EXEMPT.has(restart))return null;
  const opponents=(match.activePlayers||match.players).filter(q=>q.team!==kicker.team).map(q=>match.rel(q.x,kicker.team)).sort((a,b)=>b-a);
  const line=Math.max(52.5,match.rel(match.ball.x,kicker.team),opponents[1]??105);
  return {team:kicker.team,line,at:match.elapsed,kicker:kicker.id,candidates:(match.activePlayers||match.players)
    .filter(q=>q.team===kicker.team&&q.id!==kicker.id&&match.rel(q.x,kicker.team)>line+.02)
    .map(q=>q.id)};
}
export function offenceInBox(match,offender,point){
  return match.rel(point.x,offender.team)<=16.5&&Math.abs(point.y-34)<=20.16;
}
export function normalCDF(x){const t=1/(1+.2316419*Math.abs(x)),density=.3989422804*Math.exp(-x*x/2);const tail=density*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x<0?tail:1-tail;}
export function targetChance(aim,spread,heightChance=1){return Math.max(.01,Math.min(.99,(normalCDF((37.66-aim)/spread)-normalCDF((30.34-aim)/spread))*heightChance));}
