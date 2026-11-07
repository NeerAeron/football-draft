import {BADGES,badgeEligible} from './traits.js';
import {playerTier} from './ratings.js';
import {CONFIG} from './config.js';
const weights={
 slalom:{dribbling:.45,acceleration:.35,control:.2},pressescape:{control:.5,composure:.35,strength:.15},givego:{shortPassing:.45,control:.30,vision:.25},latearrival:{shooting:.45,composure:.35,vision:.2},overlap:{crossing:.45,stamina:.3,pace:.25},anchor:{awareness:.55,defending:.35,strength:.10},
 speedster:{pace:.45,acceleration:.55},dribbler:{dribbling:.8,control:.2},control:{control:.8,composure:.2},vision:{vision:.8,shortPassing:.2},through:{vision:.5,shortPassing:.25,longPassing:.25},crosser:{crossing:1},cutback:{crossing:.5,shortPassing:.35,vision:.15},finisher:{shooting:.7,composure:.3},longshot:{longShots:1},power:{power:.8,longShots:.2},curve:{shooting:.5,longShots:.5},knuckle:{power:.55,longShots:.45},onetouch:{shortPassing:.6,control:.4},heading:{heading:.8,strength:.2},shield:{strength:.7,control:.3},penalty:{penalties:.85,composure:.15},volley:{shooting:.6,heading:.4},longball:{longPassing:.85,vision:.15},ballwinner:{defending:.8,strength:.2},interceptor:{awareness:.8,defending:.2},marker:{awareness:.5,defending:.5},recovery:{acceleration:.4,pace:.25,awareness:.35},engine:{stamina:1},safehands:{goalkeeping:.9,control:.1},reflexes:{goalkeeping:.9,acceleration:.1},distributor:{longPassing:.6,shortPassing:.4},gkreach:{goalkeeping:1},gkoneonone:{goalkeeping:.8,composure:.2},gkcommand:{goalkeeping:.7,awareness:.3},gkfeet:{control:.5,shortPassing:.5}
};
const identityKeys={slalom:'carry',pressescape:'carry',givego:'timing',latearrival:'timing',overlap:'overlap',anchor:'hold'};
export function rankBadges(p,evidence=[]){
 const source=new Map(evidence.map(e=>[e.tag,e]));
 return BADGES.filter(b=>badgeEligible(p,b)).map(b=>{
  const ability=Object.entries(weights[b.id]).reduce((n,[k,w])=>n+(p.attrs[k]||0)*w,0),explicit=source.get(b.id);
  const identity=identityKeys[b.id],fit=identity?((p.tendencies?.[identity]??.5)-.5)*.05:0;
  return explicit?{...explicit,ability}:{tag:b.id,confidence:.45+ability/500+fit,ability,evidence:'Inferred from '+Object.keys(weights[b.id]).join(', ')+(identity?' and '+identity+' tendency':'')};
 }).sort((a,b)=>b.confidence-a.confidence||b.ability-a.ability||a.tag.localeCompare(b.tag));
}
export function compileBadges(p,evidence=[]){
 const tier=playerTier(p),floor=tier.floor,richness=evidence.filter(e=>e.confidence>=.8).length>=6?1:0;
 const ceiling=Math.min(100,...Object.values(p.tuning?.playerTiers||CONFIG.playerTiers).map(t=>t.minimum).filter(n=>n>floor));
 const step=Math.min(3,(ceiling-floor)/(tier.capacity-tier.minimum+1));
 const count=Math.min(tier.capacity,tier.minimum+Math.max(0,Math.floor((tier.overall-floor)/step))+richness);
 return rankBadges(p,evidence).slice(0,count);
}
export function normalizeBadges(p,ids=[]){
 const tier=playerTier(p),eligible=new Set(BADGES.filter(b=>badgeEligible(p,b)).map(b=>b.id));
 const result=[...new Set(ids)].filter(id=>eligible.has(id)).slice(0,tier.capacity);
 for(const b of rankBadges(p,p.inference?.badges||[])){if(result.length>=tier.minimum)break;if(!result.includes(b.tag))result.push(b.tag);}
 return result;
}
