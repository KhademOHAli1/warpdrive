import os,sys,time,json,hashlib,subprocess,shutil,re,signal,pathlib
prepared=pathlib.Path('/private/tmp/warpdrive-privacy-current-cut-compiler-v5-319-20261102')
root=pathlib.Path('/Users/ali/Developer/warpdrive')
assert len(sys.argv) in (2,3),'externally supplied fresh START ID required'
aid=sys.argv[1]
assert re.fullmatch(r'PRIVACY-[A-Z0-9]+(?:-[A-Z0-9]+)*',aid),'invalid external authorization ID'
allow_warning2=len(sys.argv)==3
assert not allow_warning2 or sys.argv[2]=='--allow-warning2','unknown admission argument'
# Root may supply this flag ONLY from an explicit fresh Main START warning2 grant.
# Preparing this artifact never invokes its commands or obtains authorization.
p=prepared/aid
p.mkdir(exist_ok=False)
start=time.monotonic();deadline=start+180;epoch=time.time()
def save(name,value): (p/name).write_text(json.dumps(value,indent=2)+'\n')
save('started.json',{'authorization':aid,'admissionStartedEpoch':epoch,'deadlineEpoch':epoch+180,'allowWarning2ExplicitGrant':allow_warning2,'state':'ADMISSION_CONSUMED'})
proc=None;out=None;abort=None;prep=None;phases=[];samples=[];groups=[]
baseline=None;base_n=None;base_v=None;base_l=None;raw_commands=b''
denv=dict(os.environ,DOCKER_HOST='unix:///Users/ali/.colima/warpdrive/docker.sock',TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE='/var/run/docker.sock')
docker='/opt/homebrew/bin/docker'
def run(args,timeout=7,env=None):
 remaining=deadline-time.monotonic()
 assert remaining>0,'all-in deadline exhausted'
 r=subprocess.run(args,capture_output=True,text=True,timeout=min(timeout,remaining),env=env)
 assert r.returncode==0,(args,r.returncode,r.stderr[:500])
 return r.stdout.strip()
def d(*a):return run([docker,*a],env=denv)
def containers():return [json.loads(x) for x in d('ps','--all','--no-trunc','--format','{{json .}}').splitlines() if x]
def states(rows):return {x['ID']:x['State'] for x in rows}
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
 assert prep is not None,'pin preparation unavailable'
 assert len(prep['sourcePins'])==prep['privacySourceCount']==319 and len(prep['configPins'])==8,'pin count mismatch'
 broader=prep['sourcePins']+prep['configPins']
 assert len({x['path'] for x in broader})==327,'pin uniqueness mismatch'
 return [{'path':x['path'],'expected':x['sha256'],'actual':hashlib.sha256(repo_path(x['path']).read_bytes()).hexdigest()} for x in broader]
def fileset():
 assert prep is not None,'fileset preparation unavailable'
 excluded='src/features/privacy/messages/privacyRequest.en.d.json.ts'
 assert prep['excludedGeneratedFile']==excluded,'generated exclusion changed'
 expected=sorted(x['path'] for x in prep['sourcePins'])
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
 # Normal global port snapshot only; never target a workspace or file.
 raw=run(['/usr/sbin/lsof','-nP','-iTCP','-sTCP:LISTEN','-Fpcn'])
 pid=None;command_name=None;rows=[]
 for line in raw.splitlines():
  if line.startswith('p'):pid=int(line[1:]);command_name=None
  elif line.startswith('c'):command_name=line[1:]
  elif line.startswith('n'):
   assert pid is not None and command_name is not None,'unrecognized listener record'
   rows.append((pid,command_name,line[1:]))
 return sorted(set(rows))
def group(pgid):
 found=[]
 for line in run(['/bin/ps','-axo','pid=,pgid=,rss=']).splitlines():
  a=line.split()
  if len(a)==3 and int(a[1])==pgid:found.append({'pid':int(a[0]),'rssKiB':int(a[2])})
 return found
def owned_groups():return [{'pgid':pgid,'processes':group(pgid)} for pgid in groups]
def close_group(child):
 # Signal only the exact process group created for this compiler phase.
 live=group(child.pid)
 if live:
  try:os.killpg(child.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  until=min(deadline-8,time.monotonic()+6)
  while time.monotonic()<until:
   child.poll()
   if not group(child.pid):break
   time.sleep(.1)
  if group(child.pid):
   try:os.killpg(child.pid,signal.SIGKILL)
   except ProcessLookupError:pass
 if child.poll() is None:child.wait(timeout=min(3,max(.1,deadline-time.monotonic())))
 until=min(deadline-8,time.monotonic()+3)
 while time.monotonic()<until and group(child.pid):time.sleep(.1)
 assert not group(child.pid),'owned phase process group remains'
try:
 raw_preparation=(prepared/'preparation.json').read_bytes()
 assert hashlib.sha256(raw_preparation).hexdigest()=='4f2c4e7db3bb99f56ef6ae5665e7c0ae4bcf8245c3f2c665c6435483f2be574f','exact Main preparation hash'
 prep=json.loads(raw_preparation)
 assert prep['workspace']==str(root),'workspace mismatch'
 raw_commands=(prepared/'commands.json').read_bytes()
 assert hashlib.sha256(raw_commands).hexdigest()==prep['commandsFileSha256']=='69b96b077ece73f475d124a7f7d17984def72c0b3c1207dc9679f0feb245940e','exact command file hash'
 commands=json.loads(raw_commands)
 assert commands==prep['commandsSequential'] and len(commands)==2,'declared sequential commands mismatch'
 assert all(isinstance(a,list) and all(isinstance(s,str) for s in a) for a in commands),'command argv shape'
 assert all(a[:2]==['env','-i'] and 'BUN_OPTIONS=--no-env-file' in a and '--no-env-file' in a for a in commands),'clean environment command missing'
 assert commands[0][-2:]==['run','typecheck'] and commands[1][-2:]==['--no-warn-ignored','src/features/privacy'],'declared phase mismatch'
 board=pathlib.Path('/Users/ali/Documents/Codex/2026-10-31/warpdrive-settings-ux/WARPDRIVE-QUEUE.md').read_text()
 block=board.split('## Current heavy authorization',1)[1].split('## Next ready work',1)[0]
 assert re.search(r'(?<![A-Z0-9-])'+re.escape(aid)+r'(?![A-Z0-9-])',block) and '01a19263-11f1-7e30-adfb-e418eb02876e' in block and re.search(r'\bSTART\b',block),'fresh exact matching START board required'
 assert hashlib.sha256((root/'.runtime/bin/bun').read_bytes()).hexdigest()=='0a2237cdcfa0d16ef501d9acca9f0026309ef348bea7393a64e8d1e3609565cc','Bun binary mismatch'
 assert run([str(root/'.runtime/bin/bun'),'--version'])=='1.4.4','Bun version mismatch'
 assert not dotfiles(),'Next dotenv present'
 pp=pins();fs=fileset();assert all(x['actual']==x['expected'] for x in pp) and fs['matches'],'pin/fileset mismatch'
 m=metrics()
 assert ((m['level']==1 and m['q']>=20) or (allow_warning2 and m['level']==2 and m['q']>=40)) and m['freeBytes']>=8*1024**3,m
 baseline=containers();base_n=nv('network');base_v=nv('volume');base_l=listeners();base_p=processes()
 save('preflight.json',{'authorization':aid,'epoch':time.time(),'metrics':m,'pins':pp,'fileset':fs,'foreignContainers':baseline,'networks':base_n,'volumes':base_v,'listeners':base_l,'processes':base_p,'commandsFileSha256':hashlib.sha256(raw_commands).hexdigest(),'commandsSequential':commands,'dotenvAbsent':True,'allowWarning2ExplicitGrant':allow_warning2,'boardSha256':hashlib.sha256(board.encode()).hexdigest(),'rssCapKiB':8*1024**2,'expectedRssKiB':6*1024**2,'cleanupReserveSeconds':25})
 for index,command in enumerate(commands):
  assert time.monotonic()<deadline-25,'cleanup reserve reached before phase'
  assert not any(x['processes'] for x in owned_groups()),'earlier phase group remains'
  m=metrics();assert m['level'] in (1,2) and m['q']>=30 and m['freeBytes']>=8*1024**3,m
  name=('typecheck','privacy-eslint')[index]
  phase={'phase':name,'argv':command,'startedElapsedSeconds':time.monotonic()-start,'exitCode':None,'groupTerminal':False}
  phases.append(phase);save('phases.json',phases)
  out=open(p/(name+'.log'),'w')
  proc=subprocess.Popen(command,cwd=root,env={'PATH':'/usr/bin:/bin'},stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
  groups.append(proc.pid);phase.update({'pid':proc.pid,'pgid':proc.pid})
  save('started.json',{'authorization':aid,'admissionStartedEpoch':epoch,'deadlineEpoch':epoch+180,'allowWarning2ExplicitGrant':allow_warning2,'phase':name,'pid':proc.pid,'pgid':proc.pid,'state':'RUNNING'})
  while proc.poll() is None:
   assert time.monotonic()<deadline-25,'cleanup reserve reached'
   m=metrics();assert m['level'] in (1,2) and m['q']>=30 and m['freeBytes']>=8*1024**3,m
   gs=owned_groups();rss=sum(y['rssKiB'] for x in gs for y in x['processes'])
   assert rss<8*1024**2,('aggregate owned RSS KiB',rss)
   assert states(containers())==states(baseline),'foreign container state changed; no adoption'
   samples.append({'phase':name,'elapsedSeconds':time.monotonic()-start,'metrics':m,'aggregateOwnedRssKiB':rss,'groups':gs})
   time.sleep(.3)
  proc.wait();phase['exitCode']=proc.returncode
  # A terminal parent is insufficient when a compiler descendant remains.
  residual=group(proc.pid)
  if residual:
   phase['residualGroupAtParentExit']=residual
   close_group(proc)
   raise RuntimeError('phase parent exited with a live descendant group')
  phase.update({'terminalElapsedSeconds':time.monotonic()-start,'groupTerminal':True})
  out.close();out=None;save('phases.json',phases)
  if proc.returncode!=0:break
except BaseException as e:abort=repr(e)
finally:
 cleanup_error=None
 if proc is not None:
  try:close_group(proc)
  except BaseException as e:cleanup_error=repr(e)
 if out is not None:out.close()
 if phases and proc is not None:
  phases[-1]['exitCode']=proc.returncode
  phases[-1].setdefault('terminalElapsedSeconds',time.monotonic()-start)
 save('phases.json',phases)
 terminal={'authorization':aid,'abort':abort,'cleanupError':cleanup_error,'terminalElapsedSeconds':time.monotonic()-start,'phases':phases,'samples':samples,'ownedContainers':[]}
 save('terminal.json',terminal)
 try:
  rows=containers();pp=pins();fs=fileset();m=metrics();n=nv('network');v=nv('volume');l=listeners();gs=owned_groups()
  post={'authorization':aid,'totalElapsedSeconds':time.monotonic()-start,'withinAllInDeadline':time.monotonic()<=deadline,'cleanupComplete':cleanup_error is None and not any(x['processes'] for x in gs),'foreignStatesPreserved':states(rows)==states(baseline) if baseline is not None else None,'foreignContainers':rows,'networksPreserved':n==base_n if base_n is not None else None,'volumesPreserved':v==base_v if base_v is not None else None,'listenersPreserved':l==base_l if base_l is not None else None,'listeners':l,'pinsPreserved':all(x['actual']==x['expected'] for x in pp),'pins':pp,'fileset':fs,'filesetPreserved':fs['matches'],'metrics':m,'groups':gs,'dotenvAbsent':not dotfiles()}
  save('postflight.json',post)
 except BaseException as e:
  post={'cleanupComplete':False,'cleanupError':repr(e),'totalElapsedSeconds':time.monotonic()-start};save('postflight.json',post)
 for phase in phases:
  logpath=p/(phase['phase']+'.log')
  if logpath.exists():
   plain=re.sub(r'\x1b\[[0-9;]*m','',logpath.read_text())
   (p/(phase['phase']+'-plain.log')).write_text(plain)
 passed=len(phases)==2 and all(x['exitCode']==0 and x['groupTerminal'] for x in phases) and abort is None
 checks=('withinAllInDeadline','cleanupComplete','foreignStatesPreserved','networksPreserved','volumesPreserved','listenersPreserved','pinsPreserved','filesetPreserved','dotenvAbsent')
 receipt={'authorization':aid,'evidenceDirectory':str(p),'state':'STATIC_PASS' if passed and all(post.get(k) is True for k in checks) else 'STATIC_NOT_PASS','allDeclaredPhasesPassed':passed,'phases':phases,'abort':abort,'cleanupError':cleanup_error,'postflight':{k:v for k,v in post.items() if k not in ('pins','foreignContainers','listeners')},'maxSampledRssKiB':max([x['aggregateOwnedRssKiB'] for x in samples],default=0),'minSampledQ':min([x['metrics']['q'] for x in samples],default=None),'allowWarning2ExplicitGrant':allow_warning2,'nativeOrInstalledAcceptance':False,'installedGatesOpen':12,'staging':'none yet'}
 save('receipt.json',receipt)
 print(json.dumps(receipt,indent=2))
sys.exit(0 if receipt['state']=='STATIC_PASS' else 1)
