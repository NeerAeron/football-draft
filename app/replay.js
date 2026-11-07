import {Match,Player,clamp} from './engine.js';
import {normalizeAttributes} from './ratings.js';
export const RECORD_STEP=3; // 20 stored frames/s; interpolate display, retain 60 Hz physics.
export function snapshot(m){
  const positions=new Float32Array(22*9);
  m.players.forEach((p,i)=>positions.set([p.x,p.y,p.vx,p.vy,p.tx,p.ty,p.facing,p.energy,p.lastShotSpeed||0],i*9));
  return {elapsed:m.elapsed,time:m.time,half:m.half,periodStart:m.periodStart,addedMinutes:[...m.addedMinutes],score:[...m.score],stats:m.stats.map(s=>({...s})),positions,
    states:m.players.map(p=>({action:p.action,intent:p.intent,possessionAt:p.possessionAt,animation:p.animation?{...p.animation}:null,lastShotChance:p.lastShotChance,lastShotType:p.lastShotType,yellowCards:p.yellowCards,sentOff:p.sentOff,emergencyKeeper:p.emergencyKeeper,role:p.role,slot:p.slot})),
    abandonedTeam:m.abandonedTeam,ball:{...m.ball},effects:m.effects.map(e=>({...e})),mode:m.mode,phase:m.phase,restart:{...m.restart}};
}
export function selectHighlights(events,duration,budget=60){
  budget=Math.min(budget,duration);
  const goals=events.filter(e=>e.type==='goal').sort((a,b)=>a.elapsed-b.elapsed);
  const merge=list=>{const out=[];for(const c of list.sort((a,b)=>a.start-b.start)){const last=out.at(-1);if(last&&c.start<=last.end+.015)last.end=Math.max(last.end,c.end);else out.push({...c});}return out;};
  const total=list=>list.reduce((s,c)=>s+c.end-c.start,0);
  const perGoal=Math.min(8,budget/Math.max(1,goals.length));
  let clips=merge(goals.map(e=>({start:clamp(e.elapsed-perGoal*.67,0,duration-perGoal),end:clamp(e.elapsed-perGoal*.67,0,duration-perGoal)+perGoal})));
  const priorities={red:8,yellow:2,penalty:7,post:6,shot:6,save:5,dribble:3,tackle:3,cross:4,cutback:4,through:4,block:4};
  const candidates=events.filter(e=>priorities[e.type]).sort((a,b)=>(priorities[b.type]+(b.strength||0)*1.5)-(priorities[a.type]+(a.strength||0)*1.5)||a.elapsed-b.elapsed);
  for(const e of candidates){const remaining=budget-total(clips);if(remaining<.05)break;if(clips.some(c=>e.elapsed>=c.start&&e.elapsed<=c.end))continue;
    const length=Math.min(6,remaining),start=clamp(e.elapsed-length*.72,0,duration-length),candidate={start,end:start+length};
    const merged=merge([...clips,candidate]);if(total(merged)<=budget+.001)clips=merged;
  }
  // Fill short reports with actual buildup, never invented action or accelerated motion.
  const gaps=[];let edge=0;for(const c of clips){if(c.start>edge)gaps.push({start:edge,end:c.start});edge=c.end;}if(edge<duration)gaps.push({start:edge,end:duration});
  for(const gap of gaps){const remaining=budget-total(clips);if(remaining<.001)break;const length=Math.min(remaining,gap.end-gap.start);clips=merge([...clips,{start:gap.end-length,end:gap.end}]);}
  let offset=0;return clips.map(c=>{const clip={...c,offset};offset+=c.end-c.start;return clip;});
}
export async function simulateComplete(config,seed,record=false,onProgress=()=>{},cancelled=()=>false){
  const m=new Match(seed,300);m.importConfig(config);const frames=record?[snapshot(m)]:[];let ticks=0;
  while(!m.finished){
    for(let i=0;i<600&&!m.finished;i++){const before=m.mode;m.step(1/60);ticks++;if(record&&(ticks%RECORD_STEP===0||before!==m.mode&&m.mode==='halftime'))frames.push(snapshot(m));}
    if(cancelled())return null;onProgress(clamp(m.elapsed/m.expectedDuration(),0,1));await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(record&&frames.at(-1)?.elapsed!==m.elapsed)frames.push(snapshot(m));
  return {result:m,frames,clips:record?selectHighlights(m.events,m.elapsed,60):[]};
}
export async function simulateHalf(source,onProgress=()=>{},cancelled=()=>false){
  // Keep the authoritative simulation separate from the display snapshots.
  const m=Object.assign(Object.create(Match.prototype),structuredClone(source));
  m.players=m.players.map(p=>Object.assign(Object.create(Player.prototype),p,{attrs:normalizeAttributes(p.attrs)}));
  m.rebuildActive();
  m.pauseAtHalf=true;if(m.mode==='halftime')m.resumeHalf();
  const start=m.elapsed,half=m.half,frames=[snapshot(m)];let ticks=0;
  while(!m.finished&&m.mode!=='halftime'){
    for(let i=0;i<600&&!m.finished&&m.mode!=='halftime';i++){m.step(1/60);ticks++;if(ticks%RECORD_STEP===0)frames.push(snapshot(m));}
    if(cancelled())return null;onProgress(clamp((m.elapsed-start)/(m.periodDeadline()-start),0,1));await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(frames.at(-1).elapsed!==m.elapsed)frames.push(snapshot(m));
  const events=m.events.filter(e=>e.half===half).map(e=>({...e,elapsed:e.elapsed-start}));
  const clips=selectHighlights(events,m.elapsed-start,30).map(c=>({...c,start:c.start+start,end:c.end+start}));
  return {result:m,frames,clips,viewDuration:30,viewOffset:(half-1)*30};
}
function frameIndex(frames,time){let lo=0,hi=frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].elapsed<=time+1e-8)lo=mid;else hi=mid-1;}return lo;}
export function applyReplayFrame(target,recording,viewTime){
  const clip=recording.clips.find(c=>viewTime<c.offset+c.end-c.start)||recording.clips.at(-1);
  const sourceTime=clamp(clip.start+viewTime-clip.offset,clip.start,clip.end),index=frameIndex(recording.frames,sourceTime),a=recording.frames[index],b=recording.frames[Math.min(index+1,recording.frames.length-1)],mix=clamp((sourceTime-a.elapsed)/(b.elapsed-a.elapsed||.05),0,1);
  const aTime=a.time??a.elapsed/target.duration*5400,bTime=b.time??b.elapsed/target.duration*5400;
  target.elapsed=sourceTime;target.time=aTime+(a.half===b.half?(bTime-aTime)*mix:0);target.half=a.half;target.periodStart=a.periodStart??0;if(a.addedMinutes)target.addedMinutes=[...a.addedMinutes];target.score=[...a.score];target.stats=a.stats.map(s=>({...s}));target.ball={...a.ball};target.effects=a.effects.map(e=>({...e}));target.mode=a.mode;target.abandonedTeam=a.abandonedTeam??null;target.phase=a.phase;target.restart=a.restart;
  target.players.forEach((p,i)=>{const j=i*9,teleport=Math.hypot(a.positions[j]-b.positions[j],a.positions[j+1]-b.positions[j+1])>4;['x','y','vx','vy','tx','ty','facing','energy','lastShotSpeed'].forEach((key,k)=>{const delta=b.positions[j+k]-a.positions[j+k];p[key]=a.positions[j+k]+(k===6?Math.atan2(Math.sin(delta),Math.cos(delta)):delta)*(teleport?0:mix);});Object.assign(p,a.states[i]);});
  target.rebuildActive();
  if(a.ball.kind===b.ball.kind&&Math.hypot(a.ball.x-b.ball.x,a.ball.y-b.ball.y)<6){for(const key of ['x','y','z'])target.ball[key]=a.ball[key]+(b.ball[key]-a.ball[key])*mix;}
  target.events=recording.result.events.filter(e=>e.elapsed<=sourceTime).map(e=>e.resolvedAt>sourceTime?{...e,outcome:'in flight'}:e);target.ballTrail=[];
  for(let n=Math.max(0,index-7);n<=index;n++){const ball=recording.frames[n].ball;target.ballTrail.push({x:ball.x,y:ball.y,z:ball.z,kind:ball.kind,age:ball.age});}
  return recording.clips.indexOf(clip)+1;
}
export function performanceRating(p,m){
  const s=p.stats,op=m.score[1-p.team],contribution=s.goals*1.12+s.assists*.72+s.keyPasses*.14+s.takeons*.075+s.tackles*.13+s.interceptions*.055+s.blocks*.1+s.saves*.22;
  const mistakes=s.turnovers*.055+s.fouls*.055+(s.passes-s.completed)*.012+(s.yellowCards||0)*.12+(s.redCards||0)*.8;
  const clean=p.role==='GK'||p.role==='CB'?op===0?.55:-op*.09:0;
  return clamp(6+contribution+clean+Math.min(.35,s.completed*.009)-mistakes,3,10);
}
