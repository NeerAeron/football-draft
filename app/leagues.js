import {CONFIG} from './config.js';
import {clubRating} from './team-ratings.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function leagueWeight(league){const c=CONFIG.draft;return (c.leagueWeights[league.tier]||0)*(1+clamp(((league.optaScore??80)-80)*c.leagueOptaSlope,-c.leagueOptaLimit,c.leagueOptaLimit))*(c.leagueOverrides[league.id]??1);}
export function teamWeight(team){
 const c=CONFIG.draft,every=c.clubDoubleEvery[team.leagueTier]??c.clubDoubleEvery.A,overall=team.overall??72;
 // Soften only the extra strength above the A-club floor in A leagues.
 // This is continuous at the boundary: a stronger club never gets worse odds.
 const elite=team.leagueTier==='A'?Math.max(0,overall-CONFIG.teamTiers.A):0;
 return 2**((overall-72-elite*(1-c.eliteClubBoost))/every)*(c.clubOverrides[team.id]??1);
}
export function respinMultiplier(kind,previous,candidate,tuning=CONFIG.draft.respinBoosts){
 if(!previous||!candidate)return 1;
 let gain,slight,medium;
 if(kind==='league'){
  const order=['F','D','C','B','A'],from=order.indexOf(previous.tier),to=order.indexOf(candidate.tier);
  if(from<0||to<0)return 1;gain=to-from;
  if(gain<0||gain===0&&!((candidate.optaScore??80)>(previous.optaScore??80)))return 1;
  slight=tuning.leagueSlightSteps;medium=tuning.leagueMediumSteps;
 }else if(kind==='team'){
  gain=(candidate.overall??0)-(previous.overall??0);if(gain<=0)return 1;
  slight=tuning.clubSlightGap;medium=tuning.clubMediumGap;
 }else return 1;
 return 1+(gain<=slight?tuning.slightlyBetter:gain<=medium?tuning.moderatelyBetter:tuning.muchBetter);
}
export function draftLeagues(catalog){
 const players=Array.isArray(catalog)?catalog:catalog.players,definitions=Array.isArray(catalog)?[]:catalog.leagues||[],teams=Array.isArray(catalog)?[]:catalog.teams||[];
 const groups=new Map(definitions.map(l=>[String(l.id),{...l,players:[],teams:[]} ]));
 for(const p of players){const id=String(p.source?.leagueId||'');if(groups.has(id))groups.get(id).players.push(p);}
 for(const l of groups.values()){
  const byClub=new Map();for(const p of l.players){const id=String(p.source.clubId);if(!byClub.has(id))byClub.set(id,[]);byClub.get(id).push(p);}
  l.teams=teams.filter(t=>String(t.leagueId)===l.id&&byClub.has(String(t.id))).map(t=>{const ps=byClub.get(String(t.id));return {...t,...clubRating(ps),leagueTier:l.tier,players:ps};});
 }
 return [...groups.values()].filter(l=>l.players.length>=CONFIG.draft.minimumLeaguePlayers&&l.available!==false).sort((a,b)=>Object.keys(CONFIG.draft.leagueWeights).indexOf(a.tier)-Object.keys(CONFIG.draft.leagueWeights).indexOf(b.tier)||a.name.localeCompare(b.name));
}
