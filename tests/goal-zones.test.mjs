import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {goalZone,goalGeometry,GOAL_ZONES,GOAL_REFERENCE} from '../app/goal-zones.js';
import {Match} from '../app/engine.js';

test('goal tiles preserve the real penalty and six-yard landmarks',()=>{
 assert.equal(goalZone(100,34),'six_central');assert.equal(goalZone(97,34),'near_central');assert.equal(goalZone(90,34),'deep_central');assert.equal(goalZone(88.5,34),'deep_central');assert.equal(goalZone(88.49,34),'outside_central');assert.equal(goalZone(93,20),'wide_box');assert.equal(goalZone(93,10),'outside_wide');
 assert.equal(goalZone(100,43.16),'six_central');assert.equal(goalZone(100,43.17),'wide_box');
});

test('central shots have better geometry and empirical priors than side shots',()=>{
 const centre=goalGeometry(93,34),wide=goalGeometry(93,50),far=goalGeometry(78,34);
 assert.ok(centre.angle>wide.angle);assert.ok(centre.openness>wide.openness);assert.ok(centre.rate>wide.rate);assert.ok(centre.quality>wide.quality);assert.ok(centre.rate>far.rate);assert.ok(goalGeometry(102,34).rate>centre.rate);
});

test('six pooled priors reconcile to the attributed source data',()=>{
 const raw=JSON.parse(fs.readFileSync(new URL('../app/data/goal-location-reference.json',import.meta.url))),combined=raw.results.find(r=>r.competition==='Combined');
 assert.equal(Object.values(GOAL_ZONES).reduce((n,z)=>n+z.shots,0),combined.non_penalty_shots);assert.equal(Object.values(GOAL_ZONES).reduce((n,z)=>n+z.goals,0),250);assert.equal(GOAL_REFERENCE.inside,combined.box_goals);assert.equal(GOAL_REFERENCE.central,combined.central_goals);
 assert.equal(combined.non_penalty_goals+combined.penalty_goals_excluded+13,289);
});

test('shot and goal locations survive a change of ends',()=>{
 for(const half of [1,2]){const m=new Match(2);m.half=half;const p=m.players[9];p.x=m.abs(78,0);p.y=34;m.shoot(p);assert.equal(m.ball.shotOrigin.zone,'outside_central');assert.equal(m.ball.shotOrigin.attackX,78);m.mode='play';m.ball.x=m.direction(0)>0?106:-1;m.ball.y=34;m.ball.z=.2;m.checkBounds();assert.equal(m.goalHistory[0].zone,'outside_central');assert.equal(m.stats[0].boxGoals,0);assert.equal(m.stats[0].centralGoals,1);}
});

test('an own-goal origin is measured relative to the goal actually scored in',()=>{
 const m=new Match(1),p=m.players[2],r=m.players[0];p.x=4;p.y=34;m.pass(p,{r,aim:{x:0,y:34},d:4});m.mode='play';m.ball.x=-1;m.ball.y=34;m.ball.z=.2;m.checkBounds();assert.equal(m.goalHistory[0].ownGoal,true);assert.equal(m.goalHistory[0].zone,'six_central');assert.equal(m.stats[1].boxGoals,1);
});
