import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Draft} from '../dist/draft.js';
import {CONFIG,DEFAULT_CONFIG,normalizeConfig} from '../dist/config.js';
import {leagueWeight,teamWeight,respinMultiplier} from '../dist/leagues.js';

const catalog=JSON.parse(readFileSync(new URL('../dist/data/players-runtime.json',import.meta.url)));
test('club re-spin improvements apply exactly one relative boost, with no bonus for equal or worse teams',()=>{
 const previous={overall:70};
 for(const [overall,expected] of [[68,1],[70,1],[70.01,1.2],[73,1.2],[73.01,1.15],[77,1.15],[77.01,1.05],[89,1.05]])assert.equal(respinMultiplier('team',previous,{overall}),expected,`OVR ${overall}`);
 assert.equal(respinMultiplier('team',{overall:86},{overall:85}),1);
});
test('league re-spins compare the assigned league tier first, using strength only within the same tier',()=>{
 const previous={tier:'D',optaScore:70};
 for(const [tier,expected] of [['F',1],['D',1],['C',1.2],['B',1.15],['A',1.05]])assert.equal(respinMultiplier('league',previous,{tier,optaScore:70}),expected,tier);
 assert.equal(respinMultiplier('league',{tier:'A',optaScore:84},{tier:'A',optaScore:85}),1.2);
 assert.equal(respinMultiplier('league',{tier:'A',optaScore:85},{tier:'A',optaScore:84}),1);
 assert.equal(respinMultiplier('league',{tier:'A',optaScore:70},{tier:'B',optaScore:99}),1);
 assert.equal(respinMultiplier('league',{tier:'F',optaScore:70},{tier:'A',optaScore:90}),1.05);
});
test('normal spin weights stay unchanged, and each re-spin boosts against its own previous landing only',()=>{
 const d=new Draft(catalog,{seed:8}),original=d.weighted;let observed=[];
 d.weighted=function(options,weight){observed=options.map(o=>({option:o,weight:weight(o)}));return options.find(o=>o.tier==='D')||options[0];};
 const previous=d.spinLeague();assert.equal(previous.tier,'D');for(const {option,weight} of observed)assert.equal(weight,leagueWeight(option));
 d.weighted=function(options,weight){observed=options.map(o=>({option:o,weight:weight(o)}));return original.call(this,options,weight);};
 const rng=d.rng,result=d.respin('league');assert.notEqual(result.id,previous.id);assert.equal(d.rng,(Math.imul(1664525,rng)+1013904223)>>>0);
 const multipliers=new Set();for(const {option,weight} of observed){const boost=respinMultiplier('league',previous,option);multipliers.add(boost);assert.equal(weight,leagueWeight(option)*boost);}
 for(const n of [1,1.2,1.15,1.05])assert.ok(multipliers.has(n));
 assert.ok(d.respinOptions('league').length===0);const stopped=d.rng;assert.equal(d.respin('league'),null);assert.equal(d.rng,stopped);
 const teamDraft=new Draft(catalog,{seed:32});teamDraft.league=teamDraft.leagues.find(l=>l.id==='13');
 teamDraft.weighted=(options,weight)=>{observed=options.map(o=>({option:o,weight:weight(o)}));return [...options].sort((a,b)=>a.overall-b.overall)[0];};
 const oldClub=teamDraft.spinTeam();for(const {option,weight} of observed)assert.equal(weight,teamWeight(option));
 teamDraft.respin('team');for(const {option,weight} of observed)assert.equal(weight,teamWeight(option)*respinMultiplier('team',oldClub,option));
 assert.equal(teamDraft.league.id,'13');assert.equal(teamDraft.respins[teamDraft.turn].league,1);
});
test('animation pools stay broad and stable while hidden guarantees narrow the actual outcome pools',()=>{
 const d=new Draft(catalog,{seed:42}),baseline=d.reelOptions('league').map(l=>l.id);
 const chosen=catalog.players.filter(p=>p.primaryPosition!=='GK').slice(-3);chosen.forEach((p,i)=>{d.picks[d.turn][i+1]=p;d.used.add(p.profileId);});
 const rng=d.rng,actual=d.leagueOptions();assert.ok(actual.length<baseline.length);
 assert.deepEqual(d.reelOptions('league').map(l=>l.id),baseline);assert.ok(d.reelOptions('league').some(l=>!actual.some(a=>a.id===l.id)));
 d.league=d.leagues.find(l=>l.id==='13');const clubs=d.reelOptions('team').map(t=>t.id),eligible=d.teamOptions();assert.ok(eligible.length<clubs.length);
 const result=d.spinTeam();assert.ok(clubs.includes(result.id));const afterSpin=d.rng;
 d.revealSpins[d.turn].superstar=new Set([1,2,3]);d.revealSpins[d.turn].star=new Set([1,2,3,4,5]);
 assert.deepEqual(d.reelOptions('team').map(t=>t.id),clubs);assert.deepEqual(d.reelOptions('league').map(l=>l.id),baseline);assert.equal(d.rng,afterSpin);assert.notEqual(d.rng,rng);
});
test('re-spin configuration fills missing saved defaults and validates improvement ranges',()=>{
 const previous=structuredClone(DEFAULT_CONFIG);delete previous.draft.respinBoosts;
 assert.deepEqual(normalizeConfig(previous).draft.respinBoosts,DEFAULT_CONFIG.draft.respinBoosts);
 const custom=structuredClone(DEFAULT_CONFIG);custom.draft.respinBoosts.slightlyBetter=.35;custom.draft.respinBoosts.clubSlightGap=4;
 assert.deepEqual(normalizeConfig(custom).draft.respinBoosts,custom.draft.respinBoosts);
 assert.equal(respinMultiplier('team',{overall:70},{overall:74},custom.draft.respinBoosts),1.35);
 custom.draft.respinBoosts.clubSlightGap=custom.draft.respinBoosts.clubMediumGap;assert.throws(()=>normalizeConfig(custom),/Medium re-spin/);
 assert.deepEqual(CONFIG.draft.leagueWeights,{A:36,B:11,C:3,D:.8,F:.2});
});
