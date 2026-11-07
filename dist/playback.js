// One clock owns playback. Paused/hidden time and partially accumulated steps
// cannot leak into a resume, including a click between animation frames.
export class PlaybackClock{
  constructor(){this.paused=true;this.last=null;this.accumulator=0;}
  setPaused(value,now){this.paused=Boolean(value);this.last=now;this.accumulator=0;}
  reset(now){this.setPaused(true,now);}
  frame(now,blocked=false){const delta=this.last===null?0:Math.max(0,Math.min((now-this.last)/1000,.1));this.last=now;return this.paused||blocked?0:delta;}
  ticks(delta){this.accumulator+=delta;const count=Math.floor((this.accumulator+1e-10)*60);this.accumulator-=count/60;return count;}
}

// A pointer gesture has exactly one activation, even when the live UI updates
// between press and release. Native clicks remain available to keyboard/AT.
export function bindPlaybackButton(button,activate){
  let pointer=null,suppressClick=false;
  button.addEventListener('pointerdown',e=>{
    if(button.disabled||e.button!==0||e.isPrimary===false)return;
    pointer=e.pointerId;suppressClick=false;
    button.setPointerCapture?.(pointer);
  });
  button.addEventListener('pointerup',e=>{
    if(e.pointerId!==pointer)return;
    pointer=null;suppressClick=true;
    const r=button.getBoundingClientRect();
    if(!button.disabled&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)activate();
    if(button.hasPointerCapture?.(e.pointerId))button.releasePointerCapture(e.pointerId);
  });
  button.addEventListener('pointercancel',()=>{pointer=null;suppressClick=true;});
  button.addEventListener('lostpointercapture',()=>{pointer=null;});
  button.addEventListener('click',e=>{
    e.preventDefault();
    if(suppressClick&&e.detail!==0){suppressClick=false;return;}
    suppressClick=false;
    if(!button.disabled)activate();
  });
}
