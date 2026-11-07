// IFAB Law 12: careless contact is a foul; reckless / excessive force can
// earn yellow / red. Probabilities describe the contact, never a card quota.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function deniesGoalChance(m,offender,victim){
 if(m.ball.owner!==victim.id||m.ball.kind==='held'||m.rel(victim.x,victim.team)<74||Math.abs(victim.y-34)>17)return false;
 const direction=m.direction(victim.team),toward=Math.cos(victim.facing)*direction;
 if(toward<.5&&victim.vx*direction<1)return false;
 const next={x:m.abs(Math.min(101,m.rel(victim.x,victim.team)+7),victim.team),y:victim.y*.65+34*.35};
 return !m.activePlayers.some(p=>p.team===offender.team&&p.id!==offender.id&&p.role!=='GK'&&m.rel(p.x,victim.team)>m.rel(victim.x,victim.team)-2&&p.arrival(next)<victim.arrival(next)+.45);
}
export function cardRisk(m,offender,victim,model,penalty=false){
 const cfg=m.tuning.discipline,aggression=offender.tendency('aggression'),discipline=offender.tendency('discipline');
 const behind=Math.max(0,-model.bearing),pace=clamp(model.closing/9,0,1.5),fatigue=1-offender.energy;
 const compression=clamp((240/m.duration)**.8,.75,1.35);
 const yellow=clamp((.12+behind*.22+pace*.26+aggression*.15+(1-discipline)*.12+fatigue*.07)*compression*cfg.yellowSeverity,0,.95);
 const force=clamp((model.closing-4)/7,0,1.6);
 const red=clamp(.025*force**2*(.55+aggression*.7+behind*.35+(1-discipline)*.3)*compression*cfg.redSeverity,0,.22);
 const dogso=deniesGoalChance(m,offender,victim);
 return {yellow:dogso&&penalty?1:yellow,red:dogso&&!penalty?1:red,dogso};
}
