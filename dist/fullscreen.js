export function bindPitchFullscreen({target,button,document:doc=globalThis.document,onResize=()=>{}}){
 let fallback=false,pending=false;
 const active=()=>fallback||doc.fullscreenElement===target;
 function sync(){
  const expanded=active();target.classList.toggle('pitch-expanded',expanded);doc.body.classList.toggle('field-fullscreen',expanded);doc.body.classList.toggle('tv-mode',expanded);
  button.setAttribute('aria-pressed',String(expanded));button.setAttribute('aria-label',expanded?'Exit TV mode':'Enter TV mode');button.querySelector('span').textContent=expanded?'Exit TV mode':'TV mode';onResize();
 }
 async function exit(){
  fallback=false;if(doc.fullscreenElement===target&&doc.exitFullscreen)try{await doc.exitFullscreen();}catch{}sync();
 }
 async function toggle(){
  if(pending)return;pending=true;
  try{if(active())await exit();else{
   if(target.requestFullscreen)try{await target.requestFullscreen();}catch{fallback=true;}
   else fallback=true;sync();
  }}finally{pending=false;}
 }
 button.addEventListener('click',toggle);doc.addEventListener('fullscreenchange',sync);
 doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&fallback){e.preventDefault();fallback=false;sync();}});
 sync();return {get active(){return active();},exit,toggle};
}
