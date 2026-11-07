import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match} from '../app/engine.js';
import {randomLineups,playerInitials} from '../app/lineups.js';
import {positionFamiliarity} from '../app/ratings.js';
import {simulateComplete} from '../app/replay.js';
const pool=JSON.parse(readFileSync(new URL('../app/data/players-fc26.json',import.meta.url))).players;
const ids=players=>players.map(p=>p.profileId);

test('every formation pairing draws 22 distinct players in natural positions, with one GK per side',()=>{
 for(const home of ['433','442','4231'])for(const away of ['433','442','4231'])for(let seed=1;seed<=8;seed++){
  const m=new Match(seed);m.setTactic(0,'formation',home);m.setTactic(1,'formation',away);
  const draw=randomLineups(m.players,pool,seed);assert.equal(draw.length,22);assert.equal(new Set(ids(draw)).size,22);
  for(let i=0;i<22;i++){assert.ok(positionFamiliarity(draw[i],m.players[i].role)>=.99);assert.equal(draw[i].primaryPosition==='GK',i%11===0);}
 }
});
test('assignment maximizes proficiency globally, including conflicts between flexible players',()=>{
 const slots=['CM','CB','LB','DM'].map(role=>({role})),profiles=[
  {profileId:'a',primaryPosition:'CM',secondaryPositions:['CB']},
  {profileId:'b',primaryPosition:'CM',secondaryPositions:[]},
  {profileId:'c',primaryPosition:'LB',secondaryPositions:['DM']},
  {profileId:'d',primaryPosition:'DM',secondaryPositions:['LB']},
  {profileId:'e',primaryPosition:'ST',secondaryPositions:[]}
 ];
 const best=(remaining,index=0)=>index===slots.length?0:Math.max(...remaining.map((p,i)=>positionFamiliarity(p,slots[index].role)+best(remaining.filter((_,j)=>j!==i),index+1)));
 const optimum=best(profiles);
 for(let seed=0;seed<12;seed++){const draw=randomLineups(slots,profiles,seed);assert.ok(Math.abs(draw.reduce((s,p,i)=>s+positionFamiliarity(p,slots[i].role),0)-optimum)<1e-10);assert.equal(draw[1].profileId,'a');assert.equal(draw[0].profileId,'b');}
});
test('draws vary with the seed, replay exactly, and cannot mutate catalog ratings',()=>{
 const m=new Match(44),a=randomLineups(m.players,pool,44),b=randomLineups(m.players,pool,45);
 assert.deepEqual(a,randomLineups(m.players,pool,44));assert.notDeepEqual(ids(a),ids(b));
 const original=pool.find(p=>p.profileId===a[0].profileId),rating=original.attrs.goalkeeping;a[0].attrs.goalkeeping=1;assert.equal(original.attrs.goalkeeping,rating);
 assert.throws(()=>randomLineups(m.players,pool.slice(0,21),1),/distinct/);
 assert.throws(()=>randomLineups(m.players,pool.filter(p=>p.primaryPosition!=='GK'),1),/goalkeeper/);
});
test('a randomly selected real-player match preserves profiles and tactics through a full instant result',async()=>{
 const m=new Match(345,300);m.setTactic(0,'formation','442');m.setTactic(0,'fluidity',5);const c=m.exportConfig();c.players=randomLineups(m.players,pool,345);m.importConfig(c);
 const before=ids(m.players),result=await simulateComplete(m.exportConfig(),345,false);
 assert.deepEqual(ids(result.result.players),before);assert.equal(result.result.teams[0].tactics.fluidity,5);assert.ok(result.result.finished);
 assert.ok(result.result.players.every(p=>Number.isFinite(p.energy)&&p.primaryPosition));
});
test('initials handle abbreviated, accented, hyphenated and single-word player names',()=>{
 for(const [name,expected] of [['K. Mbappé','KM'],['M. ter Stegen','MTS'],['T. Alexander-Arnold','TAA'],['H. Çalhanoğlu','HÇ'],['Rodri','R'],['David Raya','DR'],['','?']])assert.equal(playerInitials({name}),expected);
});
