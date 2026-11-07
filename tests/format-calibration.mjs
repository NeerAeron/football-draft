// Descriptive neutral-squad sample, not a scoring quota or automated pass/fail gate.
// node tests/format-calibration.mjs [matchesPerFormat=16] [firstSeed=42501] [output] [duration]
import {readFileSync,writeFileSync} from 'node:fs';
import {Match,DURATION_PROFILES} from '../dist/engine.js';
import {randomLineups} from '../dist/lineups.js';
const count=Number(process.argv[2]||16),firstSeed=Number(process.argv[3]||42501),output=process.argv[4]||'tests/format-calibration-results.json';
const catalog=JSON.parse(readFileSync(new URL('../dist/data/players-fc26.json',import.meta.url)));
const mean=a=>a.reduce((s,n)=>s+n,0)/a.length,of=a=>a.filter((_,i)=>i%11);
const results=[],doc={description:'Random position-matched squads from 1100 profiles; balanced style, all tactics3, 60Hz. Outcomes emerge from play; finite sample, not quotas.',profiles:DURATION_PROFILES,results};
for(const duration of (process.argv[5]?[Number(process.argv[5])]:[300,180])){
 const samples=[];
 for(let seed=firstSeed;seed<firstSeed+count;seed++){
  const m=new Match(seed,duration),config=m.exportConfig();config.players=randomLineups(m.players,catalog.players,seed);m.importConfig(config);
  while(!m.finished)m.step(1/60);
  samples.push({seed,rosterIds:m.players.map(p=>p.sourcePlayerId),score:m.score,total:m.score[0]+m.score[1],stats:m.stats,addedMinutes:m.addedMinutes,elapsed:m.elapsed,halfBefore:mean(of(m.halftime.energyBefore)),halfAfter:mean(of(m.halftime.energyAfter)),fulltimeOutfield:mean(of(m.players.map(p=>p.energy))),finalEnergy:m.players.map(p=>p.energy)});
 }
 const sum=k=>samples.reduce((s,m)=>s+m.stats.reduce((s,t)=>s+t[k],0),0),goals=samples.reduce((s,m)=>s+m.total,0);
 const summary={duration,matches:count,meanGoals:goals/count,meanShots:sum('shots')/count,onTargetShare:sum('onTarget')/sum('shots'),meanOffTarget:sum('offTarget')/count,boxGoalShare:sum('boxGoals')/goals,passCompletion:sum('completed')/sum('passes'),halfBefore:mean(samples.map(s=>s.halfBefore)),halfAfter:mean(samples.map(s=>s.halfAfter)),fulltimeOutfield:mean(samples.map(s=>s.fulltimeOutfield))};
 results.push({summary,samples});writeFileSync(output,JSON.stringify(doc,null,2)+'\n');console.log(summary);
}
