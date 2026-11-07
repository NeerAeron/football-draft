import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../app/engine.js';
import {offsideSnapshot} from '../app/rules.js';
import {footExecution} from '../app/player-model.js';
import {PlaybackClock} from '../app/playback.js';

const setup=()=>{const m=new Match(731,300);m.mode='play';for(const p of m.players){p.x=p.team?75:25;p.y=5+p.slot*5;p.vx=p.vy=0;p.cooldown=0;}return m;};

test('offside uses the kick snapshot, ball and second-last opponent; all restart exemptions are precise',()=>{
 const m=setup(),p=m.players[6],r=m.players[9];p.x=65;r.x=80;m.ball.x=65;m.players[11].x=104;
 assert.ok(offsideSnapshot(m,p).candidates.includes(r.id));
 for(const type of ['Corner','Throw-in','Goal kick'])assert.equal(offsideSnapshot(m,p,type),null);
 assert.ok(offsideSnapshot(m,p,'Free kick').candidates.includes(r.id));
 m.ball.x=83;assert.ok(!offsideSnapshot(m,p).candidates.includes(r.id));m.ball.x=35;r.x=50;assert.ok(!offsideSnapshot(m,p).candidates.includes(r.id));
 r.x=75;assert.ok(!offsideSnapshot(m,p).candidates.includes(r.id));
});

test('offside whistles only on involvement, including an offside receiver running back',()=>{
 const m=setup(),p=m.players[6],r=m.players[9];p.x=65;p.y=34;r.x=83;r.y=34;m.players[11].x=104;
 m.pass(p,{r,aim:r,d:18});assert.equal(m.mode,'play');assert.equal(m.stats[0].offsides,0);
 r.x=72;m.own(r);assert.equal(m.mode,'restart');assert.equal(m.restart.type,'Offside');assert.equal(m.restart.x,72);assert.equal(m.stats[0].offsides,1);assert.equal(m.stats[0].completed,0);
});

test('controlled opposition possession clears offside; a save deflection does not',()=>{
 const m=setup(),p=m.players[6],r=m.players[9],d=m.players[12];p.x=65;r.x=83;m.players[11].x=104;m.ball.x=65;
 m.ball.offsideState=offsideSnapshot(m,p);m.ball.kind='loose';assert.equal(m.checkOffside(r),true);
 m.mode='play';m.ball.x=65;m.ball.offsideState=offsideSnapshot(m,p);m.own(d);assert.equal(m.ball.offsideState,null);assert.equal(m.checkOffside(r),false);
});

test('contact fouls become penalties only in the offender’s own box in either half',()=>{
 for(const half of [1,2])for(const inside of [false,true]){const m=setup();m.half=half;const a=m.players[9],d=m.players[13];a.x=m.abs(inside?94:84,0);a.y=34;m.awardFoul(d,a);assert.equal(m.restart.type,inside?'Penalty':'Free kick');assert.equal(m.stats[0].penalties,inside?1:0);assert.equal(m.stats[1].fouls,1);}
});

test('foul risk responds to contact geometry, defensive skill, discipline and fatigue',()=>{
 const m=setup(),a=m.players[9],d=m.players[13];a.x=60;a.y=34;a.facing=0;m.ball.x=60.6;m.ball.y=34;d.x=61;d.y=34;d.attrs.defending=95;d.energy=1;d.tendencies.discipline=.95;const clean=m.challengeModel(a,d).foul;
 d.x=59.5;d.vx=9;d.attrs.defending=25;d.energy=.35;d.tendencies.discipline=.15;assert.ok(m.challengeModel(a,d).foul>clean*2);
 d.x=80;m.rand=()=>0;assert.equal(m.duel(a,d),false);assert.equal(m.stats[1].fouls,0,'there is no whistle without a contact opportunity');
});

test('penalty setup enforces spot, goal line and encroachment positions',()=>{
 const m=setup();m.startRestart('Penalty',0,94,34,.01);m.stepRestart(.02);const taker=m.restart.taker;
 assert.equal(m.ball.shotType,'Penalty');assert.equal(m.players[taker].x,94);assert.equal(m.players[11].x,105);
 for(const p of m.players)if(p.id!==taker&&p.id!==11){assert.ok(p.x<88.5);assert.ok(p.x<94);assert.ok(Math.hypot(p.x-94,p.y-34)>=9.15);}
});

test('an awarded penalty finishes even if the normal match clock expires',()=>{
 const m=setup();m.half=2;m.periodStart=150;m.elapsed=m.periodDeadline()-.01;m.startRestart('Penalty',0,m.abs(94,0),34,.1);m.step(1/60);assert.equal(m.finished,false);
 let ticks=0;while(!m.finished&&ticks++<600)m.step(1/60);assert.equal(m.finished,true);assert.ok(m.time>=5400);assert.ok(m.events.some(e=>e.type==='shot'&&e.shotType==='Penalty'));assert.ok(m.elapsed>300);
});

test('on-target totals are resolved outcomes, with blocks and woodwork excluded',()=>{
 const m=setup(),p=m.players[9];p.x=94;p.y=34;m.shoot(p);assert.equal(m.stats[0].onTarget,0);m.resolveShot('blocked');assert.equal(m.stats[0].blocked,1);assert.equal(m.stats[0].onTarget,0);
 m.resolveShot('goal');assert.equal(m.stats[0].blocked,0);assert.equal(m.stats[0].onTarget,1);m.resolveShot('goal');assert.equal(m.stats[0].onTarget,1);
 m.shoot(p);m.resolveShot('post');assert.equal(m.stats[0].woodwork,1);assert.equal(m.stats[0].onTarget,1);
});

test('keepers react to goalbound crosses without recording an invented shot or save',()=>{
 const m=setup(),g=m.players[11];g.x=102;g.y=34;m.rand=()=>0;
 Object.assign(m.ball,{x:100,y:34,z:.2,vx:18,vy:0,vz:0,owner:null,kicker:9,target:8,kind:'pass',shotTeam:null,shotRecord:null,lastTouch:0,offsideState:null,age:.8,saver:null,delivery:'cross'});
 m.moveBall(1/60);assert.equal(m.ball.owner,g.id);assert.equal(m.ball.kind,'held');assert.equal(m.stats[1].saves,0);assert.equal(m.stats[0].shots,0);
});

test('knuckleballs and curlers are possible without tags, with tags increasing their weight',()=>{
 const m=setup(),p=m.players[9];p.tags=[];const base=new Map(m.shotWeights(p,25));assert.ok(base.get('Knuckleball')>0);assert.ok(base.get('Curler')>0);
 m.setTags(p.id,['knuckle','curve']);const tagged=new Map(m.shotWeights(p,25));assert.ok(tagged.get('Knuckleball')>base.get('Knuckleball')*5);assert.ok(tagged.get('Curler')>base.get('Curler')*5);
 assert.ok(m.shotWeights(p,10,1.9).some(([type])=>type==='Header'));assert.ok(!m.shotWeights(p,10,0).some(([type])=>type==='Header'));
});

test('foot preference and stable tendencies survive new matches and recorded config',()=>{
 const m=setup(),p=m.players[6];p.foot='left';p.weakFoot=35;p.tendencies.carry=.91;p.facing=0;const weak=footExecution(p,1);const strong=footExecution(p,-1);assert.ok(weak.quality<strong.quality);
 const c=m.exportConfig();m.reset();assert.equal(p.tendencies.carry,.91);const other=new Match(12);other.importConfig(c);assert.equal(other.players[6].foot,'left');assert.equal(other.players[6].weakFoot,35);assert.equal(other.players[6].tendencies.carry,.91);
});

test('sprint reserve drains during a burst and recovers separately from match stamina',()=>{
 const m=setup(),p=m.players[9];p.x=10;p.y=34;p.aim(104,34,'run','Running');for(let i=0;i<360;i++)m.move(p,1/60);const burst=p.sprint,energy=p.energy;assert.ok(burst<.55);assert.ok(energy<1);
 p.vx=p.vy=0;p.aim(p.x,p.y,'hold','Resting');for(let i=0;i<240;i++)m.move(p,1/60);assert.ok(p.sprint>burst+.2);assert.ok(p.energy<=energy);
});

test('a ball winner sheds a stale tackle state and immediately chooses an escape',()=>{
 const m=setup(),p=m.players[13];p.x=60;p.y=34;p.stun=1;p.cooldown=1;p.animation={type:'tackle',duration:3,start:0};p.tx=80;p.ty=60;m.own(p);assert.equal(p.stun,0);assert.equal(p.animation,null);assert.equal(p.intent,'carry');assert.ok(p.think<.2);assert.ok(Math.hypot(p.tx-p.x,p.ty-p.y)>2);
});

test('a second defender and a recent take-on chain lower the chance of beating another player',()=>{
 const sample=(extra,chain)=>{const m=setup(),p=m.players[9],q=m.players[13];p.x=60;p.y=34;q.x=62;q.y=34;for(const r of m.players)if(r.team!==p.team&&r.id!==q.id){r.x=95;r.y=60;}if(extra){m.players[14].x=65;m.players[14].y=35;}p.beatChain=chain?[{id:12,at:0}]:[];m.rand=()=>0;m.feint(p,q);return m.events.find(e=>e.type==='dribble')?.chance;};
 assert.ok(sample(true,false)<sample(false,false));assert.ok(sample(false,true)<sample(false,false));
});

test('an unreceived stopped pass is pursued instead of pinning players to its old destination',()=>{
 const m=setup();Object.assign(m.ball,{x:55,y:34,z:0,vx:0,vy:0,vz:0,owner:null,kicker:6,target:9,kind:'pass',destination:{x:70,y:34},age:5,lastTouch:0});m.moveBall(1/60);m.plan();assert.equal(m.ball.missedReceiver,true);assert.ok(m.players.some(p=>p.intent==='recover'));const r=m.players[9];assert.ok(Math.hypot(r.tx-55,r.ty-34)<1);
});

test('a teammate can secure a bobbled pass without losing completion credit',()=>{
 const m=setup(),p=m.players[6],r=m.players[7];m.pass(p,{r,aim:r,d:12});m.ball.pendingPass={from:p.id,delivery:'pass',chance:.8};m.ball.kind='loose';m.ball.offsideState=null;m.own(r);assert.equal(m.stats[0].completed,1);assert.equal(p.stats.completed,1);
});

test('playback freezes both elapsed frames and partial physics steps on pause',()=>{
 const clock=new PlaybackClock();clock.setPaused(false,0);assert.equal(clock.ticks(clock.frame(25)),1);clock.setPaused(true,26);
 for(let i=1;i<60;i++)assert.equal(clock.frame(26+i*16),0);
 clock.setPaused(false,1000);assert.equal(clock.ticks(clock.frame(1010)),0);assert.equal(clock.ticks(clock.frame(1020)),1);assert.equal(clock.frame(1040,true),0);
});

test('a keeper outside either penalty-area boundary cannot take a shot in their hands',()=>{
 for(const [x,y] of [[80,34],[99,8]]){const m=setup(),g=m.players[11];g.x=x;g.y=y;m.own(g,true);assert.notEqual(m.ball.kind,'held');assert.equal(m.canHandle(g),false);}
});

test('offside does not whistle for an unreachable aerial ball passing overhead',()=>{
 const m=setup(),p=m.players[9];p.x=83;p.y=34;p.attrs.heading=50;Object.assign(m.ball,{x:82.8,y:34,z:2.65,vx:12,vy:0,vz:0,owner:null,kicker:6,kind:'pass',age:1,offsideState:{team:0,candidates:[p.id],line:75},shotRecord:null});m.moveBall(1/60);assert.equal(m.stats[0].offsides,0);assert.equal(m.mode,'play');
});

test('an untouched indirect restart cannot be collected again by its taker',()=>{
 const m=setup(),p=m.players[6],r=m.players[7];m.pass(p,{r,aim:r,d:12},'Offside');m.own(p);assert.equal(m.restart.type,'Indirect free kick');assert.equal(m.restart.team,1);assert.equal(m.ball.owner,null);
});

test('goal-frame rebounds keep an extended penalty alive while moving',()=>{
 const m=setup();m.half=2;m.periodStart=150;m.elapsed=m.periodDeadline()+.2;Object.assign(m.ball,{x:-.02,y:37.66,z:.4,vx:-25,vy:0,vz:0,owner:null,kicker:9,kind:'shot',shotTeam:0,penaltyKick:true,penaltyTaker:9,restartTaker:9,previous:{x:.3,y:37.66,z:.4}});m.checkBounds();assert.equal(m.ball.kind,'loose');assert.equal(m.ball.penaltyKick,true);m.step(1/60);assert.equal(m.finished,false);
});

test('a direct attacking pass that scores is counted once as a successful goal attempt',()=>{
 const m=setup(),p=m.players[6],r=m.players[9];p.x=80;p.y=34;m.pass(p,{r,aim:{x:105,y:34},d:25});m.ball.x=106;m.ball.y=34;m.ball.z=.2;m.checkBounds();assert.equal(m.score[0],1);assert.equal(m.stats[0].shots,1);assert.equal(m.stats[0].onTarget,1);assert.equal(p.stats.goals,1);
});

test('low tempo retains a preference for a safe forward pass when both lanes are open',()=>{
 const m=setup(),p=m.players[6],forward=m.players[8],back=m.players[5];for(const q of m.players){q.x=q.team?98:5;q.y=60;}p.x=45;p.y=34;forward.x=59;forward.y=28;back.x=31;back.y=28;for(const q of [forward,back])q.attrs.control=90;m.setTactic(0,'press',1);m.setTactic(0,'width',2);m.setTactic(0,'tempo',2);const opts=m.options(p),f=opts.find(o=>o.r===forward),b=opts.find(o=>o.r===back);assert.ok(f.score>b.score);
});

test('mark assignments stay unique while following a pass',()=>{
 const m=setup(),a=m.players[9];a.x=60;a.y=34;m.own(a);m.plan();const defence=m.assignDefense(1,a),first=m.assignMarks(1,a,defence);m.elapsed+=.1;const second=m.assignMarks(1,a,defence);assert.equal(new Set([...second.values()].map(p=>p.id)).size,second.size);for(const [id,p] of first)assert.equal(second.get(id)?.id,p.id);
});
