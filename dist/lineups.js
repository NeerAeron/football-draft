import {positionFamiliarity} from './ratings.js';

export function playerInitials(player){
  const parts=String(player.name||player.fullName||'').match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu)||[];
  return parts.slice(0,3).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase()||'?';
}

// Assign the entire match together so a flexible player cannot displace the
// only specialist needed elsewhere. Random order breaks equal-proficiency ties;
// overall is deliberately absent, so the draw is not just an all-star selection.
export function randomLineups(slots,profiles,seed){
  if(profiles.length<slots.length||new Set(profiles.map(p=>p.profileId)).size!==profiles.length)throw new Error('Not enough distinct player profiles');
  let state=(seed^0x9e3779b9)>>>0;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  const shuffle=items=>{const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  const rows=shuffle(slots.map((slot,index)=>({slot,index}))),pool=shuffle(profiles),n=rows.length,m=pool.length;
  const cost=rows.map(({slot})=>pool.map(p=>(p.primaryPosition==='GK')!==(slot.role==='GK')?100:1-positionFamiliarity(p,slot.role)));
  // Rectangular Hungarian assignment, O(slots² × profiles). Potentials retain
  // the true familiarity costs; random ratings or arbitrary position boosts
  // never enter the optimization or the players' attributes.
  const u=new Float64Array(n+1),v=new Float64Array(m+1),owner=new Int32Array(m+1),via=new Int32Array(m+1);
  for(let i=1;i<=n;i++){
    owner[0]=i;let column=0;const best=new Float64Array(m+1).fill(Infinity),used=new Uint8Array(m+1);
    do{
      used[column]=1;const row=owner[column];let delta=Infinity,next=0;
      for(let j=1;j<=m;j++)if(!used[j]){
        const reduced=cost[row-1][j-1]-u[row]-v[j];
        if(reduced<best[j]){best[j]=reduced;via[j]=column;}
        if(best[j]<delta){delta=best[j];next=j;}
      }
      for(let j=0;j<=m;j++)if(used[j]){u[owner[j]]+=delta;v[j]-=delta;}else best[j]-=delta;
      column=next;
    }while(owner[column]!==0);
    do{const previous=via[column];owner[column]=owner[previous];column=previous;}while(column!==0);
  }
  const result=Array(n);
  for(let j=1;j<=m;j++)if(owner[j]){
    const row=owner[j]-1;if(cost[row][j-1]>=100)throw new Error('Not enough players for the required goalkeeper and outfield slots');
    result[rows[row].index]=structuredClone(pool[j-1]);
  }
  return result;
}
