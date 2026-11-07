import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../app/engine.js';
import {DEFAULT_CONFIG,normalizeConfig,CONFIG_FIELDS} from '../app/config.js';

function switchScene(half=1,team=0){
 const m=new Match(703,300);m.mode='play';m.half=half;m.noise=()=>0;
 for(const q of m.players){q.x=m.abs(q.team===team?7:98,team);q.y=5+q.slot*.1;q.vx=q.vy=0;q.tags=[];}
 const p=m.players[team*11+6],r=m.players[team*11+7],block=m.players[(1-team)*11+5];
 Object.assign(p,{x:m.abs(38,team),y:12,facing:m.direction(team)>0?0:Math.PI});
 Object.assign(p.attrs,{longPassing:85,vision:85,shortPassing:80});
 Object.assign(r,{x:m.abs(58,team),y:55});r.attrs.control=80;
 Object.assign(block,{x:m.abs(48,team),y:33.5});m.own(p);p.hold=1;
 return {m,p,r,block};
}
const aerialTo=(m,p,r)=>m.options(p).find(o=>o.r===r&&o.loft);

test('an unbadged player can switch over a blocked ground lane in either half and direction',()=>{
 for(const half of [1,2])for(const team of [0,1]){
  const {m,p,r}=switchScene(half,team),options=m.options(p).filter(o=>o.r===r),ground=options.find(o=>!o.loft),aerial=options.find(o=>o.loft);
  assert.ok(ground&&aerial);assert.ok(aerial.d>40);assert.ok(aerial.risk<ground.risk);assert.ok(aerial.score>ground.score);
  assert.ok(aerial.margin>ground.margin,'arrival assessment must use the quicker aerial flight');
  m.pass(p,aerial);const flight=m.flightTime(aerial.d,true);
  for(let time=0;time<flight*.5;time+=1/120){m.ball.age+=1/120;m.moveBall(1/120);}
  assert.equal(m.ball.owner,null,'the central blocker cannot collect an overhead switch');assert.ok(m.ball.z>2.3);
  assert.equal(m.effects.length,0,'routine long passes do not add extra flairs');
 }
});

test('wide tactics, direct counters, hidden tendencies and Long Ball badges affect preference',()=>{
 const {m,p,r}=switchScene();
 const score=()=>aerialTo(m,p,r).score;
 m.setTactic(0,'style','possession');m.setTactic(0,'tempo',1);const patient=score();
 m.setTactic(0,'style','counter');m.setTactic(0,'tempo',5);assert.ok(score()>patient+.5);
 m.setTactic(0,'style','balanced');m.setTactic(0,'tempo',3);m.setTactic(0,'width',1);const narrow=score();
 m.setTactic(0,'style','wings');m.setTactic(0,'width',5);assert.ok(score()>narrow+.2);
 p.tendencies.risk=.1;const cautious=score();p.tendencies.risk=.9;assert.ok(score()>cautious);
 m.tuning.badges.attributeCap=0;const plain=score();p.tags=['longball'];assert.ok(score()>plain,'badge changes decisions independently of the attribute boost');
});

test('long-passing quality affects selection and accuracy, with fatigue still affecting execution',()=>{
 const {m,p,r}=switchScene();p.attrs.longPassing=50;const weak=aerialTo(m,p,r);
 p.attrs.longPassing=95;const strong=aerialTo(m,p,r);assert.ok(strong.chance>weak.chance);assert.ok(strong.score>weak.score);
 m.noise=()=>1;const error=(quality,energy)=>{p.attrs.longPassing=quality;p.energy=energy;m.pass(p,strong);return Math.hypot(m.ball.destination.x-strong.aim.x,m.ball.destination.y-strong.aim.y);};
 const low=error(50,1),high=error(95,1);assert.ok(high<low*.5);assert.ok(error(95,.2)>high);
});

test('long lofted through balls lead an onside runner from deeper midfield',()=>{
 for(const half of [1,2])for(const team of [0,1]){
  const {m,p}=switchScene(half,team),r=m.players[team*11+9],line=m.players[(1-team)*11+2],g=m.players[(1-team)*11];
  for(const q of m.players.filter(q=>q.team!==team)){q.x=m.abs(20,team);q.y=64;}
  Object.assign(g,{x:m.abs(103,team),y:34});Object.assign(line,{x:m.abs(78,team),y:10});
  Object.assign(p,{x:m.abs(35,team),y:34});Object.assign(r,{x:m.abs(70,team),y:36,vx:m.direction(team)*5});
  const long=aerialTo(m,p,r);assert.ok(long);assert.equal(long.delivery,'through');assert.ok(long.d>35);assert.ok(m.rel(long.aim.x,team)>m.rel(r.x,team)+7);
  m.pass(p,long);assert.equal(m.ball.offside,false);assert.ok(m.ball.vz>3);
  r.x=m.abs(84,team);const offside=aerialTo(m,p,r);m.pass(p,offside);assert.equal(m.ball.offside,true,'lofted deliveries retain the offside snapshot');
 }
});

function dangerScene(){
 const {m}=switchScene(),p=m.players[2],r=m.players[9];
 for(const q of m.players){q.x=q.team?98:7;q.y=5;q.vx=q.vy=0;}
 Object.assign(p,{x:15,y:34,facing:0});p.attrs.composure=55;
 Object.assign(r,{x:53,y:57});Object.assign(m.players[20],{x:16.2,y:34});Object.assign(m.players[21],{x:16.3,y:35});
 m.own(p);p.hold=1;return {m,p,r};
}

test('a trapped outfield defender clears long, while an available safe outlet avoids the clearance',()=>{
 const {m,p}=dangerScene();assert.equal(m.openCarry(p),null);m.decide(p);
 assert.equal(m.ball.delivery,'clearance');assert.ok(m.ball.vz>3);assert.ok(Math.hypot(m.ball.destination.x-p.x,m.ball.destination.y-p.y)>=28);
 const safe=dangerScene(),outlet=safe.m.players[1];Object.assign(outlet,{x:23,y:15});
 Object.assign(safe.p.attrs,{shortPassing:85,composure:85,vision:85});
 const choices=safe.m.options(safe.p);assert.ok(choices.some(o=>o.r===outlet&&o.chance>.72&&o.margin>0));
 assert.equal(safe.m.outfieldClearance(safe.p,choices),null);
 for(const q of safe.m.players.filter(q=>q.team!==safe.p.team))q.x=98;
 assert.equal(safe.m.outfieldClearance(safe.p,[]),null,'no pressure means no emergency clearance');
});

test('clearance fallback travels into a wide safe area, and its urgency depends on tactics and composure',()=>{
 const {m,p}=dangerScene(),clear=m.outfieldClearance(p,[]);assert.ok(clear);assert.ok(clear.d>28);assert.ok(Math.abs(clear.aim.y-34)>20);assert.ok(clear.aim.x>p.x+30);
 m.setTactic(0,'style','possession');p.attrs.composure=99;m.tuning.gameplay.clearanceWillingness=.5;assert.equal(m.outfieldClearance(p,[]),null);
 m.setTactic(0,'style','bus');p.attrs.composure=40;m.tuning.gameplay.clearanceWillingness=1;assert.ok(m.outfieldClearance(p,[]));
});

test('saved configurations get editable long-ball and clearance tuning without losing custom settings',()=>{
 const saved=structuredClone(DEFAULT_CONFIG);delete saved.gameplay.longBallPreference;delete saved.gameplay.clearanceWillingness;saved.gameplay.passSpeed=1.15;
 const config=normalizeConfig(saved);assert.equal(config.gameplay.longBallPreference,DEFAULT_CONFIG.gameplay.longBallPreference);assert.equal(config.gameplay.clearanceWillingness,DEFAULT_CONFIG.gameplay.clearanceWillingness);assert.equal(config.gameplay.passSpeed,1.15);
 for(const key of ['longBallPreference','clearanceWillingness'])assert.ok(CONFIG_FIELDS.some(f=>f.path==='gameplay.'+key));
});
