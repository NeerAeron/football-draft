import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Draft} from '../app/draft.js';
import {FORMATIONS} from '../app/formations.js';
import {overallRating,POSITIONS} from '../app/ratings.js';
import {rankPlayers,squadOrder,miniPitch,renderSquadList,showPlayerCard} from '../app/squad-ui.js';

const catalog=JSON.parse(readFileSync(new URL('../app/data/players-runtime.json',import.meta.url)));
function draw(){
 const d=new Draft(catalog,{seed:27});d.weighted=options=>options.find(o=>o.id==='13'||o.name==='Liverpool')||options[0];
 d.spinLeague();d.spinTeam();return d;
}
test('base rankings ignore all remaining positions, used players and budgets',()=>{
 const d=draw(),pool=d.visible(),before=rankPlayers(pool).map(p=>p.profileId),top=rankPlayers(pool)[0];
 assert.ok(pool.some(p=>p.primaryPosition==='GK'));
 d.used.add(top.profileId);
 // Only GK remains: every outfielder is still browsable, with a clear reason.
 FORMATIONS[d.formations[d.turn]].forEach((row,i)=>{if(row[2]!=='GK')d.picks[d.turn][i]=pool.find(p=>p.primaryPosition!=='GK');});
 assert.deepEqual(rankPlayers(d.visible()).map(p=>p.profileId),before);
 assert.equal(d.placement(top).reason,'Already drafted');
 assert.ok(d.available().every(p=>p.primaryPosition==='GK'));
 const outfield=pool.find(p=>p.primaryPosition!=='GK'&&p!==top);
 assert.equal(d.placement(outfield).reason,'Outfield slots filled');
 d.recordShown([top.profileId]);assert.equal(d.revealSpins[d.turn][d.budgetGroup(top)]?.size||0,0);
});
test('every position sorts the entire pool by its adjusted overall without removing anyone',()=>{
 const pool=draw().visible(),ids=pool.map(p=>p.profileId).sort();
 for(const role of ['',...POSITIONS]){
  const ranked=rankPlayers(pool,role);
  assert.deepEqual(ranked.map(p=>p.profileId).sort(),ids,role);
  for(let i=1;i<ranked.length;i++)assert.ok(overallRating(ranked[i-1],false,role||ranked[i-1].primaryPosition)>=overallRating(ranked[i],false,role||ranked[i].primaryPosition));
 }
});
test('automatic placement uses the highest-rated legal open slot, even after browsing other rankings',()=>{
 for(const formation of Object.keys(FORMATIONS)){
  const d=draw();d.formations[d.turn]=formation;
  for(const p of d.visible()){
   for(const role of ['CB','ST','GK'])rankPlayers(d.visible(),role);
   const choice=d.placement(p),rows=FORMATIONS[formation],best=Math.max(...rows.filter(row=>(row[2]==='GK')===(p.primaryPosition==='GK')).map(row=>overallRating(p,false,row[2])));
   assert.ok(choice.available);assert.equal(overallRating(p,false,choice.role),best);
  }
 }
});
test('an explicit circle uses its exact slot, including the second of two CBs',()=>{
 const d=draw(),p=d.available().find(p=>p.primaryPosition==='CB'),team=d.turn;
 assert.equal(d.bestSlot(p),2);
 const explicit=d.placement(p,3);assert.equal(explicit.slot,3);assert.equal(explicit.role,'CB');assert.ok(explicit.available);
 assert.ok(d.pick(explicit.slot,p.profileId));assert.equal(d.picks[team][3].profileId,p.profileId);assert.equal(d.picks[team][2],null);
});
test('explicit placement cannot bypass GK, occupied slot, duplicate or draw restrictions',()=>{
 const d=draw(),field=d.available().find(p=>p.primaryPosition!=='GK'),keeper=d.available().find(p=>p.primaryPosition==='GK');
 assert.equal(d.placement(field,0).available,false);assert.equal(d.pick(0,field.profileId),false);
 assert.equal(d.placement(keeper,9).available,false);assert.equal(d.pick(9,keeper.profileId),false);
 d.picks[d.turn][9]=structuredClone(field);assert.equal(d.placement(field,9).reason,'Position filled');
 const outside=catalog.players.find(p=>!d.visible().some(q=>q.profileId===p.profileId));assert.equal(d.pick(1,outside.profileId),false);
 d.used.add(field.profileId);assert.equal(d.placement(field).reason,'Already drafted');
});
test('squad lists use assigned-position ratings and preserve each slot identity',()=>{
 const rows=FORMATIONS['433'],players=Array(11).fill(null),pool=catalog.players;
 players[2]=pool.find(p=>p.name==='K. Mbappé')||pool.find(p=>p.primaryPosition==='ST');
 players[9]=pool.find(p=>p.primaryPosition==='CB');players[6]=pool.find(p=>p.primaryPosition==='CM');
 const list=squadOrder(rows,players);
 assert.equal(list.length,3);assert.deepEqual(list.map(p=>p.slot).sort((a,b)=>a-b),[2,6,9]);
 for(const item of list)assert.equal(item.overall,overallRating(item.player,false,rows[item.slot][2]));
 for(let i=1;i<list.length;i++)assert.ok(list[i-1].overall>=list[i].overall);
});

function dom(t){
 class Element{
  constructor(){this.children=[];this.dataset={};this.attributes={};this.style={setProperty(k,v){this[k]=v;}};const set=new Set();this.classList={add:k=>set.add(k),toggle:(k,on)=>on?set.add(k):set.delete(k)};}
  replaceChildren(){this.children=[];}append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes[k]=v;}showModal(){this.open=true;}close(){this.open=false;}
 }
 const prior=globalThis.document,nodes=Object.fromEntries(['squad-player-dialog','squad-player-card','squad-player-close'].map(id=>['#'+id,new Element()]));
 globalThis.document={createElement:()=>new Element(),querySelector:s=>nodes[s]};t.after(()=>{globalThis.document=prior;});return {Element,nodes};
}
test('every circle invokes its own slot; filled opponents stay inspectable',t=>{
 const {Element}=dom(t),pitch=new Element(),players=Array(11).fill(null),p=catalog.players[0];players[3]=p;let clicked;
 miniPitch(pitch,FORMATIONS['433'],players,{slotDisabled:(_,p)=>!p,onSelect:(slot,p)=>{clicked={slot,p};}});
 assert.equal(pitch.children.length,11);assert.equal(pitch.children[2].disabled,true);assert.equal(pitch.children[3].disabled,false);
 pitch.children[3].onclick();assert.deepEqual(clicked,{slot:3,p});
 miniPitch(pitch,FORMATIONS['5212'],[],{onSelect:slot=>{clicked=slot;}});
 for(const [slot,button] of pitch.children.entries()){button.onclick();assert.equal(clicked,slot);assert.ok(parseFloat(button.style.left)>0&&parseFloat(button.style.left)<100);assert.ok(parseFloat(button.style.top)>0&&parseFloat(button.style.top)<100);}
});
test('squad rows show six categories and open the selected full card without revealing hidden tendencies',t=>{
 const {Element,nodes}=dom(t),rows=FORMATIONS['433'],players=Array(11).fill(null),p=catalog.players.find(p=>p.primaryPosition==='CM');players[6]=p;
 const container=new Element();renderSquadList(container,rows,players);
 const row=container.children[1].children[0];for(const stat of ['PAC','DRI','SHO','DEF','PAS','PHY'])assert.ok(row.innerHTML.includes(stat));
 row.onclick();assert.ok(nodes['#squad-player-dialog'].open);const html=nodes['#squad-player-card'].innerHTML;
 assert.ok(html.includes(p.name));assert.ok(html.includes('Expand ratings'));assert.ok(html.includes('Acceleration'));assert.ok(html.includes('Short passes'));assert.ok(html.includes('Dominant foot'));
 assert.ok(!html.includes('tendencies'));assert.ok(!html.includes('durability'));assert.ok(!html.includes('sourceOverall'));
 nodes['#squad-player-close'].onclick();assert.equal(nodes['#squad-player-dialog'].open,false);
 showPlayerCard(catalog.players.find(p=>p.primaryPosition==='GK'),'GK');assert.match(nodes['#squad-player-card'].innerHTML,/Goalkeeping/);
});
