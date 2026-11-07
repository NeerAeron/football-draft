import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Match,Player} from '../dist/engine.js';
import {BADGES,badgeEligible} from '../dist/traits.js';
import {playerTier,normalizeAttributes,overallRating,positionFamiliarity} from '../dist/ratings.js';
import {Draft} from '../dist/draft.js';
import {draftLeagues,leagueWeight,teamWeight} from '../dist/leagues.js';
import {createAIOpponent,chooseAIFormation} from '../dist/ai.js';
import {clubSquads,assignClubLineup,partialClubLineup} from '../dist/club-lineups.js';
import {FORMATIONS} from '../dist/formations.js';
import {CONFIG} from '../dist/config.js';
const catalog=JSON.parse(readFileSync(new URL('../dist/data/players-fc26.json',import.meta.url))),profiles=catalog.players;
function random(seed){let state=seed>>>0;return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);}

test('badge ranges and eligibility hold across the full recompiled catalog; hidden values are individual',()=>{
 const counts=new Map();
 for(const p of profiles){
  const tier=playerTier(p);assert.ok(!('playerType' in p));assert.ok(!('playerType' in p.inference));
  assert.ok(p.tags.length>=tier.minimum&&p.tags.length<=tier.capacity);assert.equal(new Set(p.tags).size,p.tags.length);assert.ok(p.tags.every(id=>badgeEligible(p,BADGES.find(b=>b.id===id))));
  assert.equal(p.inference.badges.length,p.tags.length);assert.ok(p.inference.badges.every(b=>b.evidence));
  assert.ok(Object.values(p.tendencies).every(v=>v>=.05&&v<=.95));
  if(!counts.has(tier.name))counts.set(tier.name,new Set());counts.get(tier.name).add(p.tags.length);
 }
 assert.deepEqual([...counts.get('Superstar')].sort(),[5,6,7]);assert.deepEqual([...counts.get('Star')].sort(),[3,4,5]);
 const cbs=profiles.filter(p=>p.primaryPosition==='CB');assert.ok(new Set(cbs.map(p=>JSON.stringify(p.tendencies))).size>cbs.length*.9);
});
test('every badge boosts a consumed ability while base overall stays unchanged',()=>{
 for(const badge of BADGES){const role=badge.group==='Goalkeeper'?'GK':'ST',p=new Player({role,attrs:normalizeAttributes(Object.fromEntries(Object.keys(normalizeAttributes({})).map(k=>[k,70]))),tags:[],tendencies:{},energy:1});
  const before=overallRating(p),key=Object.keys(badge.boosts)[0],ability=p.skill(key);p.tags=[badge.id];assert.ok(p.skill(key)>ability,badge.id);assert.equal(overallRating(p),before);}
});
test('hidden tendencies and badges survive swaps, configuration and replay import',()=>{
 const m=new Match(40),c=m.exportConfig();c.players[9]=profiles.find(p=>p.primaryPosition==='ST');m.importConfig(c);const expected=m.playerProfile(m.players[9]);
 assert.ok(m.swapLineup(9,2));assert.deepEqual(m.players[2].tendencies,expected.tendencies);assert.deepEqual(m.players[2].tags,expected.tags);
 const replay=new Match(41);replay.importConfig(m.exportConfig());assert.deepEqual(replay.players[2].tendencies,expected.tendencies);assert.ok(!('playerType' in replay.playerProfile(replay.players[2])));
});
test('tier weights dominate small strength nudges; every requested league has a local logo',()=>{
 const leagues=draftLeagues(catalog);assert.equal(leagues.length,40);assert.ok(leagues.every(l=>l.players.length>=5));
 assert.ok(leagueWeight({tier:'A',optaScore:50})>leagueWeight({tier:'B',optaScore:100}));
 const ratios=['A','B','C'].map(leagueTier=>teamWeight({overall:84,leagueTier})/teamWeight({overall:78,leagueTier}));
 assert.ok(ratios[0]>1.9&&ratios[0]<2);assert.ok(ratios[1]>3&&ratios[1]<4);assert.ok(ratios[2]>5&&ratios[2]<6);
 assert.equal(teamWeight({overall:84,leagueTier:'C',tier:'S',optaScore:10}),teamWeight({overall:84,leagueTier:'C',tier:'F',optaScore:100}));
 const total=leagues.reduce((n,l)=>n+leagueWeight(l),0),aShare=leagues.filter(l=>l.tier==='A').reduce((n,l)=>n+leagueWeight(l),0)/total;
 assert.ok(aShare>.51&&aShare<.52);
 const auditClubs=clubSquads(catalog);
 for(const l of leagues){assert.ok(l.teams.every(t=>t.leagueTier===l.tier));for(const t of l.teams)assert.equal(teamWeight(t),teamWeight(auditClubs.find(c=>c.id===t.id)));}
 for(const l of catalog.leagues)assert.ok(existsSync(new URL(`../dist/${l.logo}`,import.meta.url)),l.name);
});
test('both draws stay locked through filtering and reject players from elsewhere',()=>{
 const d=new Draft(catalog,{seed:8901});const league=d.spinLeague(),rng=d.rng;
 for(let slot=0;slot<11;slot++)d.available(slot);assert.equal(d.spinLeague(),league);assert.equal(d.rng,rng);
 if(d.needsClub){assert.equal(d.available().length,0);const club=d.spinTeam(),after=d.rng;d.available(0);assert.equal(d.spinTeam(),club);assert.equal(d.rng,after);assert.ok(d.available().every(p=>p.source.clubId===club.id));}
 else assert.equal(d.spinTeam(),null);
 const wrong=profiles.find(p=>p.source.leagueId!==league.id&&d.eligible(p));assert.equal(d.pick(d.bestSlot(wrong),wrong.profileId),false);
});
test('elite odds reduction only affects S/A clubs in A leagues and stays continuous at the boundary',()=>{
 const original=(overall,leagueTier)=>2**((overall-72)/CONFIG.draft.clubDoubleEvery[leagueTier]);
 for(const leagueTier of ['A','B','C'])for(const overall of [65,70,75,77.99,78,80,82,85,89]){
  const weight=teamWeight({overall,leagueTier});
  if(leagueTier==='A'&&overall>CONFIG.teamTiers.A)assert.ok(weight<original(overall,leagueTier));else assert.equal(weight,original(overall,leagueTier));
 }
 let last=0;for(let overall=65;overall<91;overall+=.1){const next=teamWeight({overall,leagueTier:'A'});assert.ok(next>last);last=next;}
});
test('league and club drafts always finish, including late keeper picks and D/F bypass',()=>{
 let bypass=0,clubs=0;
 for(const seed of [8931,8932,8933,8910,8955]){
  const d=new Draft(catalog,{seed,formations:['352','541']});
  while(!d.complete){const league=d.spinLeague();if(d.needsClub){assert.equal(d.available().length,0);d.spinTeam();clubs++;}else{assert.equal(d.spinTeam(),null);bypass++;}
   const pool=d.available(),outfield=pool.filter(p=>p.primaryPosition!=='GK'),p=(outfield.length?outfield:pool).sort((a,b)=>overallRating(b,false,b.primaryPosition)-overallRating(a,false,a.primaryPosition))[0];assert.ok(p);assert.equal(p.source.leagueId,league.id);assert.ok(d.pick(d.bestSlot(p),p.profileId));}
  assert.equal(d.used.size,22);assert.ok(d.picks.every(ps=>ps.filter(p=>p.primaryPosition==='GK').length===1));
 }
 assert.ok(clubs>0);const low=new Draft({...catalog,leagues:catalog.leagues.filter(l=>['D','F'].includes(l.tier))},{seed:33});low.spinLeague();assert.equal(low.needsClub,false);assert.equal(low.spinTeam(),null);assert.ok(low.available().length>0);const p=low.available()[0];assert.ok(low.pick(low.bestSlot(p),p.profileId));
});
test('AI selects only its specified team tiers with full compatible XIs; all-stars meet the floor',()=>{
 const playable=clubSquads(catalog).filter(c=>c.formations.length);assert.ok(playable.length>200);
 const expected={veryeasy:['C'],easy:['B'],medium:['A'],hard:['S'],impossible:['S']};
 for(const [level,tiers] of Object.entries(expected))for(const seed of [17,42,77]){
  const ai=createAIOpponent(catalog,level,random(seed));assert.ok(tiers.includes(ai.tier));assert.equal(new Set(ai.players.map(p=>p.profileId)).size,11);assert.equal(ai.players.filter(p=>p.primaryPosition==='GK').length,1);
  ai.players.forEach((p,i)=>assert.ok(positionFamiliarity(p,FORMATIONS[ai.formation][i][2])>=.85));
  if(level==='impossible')assert.ok(ai.players.every((p,i)=>overallRating(p,true,p.primaryPosition)>=84&&overallRating(p,true,FORMATIONS[ai.formation][i][2])>=84));else assert.ok(ai.players.every(p=>p.source.clubId===ai.id));
  const draft=new Draft(catalog,{seed,formations:['433',ai.formation],opponent:ai.players});while(!draft.complete){draft.spinLeague();draft.spinTeam();const p=draft.available()[0];assert.ok(draft.pick(draft.bestSlot(p),p.profileId));}assert.equal(draft.history.length,11);assert.equal(draft.used.size,22);
 }
 const a=createAIOpponent(catalog,'impossible',random(17)),b=createAIOpponent(catalog,'impossible',random(18));assert.notDeepEqual(a.players.map(p=>p.profileId),b.players.map(p=>p.profileId));
});
test('squad assignment rejects incomplete clubs and chooses unique players by positional fit',()=>{
 assert.equal(assignClubLineup(profiles.slice(0,10),'433'),null);
 const club=clubSquads(catalog).find(c=>c.name==='Arsenal'),choice=chooseAIFormation(club.players,{level:'hard',random:()=>.5});
 assert.ok(FORMATIONS[choice.formation]);assert.equal(choice.lineup[0].primaryPosition,'GK');assert.equal(new Set(choice.lineup.map(p=>p.profileId)).size,11);
});

test('partial Sandbox lineups preserve real club members and expose empty slots without invented players',()=>{
 const club=clubSquads(catalog).find(c=>c.players.length<11&&c.players.length>2),lineup=partialClubLineup(club.players,'433');
 assert.equal(lineup.length,11);assert.ok(lineup.some(p=>!p));const filled=lineup.filter(Boolean);assert.ok(filled.length>0);assert.equal(new Set(filled.map(p=>p.profileId)).size,filled.length);assert.ok(filled.every(p=>p.source.clubId===club.id&&!p.vacant));
 for(const t of catalog.teams){assert.match(t.primary,/^#[0-9a-f]{6}$/i);assert.match(t.secondary,/^#[0-9a-f]{6}$/i);assert.ok(t.colorSource);}
});
