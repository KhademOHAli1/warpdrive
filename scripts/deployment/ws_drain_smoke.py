#!/usr/bin/env python3
"""Exercise authenticated realtime SIGTERM/restart in exact retained native images.

All identities, strong-session assertions and tickets are synthetic. Direct jose
ticket minting mirrors the server wire contract; it does not qualify HTTP ticket
issuance, a login/MFA journey or automatic browser reconnection.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile
import time
from typing import Callable
from urllib.parse import urlsplit

try:
    from .bundle import load_bundle
    from .image_smoke import ImageSmoke, SmokeError, COMPONENTS, utc_now, validate_revision
    from .registry_smoke import IsolatedDocker
except ImportError:
    from bundle import load_bundle
    from image_smoke import ImageSmoke, SmokeError, COMPONENTS, utc_now, validate_revision
    from registry_smoke import IsolatedDocker


LIMITATIONS = [
    "Disposable native authenticated realtime shutdown/restart only; no production deployment acceptance.",
    "Synthetic identities and directly signed jose tickets; HTTP ticket issuance, login and MFA ceremonies are not qualified.",
    "Explicit probe reconnection; browser automatic reconnect, cache refetch/resync and offline-event replay are not qualified.",
    "Synthetic PostgreSQL NOTIFY envelopes qualify relay delivery, not a persisted feature mutation or notification journey.",
    "No proxy/TLS cutover, multiple realtime replicas, populated upgrade or data recovery is qualified.",
]


class RealtimeDrainError(SmokeError):
    pass


def admit_seed_environment(environment):
    try:
        database = urlsplit(environment.get("DATABASE_URL", ""))
        admitted = (database.scheme == "postgres" and database.hostname == "postgres"
                    and database.username == "smoke" and database.port == 5432
                    and database.path == "/warpdrive_image_smoke" and not database.query and not database.fragment)
    except ValueError:
        admitted = False
    expected = {"NODE_ENV": "production", "BUN_OPTIONS": "--no-env-file", "MCP_ENABLED": "false",
                "DISABLE_TELEMETRY": "true", "DISABLE_UPDATE_CHECK": "true",
                "NEWSLETTER_DELIVERY_ENABLED": "false", "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false",
                "AUTH_GOOGLE_ENABLED": "false", "AUTH_MAIL_TRANSPORT": "smtp",
                "AUTH_SMTP_HOST": "127.0.0.1", "AUTH_SMTP_PORT": "9", "WS_PUBLIC_URL": "ws://realtime:8080"}
    if (not admitted or any(environment.get(key) != value for key, value in expected.items())
            or any(key.endswith("_FILE") and value for key, value in environment.items())
            or len(environment.get("WS_TICKET_SECRET", "")) < 32 or len(environment.get("AUTH_SECRET", "")) < 32):
        raise RealtimeDrainError("Synthetic realtime seed requires its fresh isolated runtime environment")


def require_proof(value, phase, fields):
    if not isinstance(value, dict) or value.get("phase") != phase:
        raise RealtimeDrainError("Required realtime protocol proof is missing")
    for name, expected in fields.items():
        actual = value.get(name)
        if type(actual) is not type(expected) or actual != expected:
            raise RealtimeDrainError("Realtime protocol proof has an unverified required fact")
    return value


LISTENER_PROBE = r"""
import { connect } from 'node:net';
await new Promise((resolve,reject)=> {
  const socket=connect({host:'127.0.0.1',port:8080});
  const timer=setTimeout(()=> {socket.destroy();reject(Error('Listener timed out'));},3000);
  socket.once('connect',()=> {clearTimeout(timer);socket.destroy();resolve();});
  socket.once('error',error=> {clearTimeout(timer);reject(error);});
});
console.log(JSON.stringify({listening:true}));
"""

CONTROLLER = r"""
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { Client } from 'pg';
import { WebSocket } from 'ws';
const source=new URL(process.env.DATABASE_URL);
const controlChannel=process.env.IMAGE_SMOKE_WS_CONTROL;
if(source.protocol!=='postgres:' || source.hostname!=='postgres' || source.username!=='smoke' || source.port!=='5432' ||
   source.pathname!=='/warpdrive_image_smoke' || source.search || source.hash ||
   process.env.NODE_ENV!=='production' || process.env.BUN_OPTIONS!=='--no-env-file' ||
   process.env.DISABLE_TELEMETRY!=='true' || process.env.DISABLE_UPDATE_CHECK!=='true' ||
   process.env.NEWSLETTER_DELIVERY_ENABLED!=='false' || process.env.NEWSLETTER_PUBLIC_SIGNUP_ENABLED!=='false' ||
   !/^[a-z0-9_]{1,63}$/.test(controlChannel||'') || (process.env.WS_TICKET_SECRET||'').length<32 ||
   Object.entries(process.env).some(([name,value])=>name.endsWith('_FILE')&&value)) throw Error('Fixture target refused');
const db=new Client({connectionString:process.env.DATABASE_URL,application_name:'wd-ws-drain-controller',connectionTimeoutMillis:3000,query_timeout:5000});
const sockets=new Set(), commands=[];
let fixtureStage='seed',databaseError=false;
db.on('error',()=> {databaseError=true;});
const emit=(phase,detail={})=>console.log(JSON.stringify({phase,...detail}));
const deadline=setTimeout(()=> {console.error('native realtime fixture deadline');process.exit(2);},120000);
db.on('notification',message=> {if(message.channel===controlChannel) commands.push(message.payload);});
async function until(predicate,ms,reason) {
  const end=Date.now()+ms;
  while(true) {if(databaseError)throw Error('Fixture database connection failed');const value=await predicate();if(value) return value;if(Date.now()>=end) throw Error(reason);await Bun.sleep(25);}
}
function socketState() {
  const state={socket:new WebSocket('ws://realtime:8080',{maxPayload:32768,handshakeTimeout:5000,perMessageDeflate:false}),frames:[],error:false,closed:false,code:null};
  sockets.add(state.socket);
  state.socket.on('message',raw=> {
    if(state.frames.length>=64) {state.error=true;state.socket.terminate();return;}
    try {state.frames.push(JSON.parse(raw.toString()));} catch {state.error=true;state.socket.terminate();}
  });
  state.socket.once('error',()=> {state.error=true;});
  state.socket.once('close',code=> {state.closed=true;state.code=code;});
  return state;
}
async function opened(state) {
  await until(()=> {if(state.error||state.closed) throw Error('WS open failed');return state.socket.readyState===WebSocket.OPEN;},5000,'WS open timed out');
}
async function frame(state,kind,predicate=()=>true) {
  return until(()=> {
    if(state.error||state.closed) throw Error('Authenticated WS closed before protocol proof');
    if(state.frames.some(item=>item?.kind==='error')) throw Error('WS authorization was refused');
    const index=state.frames.findIndex(item=>item?.kind===kind&&predicate(item));
    if(index<0) return false;
    return state.frames.splice(index,1)[0];
  },5000,'WS frame timed out');
}
async function closed(state,expected,ms=5000) {
  await until(()=> {if(state.error) throw Error('WS transport failed');return state.closed;},ms,'WS close timed out');
  if(state.code!==expected) throw Error('WS close code did not match expected protocol outcome');
}
const secret=new TextEncoder().encode(process.env.WS_TICKET_SECRET);
async function mint(userId,sessionId) {
  const now=Math.floor(Date.now()/1000),jti=randomUUID();
  const ticket=await new SignJWT({sid:sessionId,jti}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setIssuedAt(now).setExpirationTime(now+60).sign(secret);
  return {ticket,jti,expires:now+60};
}
async function connectAuthenticated(ticket,channel) {
  const state=socketState();await opened(state);
  state.socket.send(JSON.stringify({kind:'auth',ticket}));
  await frame(state,'auth_ok');
  state.socket.send(JSON.stringify({kind:'subscribe',channel}));
  await frame(state,'subscribed',value=>value.channel===channel);
  return state;
}
async function delivery(state,channel,userId) {
  const notificationId=randomUUID();
  const event={v:1,channel,ts:new Date().toISOString(),actorId:userId,type:'notification',data:{notificationId,kind:'mention'}};
  await db.query('SELECT pg_notify($1,$2)',[channel,JSON.stringify(event)]);
  const received=await frame(state,'event',value=>value.channel===channel&&value.event?.data?.notificationId===notificationId);
  if(received.event.v!==1||received.event.type!=='notification'||received.event.seq!==0) throw Error('Actual relay event did not match fresh channel contract');
}
async function replayRejected(minted) {
  if(Math.floor(Date.now()/1000)>=minted.expires) throw Error('Replay fixture expired before single-use check');
  const replay=socketState();await opened(replay);
  replay.socket.send(JSON.stringify({kind:'auth',ticket:minted.ticket}));
  await until(()=> {
    if(replay.error||replay.frames.some(item=>item?.kind==='auth_ok')) throw Error('Replayed ticket was incorrectly authenticated');
    return replay.closed;
  },5000,'Replay rejection timed out');
  if(replay.code!==4401) throw Error('Replay did not close with authentication rejection');
}
let transaction=false;
try {
  await db.connect();
  const identity=await db.query('SELECT current_database() AS name');
  if(identity.rows[0]?.name!=='warpdrive_image_smoke') throw Error('Wrong seed database');
  await db.query('LISTEN "'+controlChannel+'"');
  await db.query('BEGIN');transaction=true;
  const counts=await db.query('SELECT (SELECT count(*) FROM users)::int AS users,(SELECT count(*) FROM auth_users)::int AS auth,(SELECT count(*) FROM sessions)::int AS sessions');
  if(Object.values(counts.rows[0]).some(count=>count!==0)) throw Error('Seed fixture was not empty');
  const userId=randomUUID(),sessionId=randomUUID(),email='ws-'+randomUUID()+'@example.invalid';
  const hash=createHash('sha256').update(randomBytes(32)).digest('base64url');
  await db.query('INSERT INTO users(id,email,name,is_admin,is_active) VALUES($1,$2,$3,false,true)',[userId,email,'Synthetic realtime fixture']);
  await db.query('INSERT INTO auth_users(id,email,name,email_verified,two_factor_enabled) VALUES($1,$2,$3,true,true)',[userId,email,'Synthetic realtime fixture']);
  await db.query("INSERT INTO sessions(id,user_id,token_hash,expires_at,auth_method,assurance,mfa_verified_at,fresh_authenticated_at) VALUES($1,$2,$3,now()+interval '10 minutes','password','mfa',now(),now())",[sessionId,userId,hash]);
  await db.query('COMMIT');transaction=false;
  const seeded=await db.query(`SELECT u.is_active AS active,a.email_verified AS verified,s.assurance,
    (s.revoked_at IS NULL AND s.expires_at>now()) AS live FROM users u JOIN auth_users a ON a.id=u.id JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2`,[userId,sessionId]);
  if(seeded.rows.length!==1||seeded.rows[0].active!==true||seeded.rows[0].verified!==true||seeded.rows[0].live!==true||seeded.rows[0].assurance!=='mfa') throw Error('Live synthetic native session not established');
  emit('seeded',{active:true,emailVerified:true,sessionLive:true,assurance:'mfa',synthetic:true});
  const channel='user:'+userId,first=await mint(userId,sessionId);
  fixtureStage='first-authentication';
  const original=await connectAuthenticated(first.ticket,channel);
  fixtureStage='first-relay';await delivery(original,channel,userId);
  fixtureStage='first-replay';await replayRejected(first);
  if(original.socket.readyState!==WebSocket.OPEN) throw Error('Authenticated socket was not open before SIGTERM');
  emit('authenticated-open',{authOk:true,subscribed:true,socketOpen:true,relayEventDelivered:true,replayRejected:true});
  fixtureStage='cooperative-close';
  await closed(original,1012,25000);
  emit('cooperative-close',{closeCode:1012,socketClosed:true});
  fixtureStage='restart-coordination';
  await until(()=> {
    const next=commands.shift();if(next===undefined)return false;if(next!=='restart')throw Error('Invalid realtime fixture command');return true;
  },60000,'Restart coordination timed out');
  const second=await mint(userId,sessionId);
  if(second.jti===first.jti||second.ticket===first.ticket) throw Error('Restart reused original ticket');
  fixtureStage='replacement-authentication';const replacement=await connectAuthenticated(second.ticket,channel);
  fixtureStage='replacement-relay';await delivery(replacement,channel,userId);
  fixtureStage='replacement-replay';await replayRejected(second);
  fixtureStage='ticket-receipts';
  const receipts=await db.query('SELECT count(*)::int AS count FROM ws_tickets WHERE user_id=$1 AND jti=ANY($2::uuid[])',[userId,[first.jti,second.jti]]);
  if(receipts.rows[0]?.count!==2) throw Error('Distinct ticket consumption was not durable');
  fixtureStage='fixture-close';replacement.socket.close(1000,'Fixture complete');await closed(replacement,1000);
  emit('complete',{reauthenticated:true,resubscribed:true,relayEventDelivered:true,distinctSingleUseTickets:true,replayRejected:true});
} catch {
  console.error(JSON.stringify({event:'native.ws.drain.failed',stage:fixtureStage}));process.exitCode=1;
} finally {
  for(const socket of sockets) if(socket.readyState!==WebSocket.CLOSED) socket.terminate();
  if(transaction) await db.query('ROLLBACK').catch(()=>{});
  await db.end().catch(()=> {process.exitCode=1;});
  clearTimeout(deadline);
}
"""

RESTART_NOTIFY = r"""
import { Client } from 'pg';
const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,query_timeout:5000});
try {await db.connect();await db.query('SELECT pg_notify($1,$2)',[process.env.IMAGE_SMOKE_WS_CONTROL,'restart']);console.log(JSON.stringify({notified:'restart'}));}
finally {await db.end();}
"""


class RealtimeDrainSmoke:
    def __init__(self, docker, bundle_dir: Path, expected_revision: str, output_dir: Path,
                 *, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        self.docker, self.bundle_dir, self.output_dir = docker, bundle_dir, output_dir
        self.revision = validate_revision(expected_revision)
        self.clock, self.sleep = clock, sleep
        self.fixture = None
        self.report = {"schemaVersion": 1, "kind": "warpdrive-native-authenticated-realtime-drain-smoke",
                       "success": False, "revision": self.revision, "startedAt": utc_now(), "checks": [],
                       "images": {}, "limitations": LIMITATIONS, "failure": None, "diagnostics": [],
                       "cleanup": {"success": False, "errors": []}}

    def check(self, name, operation):
        try:
            detail = operation()
        except Exception:
            self.report["checks"].append({"name": name, "status": "failed"})
            raise
        self.report["checks"].append({"name": name, "status": "passed", "detail": detail or {}})
        return detail

    def load(self):
        loaded = load_bundle(self.bundle_dir, expected_revision=self.revision)
        images = {name: loaded["candidate"]["components"][name]["imageId"] for name in COMPONENTS}
        self.docker.run(["image", "load", "--input", str(loaded["archivePath"])], timeout=300)
        self.fixture = ImageSmoke(self.docker, images, self.output_dir / "fixture", self.revision,
                                  clock=self.clock, sleep=self.sleep)
        identities = self.fixture.inspect_images()
        self.report["images"] = self.fixture.report["images"]
        return {**identities, "archiveSha256": loaded["provenance"]["archiveSha256"], "rebuilds": 0}

    def listener(self, timeout):
        self.fixture.wait_for(lambda: self.docker.run([
            "exec", self.realtime, "bun", "--no-env-file", "-e", LISTENER_PROBE,
        ], timeout=5, check=False).returncode == 0, "native realtime listener", timeout, self.realtime)

    def same_image(self):
        observed = self.docker.run(["container", "inspect", self.realtime, "--format", "{{.Image}}"], timeout=5).stdout.strip()
        if observed != self.fixture.report["images"]["realtime"]["id"]:
            raise RealtimeDrainError("Realtime container no longer selects the exact tested image")

    def setup(self):
        isolation = self.fixture.create_environment()
        migrations = self.fixture.migrations()
        self.realtime = self.fixture.start_container("realtime", self.fixture.report["images"]["realtime"]["id"],
                                                     ["bun", "dist/ws.mjs"], memory="768m")
        self.listener(45)
        self.same_image()
        return {"isolation": isolation, "migrations": migrations, "sourceMounts": 0}

    def wait_phase(self, phase, timeout):
        deadline = self.clock() + timeout
        while True:
            state = self.fixture.state(self.controller)
            if state.get("OOMKilled") or (state.get("Running") is False and state.get("ExitCode") != 0):
                raise RealtimeDrainError("Realtime fixture controller failed before proving its phase")
            logs = self.docker.run(["logs", "--tail", "40", self.controller], timeout=5).stdout
            for line in logs.splitlines():
                try:
                    value = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(value, dict) and value.get("phase") == phase:
                    if phase != "complete" and state.get("Running") is not True:
                        raise RealtimeDrainError("Realtime fixture controller stopped before coordinated completion")
                    return value
            if state.get("Running") is not True:
                raise RealtimeDrainError("Realtime fixture controller stopped without required proof")
            if self.clock() >= deadline:
                raise RealtimeDrainError("Timed out waiting for bounded realtime protocol proof")
            self.sleep(0.25)

    def seed(self):
        admit_seed_environment(self.fixture.env)
        channel = self.fixture.prefix.replace("-", "_") + "_ws_control"
        self.controller = self.fixture.start_container("ws-controller", self.fixture.report["images"]["realtime"]["id"],
            ["bun", "--no-env-file", "-e", CONTROLLER],
            environment={**self.fixture.env, "IMAGE_SMOKE_WS_CONTROL": channel}, memory="384m")
        require_proof(self.wait_phase("seeded", 15), "seeded", {
            "active": True, "emailVerified": True, "sessionLive": True, "assurance": "mfa", "synthetic": True,
        })
        return {"syntheticNativeSession": True, "nativePolicyAssurance": "mfa", "ticketMint": "direct-jose-wire-contract"}

    def authenticated(self):
        require_proof(self.wait_phase("authenticated-open", 30), "authenticated-open", {
            "authOk": True, "subscribed": True, "socketOpen": True, "relayEventDelivered": True, "replayRejected": True,
        })
        self.fixture.assert_running(self.realtime)
        return {"liveSessionAuthenticated": True, "ownUserChannelSubscribed": True,
                "postgresRelayEventDelivered": True, "sameTicketReplayRejected": True}

    def shutdown(self):
        self.fixture.assert_running(self.realtime)
        self.docker.run(["kill", "--signal", "TERM", self.realtime], timeout=10)
        require_proof(self.wait_phase("cooperative-close", 25), "cooperative-close", {"closeCode": 1012, "socketClosed": True})
        deadline = self.clock() + 25
        while True:
            state = self.fixture.state(self.realtime)
            if state.get("Running") is False:
                if type(state.get("ExitCode")) is not int or state["ExitCode"] != 0 or state.get("OOMKilled") is not False:
                    raise RealtimeDrainError("Realtime SIGTERM did not finish with exit zero and no OOM")
                break
            if self.clock() >= deadline:
                raise RealtimeDrainError("Realtime server did not finish bounded cooperative shutdown")
            self.sleep(0.25)
        return {"signal": "SIGTERM", "authenticatedPeerCloseCode": 1012, "serverExitCode": 0, "oomKilled": False}

    def restart(self):
        self.docker.run(["start", self.realtime], timeout=10)
        self.listener(15)
        self.same_image()
        notified = self.docker.json(["exec", self.controller, "bun", "--no-env-file", "-e", RESTART_NOTIFY], timeout=10)
        if notified != {"notified": "restart"}:
            raise RealtimeDrainError("Realtime restart coordination was not acknowledged")
        require_proof(self.wait_phase("complete", 40), "complete", {"reauthenticated": True, "resubscribed": True,
            "relayEventDelivered": True, "distinctSingleUseTickets": True, "replayRejected": True})
        self.fixture.finished(self.controller, 10)
        self.fixture.assert_running(self.realtime)
        return {"sameImageRestarted": True, "freshSingleUseTicket": True, "reauthenticated": True,
                "resubscribed": True, "postgresRelayEventDelivered": True, "browserAutoReconnectQualified": False}

    def run(self):
        self.output_dir.mkdir(parents=True, exist_ok=False)
        try:
            self.check("verified-bundle-and-exact-image-identities", self.load)
            self.check("isolated-database-and-native-realtime-listener", self.setup)
            self.check("synthetic-live-native-session-and-ticket-fixture", self.seed)
            self.check("authenticated-subscription-relay-and-single-use-ticket", self.authenticated)
            self.check("sigterm-cooperative-authenticated-peer-close", self.shutdown)
            self.check("same-image-restart-fresh-authenticated-relay", self.restart)
        except Exception as error:
            self.report["failure"] = str(error) if isinstance(error, SmokeError) else type(error).__name__
            if self.fixture is not None:
                self.report["diagnostics"] = self.fixture.failure_diagnostics()
        finally:
            errors = self.fixture.cleanup() if self.fixture is not None else []
            self.report["cleanup"] = {"success": not errors, "errors": errors}
            self.report["finishedAt"] = utc_now()
            self.report["success"] = self.report["failure"] is None and not errors
            (self.output_dir / "report.json").write_text(json.dumps(self.report, indent=2) + "\n")
        return self.report["success"]


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--expected-revision", type=validate_revision, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(arguments)
    try:
        with tempfile.TemporaryDirectory(prefix="wd-ws-drain-auth-") as directory:
            passed = RealtimeDrainSmoke(IsolatedDocker(Path(directory) / "docker"), args.bundle_dir,
                                        args.expected_revision, args.output_dir).run()
    except (SmokeError, ValueError, OSError) as error:
        print(f"Authenticated realtime drain smoke rejected: {error}", file=sys.stderr)
        return 1
    print(f"Authenticated realtime drain smoke {'passed' if passed else 'failed'}; report: {args.output_dir / 'report.json'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
