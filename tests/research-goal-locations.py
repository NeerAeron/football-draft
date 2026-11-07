import urllib.request,json,concurrent.futures,time,collections,pathlib,hashlib
import sys
ROOT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/flow-goal-research')
ROOT.mkdir(parents=True,exist_ok=True)
SHA='4b73468fc5b0f1950f9f66fada70ad3a4f9327cb'
BASE=f'https://raw.githubusercontent.com/hudl/open-data/{SHA}/'
COMPS=[('World Cup 2022',43,106),('Euro 2024',55,282)]
def fetch(path):
 for n in range(3):
  try:
   with urllib.request.urlopen(BASE+path,timeout=45) as r:return json.load(r)
  except Exception:
   if n==2:raise
   time.sleep(.5*(n+1))
tasks=[];meta={}
for name,cid,sid in COMPS:
 matches=fetch(f'data/matches/{cid}/{sid}.json');meta[name]={'matches':len(matches),'official_goals':sum(m['home_score']+m['away_score'] for m in matches),'match_url':BASE+f'data/matches/{cid}/{sid}.json'}
 (ROOT/f'matches-{cid}-{sid}.json').write_text(json.dumps(matches))
 tasks.extend((name,m['match_id']) for m in matches)
def process(task):
 name,mid=task;ev=fetch(f'data/events/{mid}.json');shots=[];own=collections.Counter()
 for e in ev:
  if e['type']['name'].startswith('Own Goal') and e['period']<=4:own[e['type']['name']]+=1
  if e['type']['name']=='Shot':
   s=e['shot'];shots.append({'competition':name,'match_id':mid,'event_id':e['id'],'period':e['period'],'minute':e['minute'],'location':e.get('location'),'goal':s['outcome']['name']=='Goal','outcome':s['outcome']['name'],'type':s['type']['name'],'body_part':s['body_part']['name'],'xg':s.get('statsbomb_xg')})
 return shots,dict(own)
shots=[];own_by_comp=collections.defaultdict(collections.Counter)
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 futures={pool.submit(process,t):t for t in tasks}
 for n,future in enumerate(concurrent.futures.as_completed(futures),1):
  name,mid=futures[future]
  rows,own=future.result();shots.extend(rows);own_by_comp[name].update(own)
  if n%20==0:print(f'downloaded {n}/{len(tasks)} matches',flush=True)
(ROOT/'shots.json').write_text(json.dumps({'source_commit':SHA,'competitions':meta,'own_goal_events':own_by_comp,'shots':shots}))
def inside(x,y):return x>=102 and 18<=y<=62
def depth(x):return '18+ units from goal' if x<102 else '12–18 units' if x<108 else '6–12 units' if x<114 else '0–6 units'
def width(y):return 'wide_left' if y<18 else 'left_box_side' if y<30 else 'central' if y<=50 else 'right_box_side' if y<=62 else 'wide_right'
def calc(name,rows):
 eligible=[s for s in rows if s['period']<=4 and s['type']!='Penalty'];missing=[s for s in eligible if not s['location']];located=[s for s in eligible if s['location']];goals=[s for s in located if s['goal']]
 tiles={};depths=['18+ units from goal','12–18 units','6–12 units','0–6 units'];widths=['wide_left','left_box_side','central','right_box_side','wide_right']
 for d in depths:
  tiles[d]={}
  for w in widths:
   cell=[s for s in located if depth(s['location'][0])==d and width(s['location'][1])==w];tiles[d][w]={'shots':len(cell),'goals':sum(s['goal'] for s in cell)}
 central=[s for s in goals if 30<=s['location'][1]<=50];box=[s for s in goals if inside(*s['location'])]
 return {'competition':name,'all_shot_events':len(rows),'shootout_shots_excluded':sum(s['period']>4 for s in rows),'penalty_shots_excluded':sum(s['period']<=4 and s['type']=='Penalty' for s in rows),'penalty_goals_excluded':sum(s['period']<=4 and s['type']=='Penalty' and s['goal'] for s in rows),'non_penalty_shots':len(eligible),'missing_locations':len(missing),'non_penalty_goals':len(goals),'box_goals':len(box),'outside_goals':len(goals)-len(box),'central_goals':len(central),'side_goals':len(goals)-len(central),'central_inside_box':sum(30<=s['location'][1]<=50 for s in box),'central_outside_box':sum(not inside(*s['location']) for s in central),'box_goal_pct':100*len(box)/len(goals),'central_goal_pct':100*len(central)/len(goals),'tiles':tiles}
summary={'source_commit':SHA,'definition':{'inside_penalty_area':'x >=102 and 18 <= y <=62','central_corridor':'30 <= y <=50','eligible':'Shot events with period<=4 and shot.type != Penalty; own-goal events excluded'},'competition_meta':meta,'own_goal_events':own_by_comp,'results':[calc(name,[s for s in shots if s['competition']==name]) for name,_,_ in COMPS]+[calc('Combined',shots)]}
(ROOT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2),flush=True)
