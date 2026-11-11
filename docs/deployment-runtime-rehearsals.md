# Runtime shutdown and Web switching rehearsals

These checks extend the [deployment programme](deployment-redesign.md) with actual final-image
shutdown and isolated ingress-switch evidence. They contribute to
[OPS-002](https://github.com/KhademOHAli1/warpdrive/issues/483) and
[OPS-011](https://github.com/KhademOHAli1/warpdrive/issues/492). Source tests, native fixture
qualification, exact-main release gates and installed acceptance remain separate.

## Bounded shutdown

Worker and realtime entrypoints retain their runtime handles and share one shutdown operation
across SIGTERM/SIGINT. The worker stops claims on every registered application consumer before
waiting for active callbacks, then closes queue and application database resources. Callback
settlement needs independent tracking: the installed queue library can finish its own stop wait
while a callback still runs. A library stop response alone cannot establish a clean drain.

Realtime stops accepting connections, prevents new session work, waits for tracked session
operations and subscription teardown, closes peers cooperatively with code `1012`, and closes
relay/database resources afterward. An unresponsive peer or unfinished operation can exhaust
the deadline; it must not produce a clean-drain result.

The process reports a fixed `runtime.shutdown` record with component, status, current step and
exit code. It omits exception contents, SQL, credentials and job payloads. A failed or timed-out
shutdown exits nonzero. The worker has a 60-second overall deadline and realtime 15 seconds;
Compose gives them 75 and 30 seconds respectively. These deadlines bound waiting, not business
effect certainty or job execution time. A drained callback does not prove exactly-once provider
effects, completed delivery, lease recovery or safe replay of an uncertain operation.

## Native evidence

The checks load the checksum-verified tested bundle without rebuilding. They create only owned
disposable resources with generated credentials, internal networking and bounded CPU/memory.
No production target, provider credentials, delivery or checkout-source mounts are accepted.
Each check writes its own report and retains failed-first diagnostics. Cleanup failure prevents
success.

| Check                 | Actual proof                                                                                                                                                                                                                                              | Limits                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `drain_smoke.py`      | Hold a bounded lock on the empty fixture files table, observe a real active `file.reaper` query waiting, signal the worker, release it, require durable completion and exit zero; require post-signal work to remain queued until the same image restarts | One safe empty-database handler; no forced kill, overrun recovery, external submission or large import proof                     |
| `ws_drain_smoke.py`   | Authenticate a synthetic live session, subscribe and deliver a real relay event, require cooperative shutdown and exit zero, then authenticate and subscribe again after restarting the same image                                                        | Directly signed fixture tickets do not prove HTTP ticket issuance, login/MFA journeys, browser reconnection or offline replay    |
| `web_switch_smoke.py` | Real Caddy compare-and-swap rejection, rejected candidate preserving accepted traffic, same-version Web switching, idempotent readback and recovery after injected acknowledgement loss                                                                   | Same image/configuration/schema only; no old/new compatibility, automatic rollback, populated upgrade or production switch proof |

The Web switch fixture retains the accepted Web instance and pins worker, realtime, PostgreSQL
and Caddy container identities/restart counts. A background observer checks proxied traffic.
The Caddy image is resolved once, inspected and recorded. Generated configuration uses bounded
temporary storage; no anonymous volume is admitted. Owned host loopback relays reach fixed
internal fixture ports without adding an external network. Admin requests use fixed paths,
origin, body limits and timeouts. The rehearsal does not alter the production Caddyfile or
newsletter ingress allowlist.

Run a check on an admitted disposable native AMD64 runner using an already verified bundle:

```sh
python3 scripts/deployment/drain_smoke.py \
  --bundle-dir BUNDLE --expected-revision FULL_REVISION --output-dir NEW_OUTPUT
```

The other checks use the same three flags. These are fixture commands, not installation
deployment commands. The native image workflow executes them after the original image smoke.
Only actual reports establish passing cases; the presence of a harness or passing unit tests
does not establish native qualification.

## Controller boundaries

`web_switch.py` exposes a controller engine without a deployment CLI. It admits only a fixed
isolated rehearsal using the same image, source, configuration and schema in separate slots.
It keeps a target-wide lock, immutable operation binding, checksummed phase records and a
separate accepted pointer on trusted storage. Intent is persisted before mutation. Acceptance
requires independently inspected runtime/route identities plus sustained proxied health.

A conflicting plan, changed accepted runtime, unrelated-service drift or unresolved transaction
holds the target. An unknown route response cannot trigger another switch or rollback merely
because the old route is still visible: a delayed operation could apply later. Recovery can
complete only after independently observing the pinned desired route and health. Candidate
creation with an unknown outcome requires separate reconciliation; the engine does not replay
it. The previous accepted record/runtime remains retained. The receipt always states
`deploymentAuthorized: false`.

Automatic rollback after a switched candidate fails remains unimplemented. A verification hold
is not a claim that accepted traffic was restored. Populated upgrades, migration fencing,
newsletter cutovers, open-browser assets/Server Actions, cross-version contracts, encrypted
off-host recovery and installation monitoring remain programme requirements. Thousands of
workspaces remains optional future headroom, not a capacity acceptance gate.
