// Fixed real-club XIs. Observation only; never loaded by the game.
// node tests/quality-gap-calibration.mjs /tmp/quality-gap.json (30 fixtures)
// CALIBRATION_ENGINE=file:///absolute/path/engine.js compares a frozen engine.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {Match}=await import(process.env.CALIBRATION_ENGINE||new URL('../dist/engine.js',import.meta.url));
const catalog=JSON.parse(readFileSync(new URL('../dist/data/players-runtime.json',import.meta.url))).players;
const byId=new Map(catalog.map(p=>[p.profileId,p]));
const cases=JSON.parse(readFileSync(process.env.CALIBRATION_FIXTURES||new URL('./fixtures/quality-gap-squads.json',import.meta.url))).slice(0,Number(process.env.CASE_LIMIT)||Infinity);
const rows=[];
for(const c of cases){
 const m=new Match(c.seed,c.duration);
 m.importConfig({teams:c.configTeams,players:c.profiles.map(id=>{assert.ok(byId.has(id),id);return byId.get(id);})});
 const controlled=[0,0];let frames=0;
 while(!m.finished&&frames++<40000){
  const owner=m.ball.owner,team=owner==null?null:m.players[owner].team,before=team==null?0:m.stats[team].possession;
  m.step(1/60);if(team!=null)controlled[team]+=m.stats[team].possession-before;
 }
 assert.ok(m.finished);
 const total=m.stats.reduce((sum,s)=>sum+s.possession,0),controlledTotal=controlled[0]+controlled[1];
 const row={id:c.id,group:c.group,seed:c.seed,duration:c.duration,strongTeam:c.strongTeam,weakTeam:c.weakTeam,teams:m.stats.map((s,t)=>({
  ...c.teams[t],team:t,goals:m.score[t],shots:s.shots,offTarget:s.offTarget,
  passes:s.passes,completed:s.completed,passAccuracy:100*s.completed/s.passes,
  possessionSeconds:s.possession,possessionShare:total?100*s.possession/total:50,
  controlledPossessionSeconds:controlled[t],controlledPossessionShare:controlledTotal?100*controlled[t]/controlledTotal:50,
  miscontrols:s.miscontrols,forwardPasses:s.forwardPasses,backwardPasses:s.backwardPasses,throughBalls:s.throughBalls,crosses:s.crosses
 }))};
 rows.push(row);writeFileSync(process.argv[2],JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(row));
}
