import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match} from '../dist/engine.js';
import {overallRating,playerTier} from '../dist/ratings.js';
import {BADGES,badgeDescription,badgeEligible} from '../dist/traits.js';

function lane(half=1,team=0){
 const m=new Match(703,300);m.mode='play';m.half=half;
 for(const p of m.players){p.x=m.abs(18,p.team===team?team:1-team);p.y=3+p.slot*5.8;p.vx=p.vy=0;p.tags=[];p.rethinkAt=0;}
 const p=m.players[team*11+9],q=m.players[(1-team)*11+2];
 p.x=m.abs(55,team);p.y=34;p.facing=m.direction(team)>0?0:Math.PI;p.attrs.pace=p.attrs.acceleration=p.attrs.dribbling=80;
 for(const r of m.players.filter(r=>r.team!==team)){r.x=m.abs(18,team);r.y=3+r.slot*5.8;}
 const keeper=m.players[(1-team)*11];keeper.x=m.abs(103,team);keeper.y=34;
 q.x=m.abs(49,team);q.y=34;q.attrs.pace=q.attrs.acceleration=65;
 const outlet=m.players[team*11+6];outlet.x=m.abs(42,team);outlet.y=32;
 m.own(p);p.hold=8;return {m,p,q,outlet};
}

test('a safe forward carry survives the passing timer in both directions and halves',()=>{
 for(const half of [1,2])for(const team of [0,1])for(const tempo of [1,3,5]){
  const {m,p}=lane(half,team);m.setTactic(team,'tempo',tempo);
  assert.ok(m.options(p).length);assert.ok(m.openCarry(p));
  const rng=m.rng;m.decide(p);
  assert.equal(m.ball.owner,p.id);assert.equal(m.stats[team].passes,0);
  assert.ok((p.tx-p.x)*m.direction(team)>4);assert.equal(p.intent,'carry');assert.notEqual(m.rng,rng);
 }
});

test('a genuinely better through ball still beats carrying into open space',()=>{
 const {m,p}=lane(),runner=m.players[8],line=m.players[14];
 runner.x=66;runner.y=32;runner.vx=7;line.x=70;line.y=62;p.attrs.vision=p.attrs.shortPassing=p.attrs.longPassing=95;
 assert.ok(m.openCarry(p));const options=m.options(p);assert.ok(options.some(o=>o.delivery==='through'&&o.chance>.75));
 m.decide(p);assert.equal(m.ball.kind,'pass');assert.equal(m.ball.delivery,'through');assert.equal(m.ball.target,runner.id);
});

test('closing defenders remove the carry preference without disabling safe passes',()=>{
 const {m,p,q,outlet}=lane();q.x=57;q.y=34;outlet.x=48;outlet.y=20;
 assert.equal(m.openCarry(p),null);m.decide(p);assert.equal(m.ball.kind,'pass');
});

test('a presser approaches the goal side instead of running through the carrier',()=>{
 for(const half of [1,2])for(const team of [0,1]){
  const {m,p,q}=lane(half,team);q.x=m.abs(61,team);q.y=34;
  const defence=m.assignDefense(1-team,p);assert.equal(defence.press,q.id);
  assert.ok((defence.point.x-p.x)*m.direction(team)>.5);
 }
});

test('tracking a moving mark does not brake as if their target were stationary',()=>{
 for(const half of [1,2])for(const team of [0,1]){
  const {m,p,q}=lane(half,team),dir=m.direction(team);p.vx=dir*8;p.y=34;q.attrs.pace=q.attrs.acceleration=85;
  const point=m.markingPoint(1-team,p,q);q.x=point.x-dir*.6;q.y=point.y;q.vx=dir*8;q.markId=p.id;
  for(let i=0;i<12;i++){p.x+=dir*8/60;const target=m.markingPoint(1-team,p,q);q.aim(target.x,target.y,'mark','Watching the runner');m.move(q,1/60);}
  assert.ok(q.vx*dir>7.5,JSON.stringify({half,team,speed:q.vx*dir,gap:(q.tx-q.x)*dir}));assert.ok((q.x-p.x)*dir>.5);
 }
});

test('attribute quality slightly widens execution differences while overall stays unchanged',()=>{
 const m=new Match(33),p=m.players[9];p.tags=[];p.attrs.dribbling=85;const overall=overallRating(p),a=m.players[13];
 const values=[];for(const impact of [1,1.08]){m.tuning.gameplay.qualityImpact=impact;p.attrs.dribbling=85;a.attrs.dribbling=55;a.tags=[];values.push(p.skill('dribbling')-a.skill('dribbling'));}
 assert.ok(Math.abs(values[1]/values[0]-1.08)<1e-10);assert.equal(overallRating(p),overall);
 p.attrs.pace=70;assert.equal(p.skill('pace'),70);p.attrs.pace=99;assert.equal(p.skill('pace'),99);
});

test('badge descriptions keep mechanics private, and compiled additions fit their players',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../dist/data/players-fc26.json',import.meta.url)));
 for(const b of BADGES)assert.doesNotMatch(badgeDescription(b),/[+%\d]|attribute|bonus|odds|preference/i,b.label);
 for(const id of ['slalom','pressescape','givego','latearrival','overlap','anchor'])assert.ok(catalog.players.some(p=>p.tags.includes(id)),id);
 for(const p of catalog.players){const tier=playerTier(p);assert.ok(p.tags.length>=tier.minimum&&p.tags.length<=tier.capacity);for(const id of p.tags)assert.ok(badgeEligible(p,BADGES.find(b=>b.id===id)));}
});

test('badges change style and pass-and-move duration independently of attribute bonuses',()=>{
 const {m,p,outlet}=lane();m.tuning.badges.attributeCap=0;
 const base={carry:p.tendency('carry'),hold:p.tendency('hold'),timing:p.tendency('timing'),overlap:p.tendency('overlap')};
 for(const [tag,key,direction] of [['slalom','carry',1],['pressescape','carry',1],['givego','timing',1],['latearrival','timing',1],['overlap','overlap',1],['anchor','hold',1]]){
  p.tags=[tag];assert.ok((p.tendency(key)-base[key])*direction>0,tag);
 }
 const durations=[];for(const tags of [[],['givego']]){p.tags=tags;m.pass(p,{r:outlet,aim:{x:outlet.x,y:outlet.y},d:13,delivery:'pass'});durations.push(p.runs-m.elapsed);}
 assert.ok(durations[1]>durations[0]+.5);
});
