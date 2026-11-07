import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Draft} from '../app/draft.js';
import {overallRating,playerTier} from '../app/ratings.js';
import {createAIOpponent} from '../app/ai.js';
import {leagueWeight,teamWeight} from '../app/leagues.js';
const catalog=JSON.parse(readFileSync(new URL('../app/data/players-runtime.json',import.meta.url)));
const random=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
function reveal(d,seen){
 const cards=d.visible().sort((a,b)=>overallRating(b,false,b.primaryPosition)-overallRating(a,false,a.primaryPosition)).slice(0,24);
 for(const p of cards)seen?.[d.turn][d.budgetGroup(p)]?.add(d.revealSerial);
 d.recordShown(cards.map(p=>p.profileId));return cards;
}
test('each human gets one independent re-spin of each kind, with different valid results',()=>{
 const d=new Draft({...catalog,leagues:catalog.leagues.filter(l=>l.tier==='A')},{seed:77});
 const team=d.turn,rng=d.rng;assert.equal(d.respin('league'),null);assert.equal(d.respin('team'),null);assert.equal(d.rng,rng);
 const league=d.spinLeague();d.spinTeam();const club=d.club,changed=d.respin('team');assert.ok(changed);assert.notEqual(changed.id,club.id);assert.equal(d.league.id,league.id);assert.equal(d.respins[team].team,0);
 const afterTeam=d.rng;assert.equal(d.respin('team'),null);assert.equal(d.rng,afterTeam);
 const lockedRng=d.rng,serial=d.revealSerial;assert.equal(d.respin('league'),null);assert.deepEqual(d.respinOptions('league'),[]);assert.equal(d.rng,lockedRng);assert.equal(d.revealSerial,serial);assert.equal(d.club,changed);assert.equal(d.respins[team].league,1);
 const p=d.available()[0];assert.ok(d.pick(d.bestSlot(p),p.profileId,{confirmedBudgetSlot:d.budgetOffer(p).slotGroup}));assert.deepEqual(d.respins[d.turn],{league:1,team:1});
 d.spinLeague();d.spinTeam();const q=d.available()[0];assert.ok(d.pick(d.bestSlot(q),q.profileId));assert.equal(d.turn,team);assert.deepEqual(d.respins[team],{league:1,team:0});
 const next=d.spinLeague(),replacement=d.respin('league');assert.ok(replacement);assert.notEqual(replacement.id,next.id);assert.equal(d.club,null);assert.equal(d.unlocked,false);assert.equal(d.respins[team].league,0);
 assert.equal(d.respin('league'),null);d.spinTeam();assert.equal(d.respin('team'),null);
});
test('single-result draws do not spend credits or randomness, and D/F have no team re-spin',()=>{
 const team=catalog.teams.find(t=>catalog.players.filter(p=>p.source.clubId===t.id&&p.primaryPosition==='GK').length>=2&&catalog.leagues.find(l=>l.id===t.leagueId)?.tier==='A');
 const data={...catalog,leagues:catalog.leagues.filter(l=>l.id===team.leagueId),teams:[team],players:catalog.players.filter(p=>p.source.clubId===team.id)};
 const d=new Draft(data,{seed:12});d.spinLeague();d.spinTeam();const rng=d.rng;assert.equal(d.respin('league'),null);assert.equal(d.respin('team'),null);assert.equal(d.rng,rng);assert.deepEqual(d.respins[d.turn],{league:1,team:1});
 const low=new Draft({...catalog,leagues:catalog.leagues.filter(l=>['D','F'].includes(l.tier))},{seed:33});low.spinLeague();assert.equal(low.needsClub,false);assert.equal(low.respin('team'),null);assert.equal(low.respins[low.turn].team,1);
});
test('each revealed pool counts once per tier; a fresh spin of the same club counts again',()=>{
 const d=new Draft(catalog,{seed:1}),first=d.turn;
 d.weighted=options=>options.find(o=>o.id==='13'||o.name==='Liverpool')||options[0];d.spinLeague();d.spinTeam();
 const supers=d.visible().filter(p=>playerTier(p).name==='Superstar'),outside=catalog.players.find(p=>p.source.clubId!==d.club.id&&playerTier(p).name==='Superstar'),rng=d.rng;
 assert.ok(supers.length>=3);d.visible();d.available();d.recordShown([outside.profileId]);assert.equal(d.revealSpins[first].superstar.size,0);
 reveal(d);reveal(d);assert.equal(d.revealSpins[first].superstar.size,1);assert.equal(d.revealSpins[first].star.size,1);assert.equal(d.revealSpins[1-first].superstar.size,0);assert.equal(d.rng,rng);
 d.spinLeague();d.spinTeam();reveal(d);assert.equal(d.revealSpins[first].superstar.size,1,'reading the locked result is not another spin');
 const p=d.available().at(-1);assert.ok(d.pick(d.bestSlot(p),p.profileId,{confirmedBudgetSlot:d.budgetOffer(p).slotGroup}));d.spinLeague();d.spinTeam();reveal(d);
 assert.equal(d.revealSpins[1-first].superstar.size,1);const q=d.available().at(-1);assert.ok(d.pick(d.bestSlot(q),q.profileId));d.spinLeague();d.spinTeam();reveal(d);
 assert.equal(d.club.name,'Liverpool');assert.equal(d.revealSpins[first].superstar.size,2);assert.equal(d.revealSpins[first].star.size,2);
});
test('drafts meet mode-specific reveal targets, or stop targeting a filled budget tier',()=>{
 for(const mode of ['pvp','budget','takeover'])for(const seed of [21,58,103]){
  const ai=mode==='pvp'?null:createAIOpponent(catalog,'hard',random(seed));
  const d=new Draft(catalog,{seed,funding:mode,opponent:ai?.players,formations:['352',ai?.formation||'541']}),seen=Array.from({length:2},()=>({superstar:new Set(),star:new Set()}));
  // Adversarial low-weight outcomes must still satisfy the internal reveal constraint.
  if(seed===21)d.weighted=(options,weight)=>[...options].sort((a,b)=>weight(a)-weight(b))[0];
  while(!d.complete){
   d.spinLeague();if(d.history.length%4===0)d.respin('league');d.spinTeam();reveal(d,seen);
   if(d.history.length%3===0&&d.respin('team'))reveal(d,seen);
   const available=d.available(),preferred=available.filter(p=>seed===58?p.primaryPosition==='GK':p.primaryPosition!=='GK');
   const p=(preferred.length?preferred:available).sort((a,b)=>overallRating(a,false,a.primaryPosition)-overallRating(b,false,b.primaryPosition))[0];
   assert.ok(p);assert.ok(d.pick(d.bestSlot(p),p.profileId,{confirmedBudgetSlot:d.budgetOffer(p).slotGroup}));
  }
  const targets=mode==='takeover'?[['superstar',2],['star',3]]:[['superstar',3],['star',5]];
  for(const team of mode==='pvp'?[0,1]:[0])for(const [tier,target] of targets)assert.ok(seen[team][tier].size>=target||(mode==='budget'&&d.budgetState().used[tier]===d.budgetRules[tier]),`${mode}/${seed}/${team}/${tier}: ${seen[team][tier].size}`);
  if(mode==='budget'){assert.deepEqual(d.budgetState().used,{superstar:2,star:3,starter:3,lower:3});}
  const rng=d.rng;assert.deepEqual(d.revealNeeds(),[]);assert.deepEqual(d.leagueOptions(),[]);assert.equal(d.spinLeague(),null);assert.equal(d.respin('league'),null);assert.equal(d.rng,rng);
 }
});
test('takeover returns every eligible league and club to ordinary odds after two Superstar and three Star spins',()=>{
 const ai=createAIOpponent(catalog,'hard',random(103)),d=new Draft(catalog,{seed:103,opponent:ai.players,funding:'takeover'});
 d.weighted=options=>options.find(o=>o.id==='13'||o.name==='Liverpool')||options[0];
 for(let spin=0;spin<3;spin++){
  d.spinLeague();d.spinTeam();assert.equal(d.club.name,'Liverpool');
  const star=d.available().find(p=>d.budgetGroup(p)==='star'),superstar=d.available().find(p=>d.budgetGroup(p)==='superstar');
  assert.ok(star);assert.ok(superstar);
  // One Star-only view, then two separate views containing both tiers.
  d.recordShown([star.profileId,...(spin?[superstar.profileId]:[])]);
  assert.ok(d.pick(d.bestSlot(star),star.profileId));
 }
 assert.equal(d.revealSpins[0].superstar.size,2);assert.equal(d.revealSpins[0].star.size,3);
 assert.deepEqual(d.revealNeeds(),[]);assert.equal(d.complete,false);
 const baseline=d.leagues.filter(l=>leagueWeight(l)>0&&l.players.some(p=>d.eligible(p))&&(!['A','B','C'].includes(l.tier)||d.eligibleTeams(l).length));
 assert.deepEqual(d.leagueOptions().map(l=>l.id),baseline.map(l=>l.id));
 d.weighted=(options,weight)=>{for(const option of options)assert.equal(weight(option),leagueWeight(option));return options.find(l=>l.tier==='F');};
 const lowLeague=d.spinLeague();assert.equal(lowLeague.tier,'F');assert.ok(d.available().length);
 assert.deepEqual(d.respinOptions('league').map(l=>l.id),baseline.filter(l=>l.id!==lowLeague.id).map(l=>l.id));
 d.league=d.leagues.find(l=>l.id==='13');
 const clubs=d.eligibleTeams(d.league);assert.deepEqual(d.teamOptions().map(t=>t.id),clubs.map(t=>t.id));
 d.weighted=(options,weight)=>{for(const option of options)assert.equal(weight(option),teamWeight(option));return [...options].sort((a,b)=>a.overall-b.overall)[0];};
 const lowClub=d.spinTeam();assert.equal(lowClub.overall,Math.min(...clubs.map(t=>t.overall)));
 assert.deepEqual(d.respinOptions('team').map(t=>t.id),clubs.filter(t=>t.id!==lowClub.id).map(t=>t.id));
});
test('unfinished targets never prevent a full team or a draft with no usable stars',()=>{
 const ai=createAIOpponent(catalog,'hard',random(31));
 const lower={...catalog,players:catalog.players.filter(p=>overallRating(p,true,p.primaryPosition)<74)};
 const d=new Draft(lower,{seed:43,opponent:ai.players,funding:'budget'});
 while(!d.complete){d.spinLeague();d.spinTeam();reveal(d);const pool=d.available(),p=pool.find(p=>p.primaryPosition!=='GK')||pool[0];assert.ok(p);assert.ok(d.pick(d.bestSlot(p),p.profileId,{confirmedBudgetSlot:d.budgetOffer(p).slotGroup}));}
 assert.deepEqual(d.budgetState().counts,{superstar:0,star:0,starter:0,lower:11});assert.equal(d.revealSpins[0].superstar.size,0);assert.equal(d.revealSpins[0].star.size,0);
 assert.equal(d.history.length,11);assert.equal(d.used.size,22);assert.equal(d.spinTeam(),null);assert.deepEqual(d.revealNeeds(),[]);
});
