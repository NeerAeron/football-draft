import {CONFIG} from './config.js';
import {overallRating} from './ratings.js';
export function clubRating(players){
 const best=players.map(p=>overallRating(p,false,p.primaryPosition)).sort((a,b)=>b-a).slice(0,10);
 if(!best.length)return {overall:0,sampleSize:0,tier:'F'};
 const n=best.length,overall=n%2?best[(n-1)/2]:(best[n/2-1]+best[n/2])/2;
 return {overall,sampleSize:n,tier:Object.keys(CONFIG.teamTiers).find(t=>overall>=CONFIG.teamTiers[t])||'F'};
}
export function rateClubCatalog(catalog){
 const groups=new Map();for(const p of catalog.players){const id=String(p.source.clubId);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
 return catalog.teams.map(t=>({...t,...clubRating(groups.get(String(t.id))||[])}));
}
