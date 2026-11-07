import {CONFIG,DEFAULT_CONFIG,CONFIG_FIELDS,loadConfig,saveConfig,normalizeConfig,setRuntimeConfig,configValue,setConfigValue} from './config.js';
import {draftLeagues,leagueWeight,teamWeight} from './leagues.js';
import {clubSquads} from './club-lineups.js';
import {BADGES} from './traits.js';
import {ATTRS,overallRating,playerTier} from './ratings.js';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let draft=loadConfig(),active='draft',data=null,loading=null,clubLeague='',clubQuery='',clubLimit=40,role='ST',timer;
const sections=[
 ['draft','Draft & budget','Lower-tier players can use higher budget slots after confirmation.',p=>p.startsWith('draft.')&&!p.includes('Overrides.')],
 ['leagues','League odds','Opening full-pool probabilities. Budget restrictions and previous picks change the eligible pool.',p=>p.startsWith('draft.leagueOverrides.')],
 ['clubs','Club odds','Odds are conditional on the selected league. D and F leagues skip the club spinner.',p=>p.startsWith('draft.clubOverrides.')],
 ['playerTiers','Player tiers','Natural-position overall determines tier and badge allowance.',p=>p.startsWith('playerTiers.')],
 ['teamTiers','Team tiers','Median of the top ten natural player ratings. Partial clubs use their available players.',p=>p.startsWith('teamTiers.')],
 ['ai','AI decisions','Club strength and coaching only. Match physics stay the same.',p=>p.startsWith('ai.')],
 ['gameplay','Gameplay','1.00 is the baseline. Actual rates emerge from the players, tactics and match situation.',p=>p.startsWith('gameplay.')],
 ['discipline','Cards','Card severity and caution after a booking.',p=>p.startsWith('discipline.')],
 ['stamina','Stamina & time','Stamina recovery and added time. Sprint reserves use real seconds.',p=>p.startsWith('stamina.')||p.startsWith('periods.')],
 ['formats','Match formats','Chance creation and execution for each match length.',p=>p.startsWith('formats.')],
 ['ratings','Overall & positions','Overall weights are normalized within each position.',p=>p.startsWith('ratings.')],
 ['badges','Badge boosts','Bonuses are added to base abilities up to the shared cap.',p=>p.startsWith('badges.')],
 ['display','Display & motion','Circle sizes are multipliers. These controls do not change collision geometry.',p=>p.startsWith('display.')]
];
const status=(text,error=false)=>{$('#config-status').textContent=text;$('#config-status').classList.toggle('error',error);};
function edit(path,value){setConfigValue(draft,path,value);status('Unsaved changes');clearTimeout(timer);timer=setTimeout(()=>{try{setRuntimeConfig(draft);refreshSummary();if(['leagues','clubs'].includes(active))refreshOdds();}catch(e){status(e.message,true);}},180);}
const percentField=f=>f.path.startsWith('badges.tendencies.')||['halftimeRecovery','leagueOptaLimit','leagueOptaSlope','minimumFit','impossibleFit','storedTendencyWeight','familiarityBase','familiarityBonus','unfamiliarFit','fatigueThreshold','eliteClubBoost','slightlyBetter','moderatelyBetter','muchBetter'].includes(f.key);
function input(field){const scale=percentField(field)?100:1,value=configValue(draft,field.path);if(typeof field.defaultValue==='boolean')return `<input type="checkbox" data-setting="${field.path}" ${value?'checked':''} aria-label="${esc(field.label)}">`;
 if(typeof field.defaultValue==='string')return `<select data-setting="${field.path}" aria-label="${esc(field.label)}">${['S','A','B','C','D','F'].map(t=>`<option${value===t?' selected':''}>${t}</option>`).join('')}</select>`;
 return `<input type="number" data-setting="${field.path}" value="${Number((value*scale).toFixed(4))}" min="${field.min*scale}" max="${field.max*scale}" step="${Math.abs((value-field.min)/field.step-Math.round((value-field.min)/field.step))>1e-7?'any':field.step*scale}" aria-label="${esc(field.path.startsWith('badges.boosts.')?ATTRS[field.key]||field.label:field.label)}">`;
}
function bindInputs(){document.querySelectorAll('[data-setting]').forEach(node=>node.oninput=()=>{const field=CONFIG_FIELDS.find(f=>f.path===node.dataset.setting);if(node.type==='number'&&(!node.validity.valid||node.value==='')){status('Check the value for '+field.label+'.',true);return;}edit(field.path,node.type==='checkbox'?node.checked:node.type==='number'?Number(node.value)/(percentField(field)?100:1):node.value);});}
function groupLabel(path){if(path==='draft.respinBoosts')return 'Re-spin improvement boosts';if(path==='draft.clubDoubleEvery')return 'Club odds double every… OVR (lower = stronger bias)';const parts=path.split('.');if(parts[0]==='formats')return parts[1]==='180'?'3-minute match':'5-minute match';if(parts[0]==='badges'&&parts[1]==='tendencies')return 'Tendency · '+parts[2];if(parts[0]==='badges'&&parts[1]==='boosts')return BADGES.find(b=>b.id===parts[2])?.label||parts[2];if(parts[0]==='playerTiers')return parts[1];if(parts[0]==='ratings'&&parts[1]==='roleWeights')return 'Overall weights';if(parts[0]==='ratings'&&parts[1]==='roleOffsets')return 'Position calibration';return parts.slice(1).join(' · ').replace(/([a-z])([A-Z])/g,'$1 $2')||sections.find(s=>s[0]===active)?.[1];}
async function catalog(){if(data)return data;loading??=fetch('./data/players-runtime.json').then(r=>{if(!r.ok)throw Error('Catalog unavailable');return r.json();});data=await loading;return data;}
function navigation(){const query=$('#config-search').value.trim().toLowerCase();$('#config-navigation').innerHTML=sections.map(([id,label,,match])=>{const count=CONFIG_FIELDS.filter(f=>match(f.path)&&(!query||(f.path+' '+f.label).toLowerCase().includes(query))).length;return `<button type="button" data-section="${id}" class="${id===active?'active':''}">${label}<small>${count}</small></button>`;}).join('');document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{active=b.dataset.section;render();});}
async function render(){
 navigation();const section=sections.find(s=>s[0]===active),query=$('#config-search').value.trim().toLowerCase();$('#config-title').textContent=section[1];$('#config-description').textContent=section[2];$('#config-summary').textContent='';
 if(['leagues','clubs'].includes(active)){await renderOdds();return;}
 const fields=CONFIG_FIELDS.filter(f=>section[3](f.path)&&(!query||(f.path+' '+f.label).toLowerCase().includes(query))&&(active!=='ratings'||!f.path.startsWith('ratings.roleWeights.')||f.path.split('.')[2]===role));
 const groups=new Map();for(const f of fields){const group=f.path.split('.').slice(0,-1).join('.');if(!groups.has(group))groups.set(group,[]);groups.get(group).push(f);}
 $('#config-fields').innerHTML=(active==='ratings'?`<label class="role-filter">Position<select id="rating-role">${Object.keys(draft.ratings.roleWeights).map(p=>`<option${p===role?' selected':''}>${p}</option>`).join('')}</select></label>`:'')+[...groups].map(([group,fs])=>`<fieldset><legend>${esc(groupLabel(group))}</legend>${fs.map(f=>{const label=f.path==='draft.budget.lower'?'Normal / Bench':f.path.startsWith('badges.tendencies.')?(BADGES.find(b=>b.id===f.key)?.label||f.label):f.path.startsWith('badges.boosts.')||f.path.startsWith('ratings.roleWeights.')?ATTRS[f.key]||f.label:f.path.startsWith('ai.tiers.')?{veryeasy:'Very Easy',easy:'Easy',medium:'Medium',hard:'Hard'}[f.key]:f.label;return `<label class="config-row"><span>${esc(label)}${percentField(f)?' (%)':''}<small>${f.path.startsWith('draft.budget.')&&f.key==='lower'?'Normal or Bench':`Default ${percentField(f)?Number((f.defaultValue*100).toFixed(3))+'%':f.defaultValue}`}</small></span>${input(f)}</label>`;}).join('')}</fieldset>`).join('');
 if(!fields.length)$('#config-fields').insertAdjacentHTML('beforeend','<p>No matching settings in this section.</p>');if($('#rating-role'))$('#rating-role').onchange=e=>{role=e.target.value;render();};bindInputs();refreshSummary();
}
async function refreshSummary(){
 if(!['teamTiers','playerTiers','ai','ratings'].includes(active))return;
 try{const current=active;await catalog();if(current!==active)return;
  if(active==='ratings'){const weights=draft.ratings.roleWeights[role],sum=Object.values(weights).reduce((a,b)=>a+b,0);$('#config-summary').innerHTML=`<div class="weight-summary">${Object.entries(weights).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span>${esc(ATTRS[k])} <b>${(v/sum*100).toFixed(1)}%</b></span>`).join('')}</div>`;return;}
  const clubs=clubSquads(data);
  if(active==='teamTiers')$('#config-summary').innerHTML=`<div class="summary-chips">${Object.keys(draft.teamTiers).map(t=>`<span><b>${t}</b> ${clubs.filter(c=>c.tier===t).length} clubs · ${clubs.filter(c=>c.tier===t&&c.formations.length).length} complete XIs</span>`).join('')}</div>`;
  if(active==='playerTiers'){const counts={};for(const p of data.players){const tier=playerTier(p).name;counts[tier]=(counts[tier]||0)+1;}$('#config-summary').innerHTML=`<div class="summary-chips">${Object.keys(draft.playerTiers).map(t=>`<span>${t} <b>${counts[t]||0}</b></span>`).join('')}</div>`;}
  if(active==='ai')$('#config-summary').innerHTML=`<div class="summary-chips">${Object.entries(draft.ai.tiers).map(([level,tier])=>`<span>${level==='veryeasy'?'Very Easy':level[0].toUpperCase()+level.slice(1)} · ${tier} · <b>${clubs.filter(c=>c.tier===tier&&c.formations.length).length} clubs</b></span>`).join('')}<span>Impossible · <b>${data.players.filter(p=>overallRating(p,true,p.primaryPosition)>=draft.ai.impossibleOverall).length} eligible players</b></span></div>`;
 }catch(e){status(e.message,true);}
}
function oddsData(){const leagues=draftLeagues(data).filter(l=>leagueWeight(l)>0&&(!['A','B','C'].includes(l.tier)||l.teams.some(t=>teamWeight(t)>0))),total=leagues.reduce((n,l)=>n+leagueWeight(l),0);return {leagues,total};}
async function renderOdds(){
 $('#config-fields').textContent='Loading…';const selected=active;try{await catalog();if(selected!==active)return;setRuntimeConfig(draft);const {leagues,total}=oddsData();
 if(active==='leagues'){
  const query=$('#config-search').value.toLowerCase(),rows=data.leagues.filter(l=>(l.name+' '+l.id).toLowerCase().includes(query));
  $('#config-fields').innerHTML=`<div class="config-table"><table><thead><tr><th>League</th><th>Players</th><th>Multiplier</th><th>Draw chance</th></tr></thead><tbody>${rows.map(l=>{const f=CONFIG_FIELDS.find(f=>f.path==='draft.leagueOverrides.'+l.id);return `<tr data-league="${l.id}"><td><strong>${l.tier} · ${esc(l.name)}</strong></td><td>${l.playerCount}</td><td>${input(f)}</td><td data-odds></td></tr>`;}).join('')}</tbody></table></div>`;
 }else{
  const choices=data.leagues.filter(l=>l.available);if(!clubLeague)clubLeague=choices[0].id;const league=leagues.find(l=>l.id===clubLeague)||draftLeagues(data).find(l=>l.id===clubLeague);
  const clubs=(league?.teams||[]).filter(t=>(t.name+' '+t.id).toLowerCase().includes((clubQuery||$('#config-search').value).toLowerCase())).sort((a,b)=>b.overall-a.overall);
  $('#config-fields').innerHTML=`<div class="odds-filters"><select id="odds-league" aria-label="League">${choices.map(l=>`<option value="${l.id}"${l.id===clubLeague?' selected':''}>${l.tier} · ${esc(l.name)}</option>`).join('')}</select><input id="odds-club-search" type="search" placeholder="Find a club" value="${esc(clubQuery)}" aria-label="Find a club"></div><div class="config-table"><table><thead><tr><th>Club</th><th>Median OVR</th><th>Players</th><th>Multiplier</th><th>Club chance</th></tr></thead><tbody>${clubs.slice(0,clubLimit).map(t=>`<tr data-club="${t.id}"><td><strong>${t.tier} · ${esc(t.name)}</strong></td><td>${t.overall.toFixed(2)}</td><td>${t.players.length}</td><td>${input(CONFIG_FIELDS.find(f=>f.path==='draft.clubOverrides.'+t.id))}</td><td data-odds></td></tr>`).join('')}</tbody></table></div>${clubs.length>clubLimit?'<button id="more-club-odds" type="button">Show more</button>':''}`;
  $('#odds-league').onchange=e=>{clubLeague=e.target.value;clubLimit=40;renderOdds();};$('#odds-club-search').onchange=e=>{clubQuery=e.target.value;clubLimit=40;renderOdds();};if($('#more-club-odds'))$('#more-club-odds').onclick=()=>{clubLimit+=40;renderOdds();};
 }
 bindInputs();refreshOdds();
 }catch(e){$('#config-fields').textContent='';status(e.message,true);}
}
function refreshOdds(){if(!data)return;const {leagues,total}=oddsData();
 document.querySelectorAll('[data-league]').forEach(row=>{const l=leagues.find(l=>l.id===row.dataset.league);row.querySelector('[data-odds]').textContent=(l?leagueWeight(l)/total*100:0).toFixed(3)+'%';});
 const l=leagues.find(l=>l.id===clubLeague)||draftLeagues(data).find(l=>l.id===clubLeague),sum=l?.teams.reduce((n,t)=>n+teamWeight(t),0)||0;
 document.querySelectorAll('[data-club]').forEach(row=>{const t=l.teams.find(t=>t.id===row.dataset.club);row.querySelector('[data-odds]').textContent=['D','F'].includes(l.tier)?'No club spin':(sum?teamWeight(t)/sum*100:0).toFixed(3)+'%';});
}
$('#config-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(render,180);};
$('#config-save').onclick=()=>{try{const invalid=[...document.querySelectorAll('[data-setting]')].find(n=>!n.validity.valid||n.type==='number'&&n.value==='');if(invalid){invalid.reportValidity();invalid.focus();throw Error('Correct the highlighted setting before saving.');}draft=saveConfig(draft);setRuntimeConfig(draft);status('Saved. New games will use these settings.');}catch(e){status(e.message,true);}};
$('#config-reset-section').onclick=()=>{const match=sections.find(s=>s[0]===active)[3];for(const f of CONFIG_FIELDS.filter(f=>match(f.path)))setConfigValue(draft,f.path,f.defaultValue);try{setRuntimeConfig(draft);render();status('Section reset. Save to apply.');}catch(e){render();status(e.message,true);}};
$('#config-reset-all').onclick=()=>{draft=structuredClone(DEFAULT_CONFIG);setRuntimeConfig(draft);render();status('Defaults restored. Save to apply.');};
$('#config-export').onclick=()=>{try{const value=normalizeConfig(draft),blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='football-draft-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message,true);}};
$('#config-import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>1000000)throw Error('Choose a settings JSON under 1 MB.');draft=normalizeConfig(JSON.parse(await file.text()));setRuntimeConfig(draft);render();status('Imported. Save to apply.');}catch(e){status(e.message,true);}finally{e.target.value='';}};
render();

document.querySelector('.import-button').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#config-import').click();}};
