import {CONFIG} from './config.js';
export function stoppageMinutes(seed,tuning=CONFIG.periods){
 let state=(seed^0x81ab27d5)>>>0;
 const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return (state+.5)/4294967296;};
 const normal=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
 return [Math.max(tuning.minimum,Math.min(tuning.firstHalfMaximum,Math.round(tuning.firstHalfMean+normal()*tuning.firstHalfSpread))),Math.max(tuning.minimum,Math.min(tuning.secondHalfMaximum,Math.round(tuning.secondHalfMean+normal()*tuning.secondHalfSpread)))];
}
export function matchClock(time,half){
 const format=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
 const end=half===1?2700:5400;
 return time>=end?`${end/60}+${format(time-end)}`:format(time);
}
