import urllib.request, json, concurrent.futures, collections, pathlib, time, sys
ROOT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/flow-rule-reference')
ROOT.mkdir(parents=True,exist_ok=True)
SHA='4b73468fc5b0f1950f9f66fada70ad3a4f9327cb'
BASE=f'https://raw.githubusercontent.com/hudl/open-data/{SHA}/'
COMPS=[('World Cup 2022',43,106),('Euro 2024',55,282)]
def fetch(mid):
 for n in range(4):
  try:
   with urllib.request.urlopen(BASE+f'data/events/{mid}.json',timeout=35) as r:return json.load(r)
  except Exception:
   if n==3:raise
   time.sleep(.5*(n+1))
tasks=[]
for name,cid,sid in COMPS:
 with urllib.request.urlopen(BASE+f'data/matches/{cid}/{sid}.json',timeout=35) as response: matches=json.load(response)
 for m in matches:tasks.append((name,m['match_id']))
def process(task):
 name,mid=task; events=fetch(mid); c=collections.Counter(matches=1); foultypes=collections.Counter(); shotoutcomes=collections.Counter(); rows=[]
 for e in events:
  typ=e['type']['name']
  if e['period']>4:continue
  if e['period']>2:c['has_extra_time']=1
  if typ=='Foul Committed':
   f=e.get('foul_committed',{});c['fouls']+=1;c['fouls_advantage']+=bool(f.get('advantage'));c['penalties_awarded']+=bool(f.get('penalty'));c['fouls_offensive']+=bool(f.get('offensive'));foultypes[f.get('type',{}).get('name','unspecified')]+=1
   if f.get('penalty'):rows.append({'match_id':mid,'id':e['id'],'minute':e['minute'],'kind':'penalty_awarded','data':f})
  if typ=='Foul Won':c['penalties_won']+=bool(e.get('foul_won',{}).get('penalty'))
  if typ=='Offside':c['offsides_non_pass']+=1
  if typ=='Pass':
   p=e['pass'];o=p.get('outcome',{}).get('name','Complete');c['passes']+=1;c['completed_passes']+=o=='Complete';c['offsides_pass']+=o=='Pass Offside';c['incomplete_passes']+=o=='Incomplete';c['out_passes']+=o=='Out';c['through_balls']+=p.get('technique',{}).get('name')=='Through Ball';c['crosses']+=bool(p.get('cross'))
  if typ=='Dribble':c['dribble_attempts']+=1;c['dribble_failures']+=e['dribble']['outcome']['name']=='Incomplete'
  if typ=='Dispossessed':c['dispossessed']+=1
  if typ=='Miscontrol':c['miscontrols']+=1
  if typ=='Duel' and e.get('duel',{}).get('type',{}).get('name')=='Tackle':c['tackles']+=1
  if typ=='Shot':
   s=e['shot'];o=s['outcome']['name'];pen=s['type']['name']=='Penalty';c['shots']+=1;c['non_penalty_shots']+=not pen;shotoutcomes[o]+=1
   sot=s['outcome']['id'] in (97,100,116);c['shots_on_target']+=sot;c['non_penalty_on_target']+=sot and not pen;c['goals']+=o=='Goal';c['penalty_shots']+=pen;c['penalty_goals']+=pen and o=='Goal';c['headed_shots']+=s['body_part']['name']=='Head';c['headed_goals']+=s['body_part']['name']=='Head' and o=='Goal'
   if pen:rows.append({'match_id':mid,'id':e['id'],'minute':e['minute'],'kind':'penalty_shot','outcome':o})
 c['offsides']=c['offsides_pass']+c['offsides_non_pass'];c['foul_stoppages']=c['fouls']-c['fouls_advantage']
 return {'competition':name,'match_id':mid,'counts':dict(c),'foul_types':dict(foultypes),'shot_outcomes':dict(shotoutcomes),'penalty_events':rows}
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 for i,r in enumerate(pool.map(process,tasks),1):
  results.append(r)
  if i%20==0:print(f'downloaded {i}/{len(tasks)}',flush=True)
(ROOT/'matches.json').write_text(json.dumps({'source_commit':SHA,'matches':results}))
output={}
for name in [x[0] for x in COMPS]+['Combined']:
 ms=[m for m in results if name=='Combined' or m['competition']==name];c=collections.Counter();s=collections.Counter();f=collections.Counter()
 for m in ms:c.update(m['counts']);s.update(m['shot_outcomes']);f.update(m['foul_types'])
 rates={k:v/len(ms) for k,v in c.items() if k not in ('matches','has_extra_time')}
 ratios={'sot_fraction':c['shots_on_target']/c['shots'],'non_penalty_sot_fraction':c['non_penalty_on_target']/c['non_penalty_shots'],'penalty_conversion':c['penalty_goals']/c['penalty_shots'],'foul_stoppages_per_pass':c['foul_stoppages']/c['passes'],'offsides_per_pass':c['offsides_pass']/c['passes'],'pass_completion':c['completed_passes']/c['passes'],'dribble_failure':c['dribble_failures']/c['dribble_attempts']}
 output[name]={'counts':dict(c),'per_match':rates,'ratios':ratios,'shot_outcomes':dict(s),'foul_types':dict(f)}
(ROOT/'summary.json').write_text(json.dumps(output,indent=2));print(json.dumps(output,indent=2))
