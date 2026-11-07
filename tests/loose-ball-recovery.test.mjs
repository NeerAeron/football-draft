import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../app/engine.js';

function scene(){
 const m=new Match(921,180);m.mode='play';m.elapsed=10;m.rand=()=>0;
 for(const p of m.players){Object.assign(p,{x:p.team?98:5,y:5,vx:0,vy:0,cooldown:0,stun:0});}
 const p=m.players[6];Object.assign(p,{x:45,y:34});
 Object.assign(m.ball,{x:45.5,y:34,z:0,vx:0,vy:0,vz:0,kind:'loose',owner:null,target:null,kicker:p.id,age:.05,lastTouch:p.team});
 return {m,p};
}

test('a reachable loose ball can be taken during an action cooldown under approaching pressure',()=>{
 const {m,p}=scene();p.cooldown=.8;Object.assign(m.players[18],{x:48,y:34,vx:-4});
 assert.ok(m.pressure(p)>0);m.moveBall(1/60);assert.equal(m.ball.owner,p.id);
 assert.ok(p.think<.2);assert.equal(p.intent,'carry');
});

test('loose-ball recovery replaces a stale instruction immediately',()=>{
 const {m,p}=scene();p.aim(80,62,'run','Running');p.rethinkAt=50;m.plan();
 assert.equal(p.intent,'recover');assert.ok(Math.hypot(p.tx-m.ball.x,p.ty-m.ball.y)<1);
});

test('a teammate pursues the ball if the closest player is still stunned',()=>{
 const {m,p}=scene(),q=m.players[7];p.stun=2;Object.assign(q,{x:47,y:34,rethinkAt:50});m.plan();
 assert.equal(q.intent,'recover');assert.equal(m.canCollect(p),false);
});

test('a genuine poor touch has a brief recovery window, but a settled ball is not left waiting',()=>{
 const {m,p}=scene();p.controlErrorAt=10;p.controlUntil=10.55;p.cooldown=.55;
 assert.equal(m.canCollect(p),false);m.elapsed=10.14;assert.equal(m.canCollect(p),true);
 m.ball.vx=8;assert.equal(m.canCollect(p),false,'a moving miscontrol remains contestable');
 m.elapsed=10.56;assert.equal(m.canCollect(p),true);
});

test('collecting a loose restart ball still enforces the second-touch law',()=>{
 const {m,p}=scene();m.ball.restartTaker=p.id;m.ball.indirect=p.id;m.moveBall(1/60);
 assert.equal(m.mode,'restart');assert.equal(m.restart.type,'Indirect free kick');assert.equal(m.restart.team,1-p.team);
});

test('an intended receiver takes a pass at his feet during an unrelated action cooldown',()=>{
 const {m,p}=scene();p.cooldown=.8;Object.assign(m.players[18],{x:48,y:34,vx:-4});
 Object.assign(m.ball,{x:44.6,y:34,vx:10,kind:'pass',kicker:7,target:p.id,age:.7,destination:{x:46,y:34}});
 assert.ok(m.canCollect(p));m.moveBall(1/60);assert.equal(m.ball.owner,p.id);assert.equal(m.stats[0].completed,1);
});

test('the reception exemption preserves a real stumble, poor-touch recovery and kicker lockout',()=>{
 const {m,p}=scene();Object.assign(m.ball,{kind:'pass',kicker:7,target:p.id,age:.2});p.cooldown=.8;
 p.stun=.2;assert.equal(m.canCollect(p),false);p.stun=0;p.controlUntil=m.elapsed+.3;assert.equal(m.canCollect(p),false);
 p.controlUntil=0;m.ball.kicker=p.id;assert.equal(m.canCollect(p),false);
});

test('pressure does not make a settled ball at the feet repeatedly bobble',()=>{
 const {m,p}=scene();p.attrs.control=60;p.energy=.3;m.rand=()=>.94;Object.assign(m.players[18],{x:46.3,y:34});
 assert.ok(m.pressure(p)>.65);m.moveBall(1/60);assert.equal(m.ball.owner,p.id);assert.equal(p.stats.miscontrols,0);
});

test('a keeper meets an incoming backpass instead of retreating toward goal under pressure',()=>{
 const {m}=scene(),p=m.players[0];Object.assign(p,{x:8,y:23,rethinkAt:100});Object.assign(m.players[18],{x:15.5,y:23});
 Object.assign(m.ball,{x:15,y:23,z:0,vx:-12,vy:0,kind:'pass',target:p.id,kicker:2,lastTouch:0,destination:{x:8,y:23},age:.5});
 m.plan();assert.equal(p.intent,'receive');assert.equal(p.ty,23);assert.ok(p.tx>=8);
 Object.assign(m.ball,{x:8.2,y:23});m.moveBall(1/60);assert.equal(m.ball.owner,p.id);assert.equal(m.ball.kind,'dribble','a deliberate teammate backpass is not handled');
});

test('a failed touch resolves only one contact before rebuilding the flight candidates',()=>{
 const {m,p}=scene();Object.assign(m.players[18],{x:45.7,y:34});m.rand=()=>.999999;
 Object.assign(m.ball,{x:44.7,y:34,z:0,vx:16,vy:0,kind:'pass',target:p.id,kicker:7,lastTouch:0,age:.7});
 m.moveBall(1/60);assert.equal(p.stats.miscontrols,1);assert.equal(m.players[18].stats.miscontrols,0);assert.equal(m.players.reduce((n,q)=>n+q.stats.miscontrols,0),1);
});

test('a keeper recovers a bobbled backpass with feet rather than gaining permission to handle it',()=>{
 const {m}=scene(),p=m.players[0];Object.assign(p,{x:8,y:34});
 Object.assign(m.ball,{kind:'pass',kicker:2,target:p.id,x:8.1,y:34,age:.7});m.rand=()=>.999999;m.moveBall(1/60);
 assert.equal(m.ball.kind,'loose');assert.ok(m.ball.pendingPass);m.elapsed+=.15;m.rand=()=>0;m.moveBall(1/60);
 assert.equal(m.ball.owner,p.id);assert.equal(m.ball.kind,'dribble');
});
