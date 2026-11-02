import os,sys,time,json,hashlib,subprocess,shlex,shutil,re,signal,pathlib
prepared=pathlib.Path('/private/tmp/warpdrive-privacy-observation25-rollback2-baseline-20261102')
root=pathlib.Path('/Users/ali/Developer/warpdrive')
assert len(sys.argv) in (2,3),'externally supplied fresh START authorization ID required'
aid=sys.argv[1]
assert re.fullmatch(r'PRIVACY-[A-Z0-9]+(?:-[A-Z0-9]+)*',aid),'invalid externally supplied START ID'
allow_warning2=len(sys.argv)==3
assert not allow_warning2 or sys.argv[2]=='--allow-warning2','unknown admission argument'
# Root may supply this flag ONLY from an explicit allocated Main warning2 grant.
# Root must verify fresh actual static319 PASS/source gate before requesting START.
# Invoke only after a fresh direct START; artifact preparation never invokes this runner.
p=prepared/aid
p.mkdir(exist_ok=False)
start=time.monotonic(); deadline=start+180; epoch=time.time()
def save(name,value): (p/name).write_text(json.dumps(value,indent=2)+'\n')
save('started.json',{'authorization':aid,'admissionStartedEpoch':epoch,'deadlineEpoch':epoch+180,'allowWarning2ExplicitGrant':allow_warning2,'state':'ADMISSION_CONSUMED'})
proc=None; out=None; own={}; samples=[]; abort=None; baseline=None; base_n=None; base_v=None; base_l=None
prep=None; context=None; raw_command=b''; command=''
denv=dict(os.environ,DOCKER_HOST='unix:///Users/ali/.colima/warpdrive/docker.sock',TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE='/var/run/docker.sock')
docker='/opt/homebrew/bin/docker'
images={'postgres:16-alpine':'sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab','testcontainers/ryuk:0.14.0':'sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0'}
def run(args,timeout=7,env=None):
 remaining=deadline-time.monotonic()
 assert remaining>0,'all-in deadline exhausted'
 r=subprocess.run(args,capture_output=True,text=True,timeout=min(timeout,remaining),env=env)
 assert r.returncode==0,(args,r.returncode,r.stderr[:500])
 return r.stdout.strip()
def d(*a):return run([docker,*a],env=denv)
def containers():return [json.loads(x) for x in d('ps','--all','--no-trunc','--format','{{json .}}').splitlines() if x]
def nv(kind):return sorted(d(kind,'ls','--format','{{json .}}').splitlines())
def metrics():
 level=int(run(['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level']))
 q=int(re.search(r'System-wide memory free percentage:\s*(\d+)%',run(['/usr/bin/memory_pressure','-Q'])).group(1))
 return {'level':level,'q':q,'freeBytes':shutil.disk_usage(root).free}
def repo_path(name):
 relative=pathlib.PurePosixPath(name)
 assert not relative.is_absolute() and '..' not in relative.parts,'non-relative pin path'
 path=root.joinpath(*relative.parts)
 assert path.resolve().is_relative_to(root.resolve()) and not path.is_symlink(),'pin path escaped Root'
 return path
def pins():
 assert prep is not None and context is not None,'pin context unavailable'
 broader=context['sourcePins']+context['configPins']
 assert len(context['sourcePins'])==context['sourceCount']==319 and len(context['configPins'])==8
 expected={x['path']:x['sha256'] for x in broader}
 assert len(expected)==327 and len(prep['sourcePins'])==16,'pin-set count/uniqueness mismatch'
 assert all(expected.get(x['path'])==x['sha256'] for x in prep['sourcePins']),'primary pins differ from broader context'
 return [{'path':x['path'],'expected':x['sha256'],'actual':hashlib.sha256(repo_path(x['path']).read_bytes()).hexdigest()} for x in broader]
def fileset():
 assert context is not None,'fileset context unavailable'
 excluded='src/features/privacy/messages/privacyRequest.en.d.json.ts'
 assert context['excludedGeneratedFile']==excluded,'generated exclusion changed'
 expected=sorted(x['path'] for x in context['sourcePins'])
 assert all(x.startswith('src/features/privacy/') for x in expected),'unexpected source scope'
 actual=[]
 for parent,dirs,files in os.walk(root/'src/features/privacy',followlinks=False):
  assert all(not (pathlib.Path(parent)/n).is_symlink() for n in dirs+files),'source fileset symlink'
  actual.extend((pathlib.Path(parent)/n).relative_to(root).as_posix() for n in files)
 actual=sorted(x for x in actual if x!=excluded)
 return {'expectedCount':len(expected),'actualCount':len(actual),'matches':actual==expected,'excludedGeneratedFile':excluded,'added':sorted(set(actual)-set(expected)),'missing':sorted(set(expected)-set(actual))}
def dotfiles():
 names=['.env','.env.local']+[f'.env.{mode}{suffix}' for mode in ('test','development','production') for suffix in ('','.local')]
 return [n for n in names if os.path.lexists(root/n)]
def processes():return run(['/bin/ps','-axo','pid=,ppid=,pgid=,rss=']).splitlines()
def listeners():
 # Normal global port snapshot only: never target a workspace, file or excluded process.
 raw=run(['/usr/sbin/lsof','-nP','-iTCP','-sTCP:LISTEN','-Fpcn'])
 pid=None; command_name=None; rows=[]
 for line in raw.splitlines():
  if line.startswith('p'):pid=int(line[1:]);command_name=None
  elif line.startswith('c'):command_name=line[1:]
  elif line.startswith('n'):
   assert pid is not None and command_name is not None,'unrecognized listener record'
   rows.append((pid,command_name,line[1:]))
 return sorted(set(rows))
def group():
 if proc is None:return []
 found=[]
 for line in run(['/bin/ps','-axo','pid=,pgid=,rss=']).splitlines():
  a=line.split()
  if len(a)==3 and int(a[1])==proc.pid:found.append({'pid':int(a[0]),'rssKiB':int(a[2])})
 return found
base_ids=set()
def inspect_new(rows):
 if baseline is None:return
 for c in rows:
  cid=c['ID']
  if cid in base_ids or cid in own:continue
  try:x=json.loads(d('inspect',cid))[0]
  except AssertionError:
   if not any(x['ID']==cid for x in containers()):continue
   raise
  labels=x['Config'].get('Labels') or {};sess=labels.get('org.testcontainers.session-id')
  if sess and x['Image'] in images.values():own[cid]={'session':sess,'image':x['Image']}
  elif sess:raise RuntimeError('unexpected new Testcontainers image; ownership uncertain')
 if len(own)>2 or len({x['session'] for x in own.values()})>1:raise RuntimeError('multiple Testcontainers owners; ownership uncertain')
try:
 raw_preparation=(prepared/'preparation.json').read_bytes()
 assert hashlib.sha256(raw_preparation).hexdigest()=='616be981e9fc1496bd044e40efc9269746d58a178930b3406b4b4ee2c75f0d10','exact Main preparation hash'
 prep=json.loads(raw_preparation);context=json.loads((prepared/'context.json').read_text())
 assert prep['workspace']==context['workspace']==str(root) and prep['sourceCountCases']==27 and len(prep['selection'])==5
 assert prep['fullSourceReference']==str(prepared/'context.json')
 raw_command=(prepared/'command.txt').read_bytes();command=raw_command.decode()
 board=pathlib.Path('/Users/ali/Documents/Codex/2026-10-31/warpdrive-settings-ux/WARPDRIVE-QUEUE.md').read_text()
 block=board.split('## Current heavy authorization',1)[1].split('## Next ready work',1)[0]
 assert re.search(r'(?<![A-Z0-9-])'+re.escape(aid)+r'(?![A-Z0-9-])',block) and '01a19263-11f1-7e30-adfb-e418eb02876e' in block and re.search(r'\bSTART\b',block),'fresh exact matching START board required'
 assert hashlib.sha256(raw_command).hexdigest()==prep['commandSha256']=='0c53feb4314a9c8655bcc553ec9af5a78acc617553d2ced43926d7b95fb72672','exact command file hash'
 assert 'BUN_OPTIONS=--no-env-file' in command and '--no-env-file --bun' in command
 assert hashlib.sha256((root/'.runtime/bin/bun').read_bytes()).hexdigest()=='0a2237cdcfa0d16ef501d9acca9f0026309ef348bea7393a64e8d1e3609565cc'
 assert run([str(root/'.runtime/bin/bun'),'--version'])=='1.4.4'
 cfg=root/'.runtime/handoffs/privacy-validation-20261102/vitest.isolated.config.ts'
 assert hashlib.sha256(cfg.read_bytes()).hexdigest()=='1d4422547b76f9d92c1ee56c2db75637ce819b2129e2736322b306164f5916bf'
 assert not dotfiles(),'dotenv present'
 pp=pins();fs=fileset();assert all(x['actual']==x['expected'] for x in pp) and fs['matches'],'pin/fileset mismatch'
 m=metrics();assert ((m['level']==1 and m['q']>=20) or (allow_warning2 and m['level']==2 and m['q']>=40)) and m['freeBytes']>=8*1024**3,m
 for name,sha in images.items():assert d('image','inspect',name,'--format','{{.Id}}')==sha,(name,'cached image mismatch')
 baseline=containers();base_ids={x['ID'] for x in baseline};base_n=nv('network');base_v=nv('volume');base_l=listeners();base_p=processes()
 save('preflight.json',{'authorization':aid,'epoch':time.time(),'metrics':m,'pins':pp,'fileset':fs,'foreignContainers':baseline,'networks':base_n,'volumes':base_v,'listeners':base_l,'processes':base_p,'commandFileSha256':hashlib.sha256(raw_command).hexdigest(),'expectedSourceCases':27,'expectedLiteralFiles':5,'expectedCasesByPurpose':{'observationPreservationAndControls':25,'rollbackAckAbortBaseline':2},'actualCollection':'NOT_OBSERVED_AT_PREFLIGHT','staticSourceGatePrerequisite':'Root verifies fresh actual static319 PASS/source gate before START; runner does not infer that proof','allowWarning2ExplicitGrant':allow_warning2,'images':images,'dotenvAbsent':True,'boardSha256':hashlib.sha256(board.encode()).hexdigest()})
 assert time.monotonic()<deadline-25,'cleanup reserve reached during admission'
 out=open(p/'result.log','w')
 proc=subprocess.Popen(shlex.split(command),cwd=root,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
 save('started.json',{'authorization':aid,'admissionStartedEpoch':epoch,'deadlineEpoch':epoch+180,'executionStartedEpoch':time.time(),'pid':proc.pid,'pgid':proc.pid,'allowWarning2ExplicitGrant':allow_warning2,'state':'RUNNING'})
 while proc.poll() is None:
  if time.monotonic()>deadline-25:raise RuntimeError('cleanup reserve reached')
  m=metrics();assert m['level'] in (1,2) and m['q']>=30 and m['freeBytes']>=8*1024**3,m
  rows=containers();inspect_new(rows);g=group();rss=sum(x['rssKiB'] for x in g)
  for cid in own:
   if any(x['ID']==cid and x['State']=='running' for x in rows):
    top=subprocess.run([docker,'top',cid,'-eo','pid,rss,comm'],capture_output=True,text=True,timeout=min(7,max(.1,deadline-time.monotonic())),env=denv)
    if top.returncode != 0:
     still_running=any(x['ID']==cid and x['State']=='running' for x in containers())
     if still_running:raise RuntimeError('owned running container RSS observation failed: '+top.stderr[:500])
     continue
    for line in top.stdout.splitlines()[1:]:
     a=line.split()
     if len(a)>=2 and a[1].isdigit():rss+=int(a[1])
  assert rss<2*1024**2,('owned RSS KiB',rss)
  samples.append({'elapsedSeconds':time.monotonic()-start,'metrics':m,'conservativeOwnedRssKiB':rss,'group':g})
  time.sleep(.3)
 proc.wait()
except BaseException as e:abort=repr(e)
finally:
 if proc is not None and proc.poll() is None:
  os.killpg(proc.pid,signal.SIGTERM)
  try:proc.wait(timeout=min(8,max(.1,deadline-time.monotonic())))
  except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=3)
 if out is not None:out.close()
 terminal={'authorization':aid,'exitCode':proc.returncode if proc else None,'abort':abort,'terminalElapsedSeconds':time.monotonic()-start,'samples':samples,'ownedContainers':own,'expectedSourceCases':27,'expectedLiteralFiles':5,'actualCollection':'NOT_PARSED_SEE_RESULT_LOG','expectedCasesByPurpose':{'observationPreservationAndControls':25,'rollbackAckAbortBaseline':2}}
 save('terminal.json',terminal)
 try:
  live=[]
  while time.monotonic()<deadline-8:
   rows=containers();inspect_new(rows);live=[x for x in rows if x['ID'] in own];g=group()
   if not live and not g:break
   time.sleep(.3)
  if live:
   for c in live:
    try:x=json.loads(d('inspect',c['ID']))[0]
    except AssertionError:
     if not any(x['ID']==c['ID'] for x in containers()):continue
     raise
    labels=x['Config'].get('Labels') or {}
    assert labels.get('org.testcontainers.session-id')==own[c['ID']]['session'] and x['Image']==own[c['ID']]['image'],'cleanup owner mismatch'
    d('rm','-f',c['ID'])
  rows=containers();pp=pins();fs=fileset();m=metrics();n=nv('network');v=nv('volume');l=listeners();g=group()
  post={'authorization':aid,'totalElapsedSeconds':time.monotonic()-start,'withinAllInDeadline':time.monotonic()<=deadline,'cleanupComplete':not any(x['ID'] in own for x in rows) and not g,'foreignStatesPreserved':({x['ID']:x['State'] for x in rows if x['ID'] in base_ids}=={x['ID']:x['State'] for x in baseline}) if baseline is not None else None,'foreignContainers':rows,'networksPreserved':n==base_n if base_n is not None else None,'volumesPreserved':v==base_v if base_v is not None else None,'listenersPreserved':l==base_l if base_l is not None else None,'listeners':l,'pinsPreserved':all(x['actual']==x['expected'] for x in pp),'pins':pp,'fileset':fs,'filesetPreserved':fs['matches'],'metrics':m,'group':g,'dotenvAbsent':not dotfiles()}
  save('postflight.json',post)
 except BaseException as e:
  post={'cleanupComplete':False,'cleanupError':repr(e),'totalElapsedSeconds':time.monotonic()-start};save('postflight.json',post)
 (p/'exit-code.txt').write_text(str(proc.returncode if proc else 'ADMISSION_FAILED')+'\n')
 log=(p/'result.log').read_text() if (p/'result.log').exists() else ''
 plain=re.sub(r'\x1b\[[0-9;]*m','',log);(p/'result-plain.log').write_text(plain)
 print(json.dumps({'evidenceDirectory':str(p),'terminal':{k:v for k,v in terminal.items() if k!='samples'},'postflight':{k:v for k,v in post.items() if k not in ('pins','foreignContainers','listeners')},'maxSampledRssKiB':max([x['conservativeOwnedRssKiB'] for x in samples],default=0),'minSampledQ':min([x['metrics']['q'] for x in samples],default=None)},indent=2))
 print(plain[-18000:])

# Collection and behavioral classification require the actual log, including setup controls.
# An exit1 may be a genuine ACK baseline RED or another failure; never infer its cause.
checks=('withinAllInDeadline','cleanupComplete','foreignStatesPreserved','networksPreserved','volumesPreserved','listenersPreserved','pinsPreserved','filesetPreserved','dotenvAbsent')
receipt={'authorization':aid,'evidenceDirectory':str(p),'commandExitCode':proc.returncode if proc else None,'abort':abort,'expectedSourceCases':27,'expectedLiteralFiles':5,'expectedCasesByPurpose':{'observationPreservationAndControls':25,'rollbackAckAbortBaseline':2},'actualCollection':'NOT_PARSED_SEE_RESULT_LOG','classification':'REQUIRES_ACTUAL_LOG_AND_CONTROL_REVIEW','postflight':{k:v for k,v in post.items() if k not in ('pins','foreignContainers','listeners')},'maxSampledRssKiB':max([x['conservativeOwnedRssKiB'] for x in samples],default=0),'minSampledQ':min([x['metrics']['q'] for x in samples],default=None),'allowWarning2ExplicitGrant':allow_warning2,'installedAcceptance':False,'installedGatesOpen':12,'staging':'none yet'}
save('receipt.json',receipt)
sys.exit(0 if proc is not None and proc.returncode==0 and abort is None and all(post.get(k) is True for k in checks) else 1)
