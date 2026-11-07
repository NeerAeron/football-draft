import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {dirname} from 'node:path';
import {ATTRS,POSITIONS,normalizeAttributes,overallRating,playerTier} from '../app/ratings.js';
import {makeIdentity} from '../app/player-model.js';
import {TAGS} from '../app/traits.js';
import {compileBadges} from '../app/badges.js';

export const COMPILER_VERSION='1.7.0';
export const SOURCE_URL='https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data';
const bound=(v,a=.05,b=.95)=>Math.max(a,Math.min(b,v));
const fields={pace:'movement_sprint_speed',acceleration:'movement_acceleration',shooting:'attacking_finishing',power:'power_shot_power',longShots:'power_long_shots',penalties:'mentality_penalties',heading:'attacking_heading_accuracy',shortPassing:'attacking_short_passing',longPassing:'skill_long_passing',crossing:'attacking_crossing',vision:'mentality_vision',dribbling:'skill_dribbling',control:'skill_ball_control',composure:'mentality_composure',defending:'defending_standing_tackle',stamina:'power_stamina',strength:'power_strength'};
export function parseCSV(text){
 text=text.replace(/^\uFEFF/,'');const records=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(quoted||field==='')quoted=!quoted;else throw new Error('Unexpected quote in CSV field');}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v!==''))records.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw new Error('Unclosed quoted CSV field');
 if(field!==''||row.length){row.push(field);records.push(row);}
 const header=records.shift();if(!header||new Set(header).size!==header.length)throw new Error('Missing or duplicate CSV headers');
 return records.map((r,i)=>{if(r.length!==header.length)throw new Error(`CSV row ${i+2}: expected ${header.length} fields, got ${r.length}`);return Object.fromEntries(header.map((k,j)=>[k,r[j]]));});
}
function number(row,key,min=1,max=99){const raw=row[key],n=Number(raw);if(raw==null||String(raw).trim()===''||!Number.isFinite(n)||!Number.isInteger(n)||n<min||n>max)throw new Error(`${row.player_id||'Unknown player'}: invalid ${key}`);return n;}
const roleAlias={CDM:'DM',CAM:'AM',CF:'ST',LWB:'LB',RWB:'RB'};
function positions(row){const p=[...new Set(row.player_positions.split(',').map(s=>s.trim()).filter(Boolean).map(s=>roleAlias[s]||s))];if(!p.length||p.some(s=>!POSITIONS.includes(s)))throw new Error(`${row.player_id}: unsupported position`);return p;}
function words(value=''){return value.split(',').map(s=>s.replace(/\s+/gu,' ').trim()).filter(Boolean);}
const traitMap={'Finesse Shot':'curve','Power Shot':'power','Incisive Pass':'through','Whipped Pass':'crosser','Technical':'dribbler','First Touch':'control','Press Proven':'pressescape','Trickster':'slalom','Quick Step':'speedster','Rapid':'speedster','Tiki Taka':'onetouch','Intercept':'interceptor','Jockey':'marker','Anticipate':'marker','Bruiser':'ballwinner','Enforcer':'ballwinner','Rush Out':'gkoneonone','Far Reach':'gkreach','Long Ball Pass':'longball','Precision Header':'heading','Acrobatic':'volley','Aerial Fortress':'heading','Trivela':'curve','Low Driven Shot':'finisher'};
const labelMap={'#Dribbler':'dribbler','#Playmaker':'vision','#Clinical finisher':'finisher','#Distance shooter':'longshot','#Crosser':'crosser','#Speedster':'speedster','#Tackling':'ballwinner','#Tactician':'interceptor'};
export function compilePlayer(row,sourceRow){
 if(!/^\d+$/.test(row.player_id||''))throw new Error('Invalid player ID');
 const [primaryPosition,...secondaryPositions]=positions(row),attrs={};
 for(const [key,source] of Object.entries(fields))attrs[key]=number(row,source);
 attrs.awareness=Math.round(number(row,'defending_marking_awareness')*.70+number(row,'movement_reactions')*.30);
 attrs.goalkeeping=primaryPosition==='GK'?number(row,'overall'):Math.round(['diving','handling','kicking','positioning','reflexes'].reduce((s,k)=>s+number(row,`goalkeeping_${k}`),0)/5);
 const foot=row.preferred_foot?.toLowerCase();if(!['left','right'].includes(foot))throw new Error(`${row.player_id}: invalid foot`);
 const weakFoot=[0,15,35,60,82,100][number(row,'weak_foot',1,5)];
 const normalized=normalizeAttributes(attrs),identity=makeIdentity(primaryPosition,0,()=>.5,normalized);
 const tendencies={...identity.tendencies};
 tendencies.carry=bound(tendencies.carry+(attrs.dribbling-attrs.shortPassing)*.003);
 tendencies.risk=bound(tendencies.risk+(attrs.vision-65)*.0015);
 tendencies.aggression=bound(number(row,'mentality_aggression')/100);
 tendencies.advance=bound(tendencies.advance+(attrs.pace+attrs.acceleration-140)*.0025+(number(row,'mentality_positioning')-65)*.002);
 tendencies.hold=bound(tendencies.hold+(attrs.awareness-attrs.shooting)*.002-(attrs.pace+attrs.acceleration-140)*.001);
 tendencies.inside=bound(tendencies.inside+(number(row,'skill_curve')-attrs.crossing)*.002);
 tendencies.discipline=.70; // No source discipline or work-rate data: explicit neutral prior.
 tendencies.timing=bound(.40+number(row,'mentality_positioning')*.004);
 tendencies.shoot=bound(tendencies.shoot+(Math.max(attrs.shooting,attrs.longShots)-attrs.shortPassing)*.002);
 if(['LB','RB'].includes(primaryPosition))tendencies.overlap=bound(.45+(attrs.crossing-attrs.defending)*.006+(attrs.stamina-70)*.002);
 for(const key in tendencies)tendencies[key]=Math.round(tendencies[key]*1000)/1000;
 const candidates=new Map(),traitEvidence=[];
 const add=(tag,confidence,evidence)=>{if(tag&&(!candidates.has(tag)||candidates.get(tag).confidence<confidence))candidates.set(tag,{tag,confidence,evidence});};
 for(const label of words(row.player_traits)){const plus=/\s*\+$/.test(label),base=label.replace(/\s*\+$/,'');let tag=traitMap[base];
  if(primaryPosition==='GK'&&base==='Cross Claimer')tag='safehands';
  if(base==='Relentless'&&primaryPosition!=='GK'&&attrs.stamina>=80)tag='engine';
  if(base==='Precision Header')tag='heading';
  if(base==='Long Ball Pass'&&primaryPosition==='GK')tag='distributor';
  if(base==='Tiki Taka'&&primaryPosition!=='GK')add('givego',.84,'Combination movement inferred from '+label);
  add(tag,plus?.98:.90,label);traitEvidence.push({name:base,plus,mappedTag:tag||null});
 }
 for(const label of words(row.player_tags))add(labelMap[label],.80,label);
 const identityProfile={attrs:normalized,primaryPosition,role:primaryPosition,tendencies,foot},selected=compileBadges(identityProfile,[...candidates.values()]);
 const profile={profileId:`ea:${row.player_id}:fc${row.fifa_version}:u${row.fifa_update}`,sourcePlayerId:row.player_id,name:row.short_name?.trim()||row.long_name?.trim(),fullName:row.long_name,primaryPosition,secondaryPositions,attrs:{...normalized},foot,weakFoot,tendencies,tags:selected.map(t=>t.tag),sourceOverall:number(row,'overall'),source:{compilerVersion:COMPILER_VERSION,url:SOURCE_URL,license:'CC BY 4.0',row:sourceRow,edition:`FC ${row.fifa_version}`,update:row.fifa_update,asOf:row.fifa_update_date,club:row.club_name||null,clubId:row.club_team_id||null,leagueId:row.league_id||null,leagueName:row.league_name||null,leagueLevel:row.league_level?Number(row.league_level):null,nationality:row.nationality_name,jerseyNumber:row.club_jersey_number?Number(row.club_jersey_number):null,traits:traitEvidence},inference:{awareness:'70% defensive awareness + 30% reactions',tendencies:'Position and ability priors; work rate unavailable; discipline neutral',badges:selected}};
 if(!profile.name)throw new Error(`${row.player_id}: missing name`);
 for(const tag of profile.tags)if(!TAGS.some(t=>t.id===tag))throw new Error(`Unknown compiled tag ${tag}`);
 profile.overall=overallRating({...profile,role:primaryPosition});return profile;
}
export function compileRows(rows,{first=1000,goalkeepers=100,sourceHash=null}={}){
 const seen=new Set();rows.forEach((r,i)=>{if(seen.has(r.player_id))throw new Error(`Duplicate player ID ${r.player_id} at row ${i+1}`);seen.add(r.player_id);});
 const keepers=rows.map((row,index)=>({row,index})).filter(({row})=>positions(row)[0]==='GK').slice(0,goalkeepers);
 const selected=new Map(rows.slice(0,first).map((row,index)=>[row.player_id,{row,index}]));for(const item of keepers)selected.set(item.row.player_id,item);
 const players=[...selected.values()].map(({row,index})=>{const profile=compilePlayer(row,index+1);profile.source.sha256=sourceHash;return profile;});
 return {schemaVersion:1,compilerVersion:COMPILER_VERSION,source:{url:SOURCE_URL,author:'rovnez',upstream:'SoFIFA / EA SPORTS FC 26',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',sha256:sourceHash,asOf:players[0]?.source.asOf},selection:{firstRows:first,firstGoalkeepers:goalkeepers,keeperOrder:'Source CSV order',sourceRows:rows.length},attributeKeys:Object.keys(ATTRS),players};
}
async function main(){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('Usage: node scripts/compile-players.mjs SOURCE.csv OUTPUT.json');
 const bytes=await readFile(input),catalog=compileRows(parseCSV(bytes.toString('utf8')),{sourceHash:createHash('sha256').update(bytes).digest('hex')});
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(catalog)+'\n');
 console.log(JSON.stringify({players:catalog.players.length,keepers:catalog.players.filter(p=>p.primaryPosition==='GK').length,sourceRows:catalog.selection.sourceRows,output,compilerVersion:COMPILER_VERSION}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
