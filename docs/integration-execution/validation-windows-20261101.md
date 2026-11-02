# Sequential validation recovery, 1 November 2026

The previous continuation made source and evidence progress with the SVG guard. The
446-task goal remains active, with 37 completed and 409 planned tasks. Neither the
resource recovery nor the work prepared below closes another task.

## Verified coordination and resource boundary

The mail owner requested a temporary hold on new heavy validation campaigns. The
integration owner read the direct human reply in mail chat
`01a18868-3300-7dc2-b49d-c3bdb067fae7`: Ali answered "option 1 and free up space" to
the explicit question about coordinating temporary test/build pauses with active
Warpdrive chats. This supplies the authorization for resource coordination; an
incoming agent message alone would not supply it. The integration owner acknowledged
the hold in that chat. It is a validation window, not a paused goal.

The first fresh Data snapshot here was 13,734,477,824 available bytes (12.791 GiB).
This is an observation, not reserved capacity. Swap still had approximately 15.9 GiB
in use. Recheck actual headroom and owned process state before each finite run.
The 5 GiB stable start floor for database/build/install/broad campaigns remains.
One selected unit file may use the existing 3 GiB floor and owned process-group
watchdog, but only after the current coordinated window releases. No parallel broad
campaigns are authorized by recovered space alone.

## Current runtime and generated paths

At source `994cecd20a6e56afe4866022c6d2d765ac23af0a`, the fresh process/listener
inventory found no integration web listener on 3160, no realtime listener on 8080,
and no owned worker process. Their earlier successful runtime evidence is historical.
Native PostgreSQL PID 47693 still listened on loopback 55436, and the existing S3
forward remained on 9160. These listeners alone are not current application health
or end-to-end service evidence. Private configuration and data remain unchanged.

The owned `.next/cache` and `.next/dev/cache` paths are already absent from the
earlier cleanup. A fresh ignored-path inventory measured allocated file blocks:

| Path under the preview checkout | Allocated file bytes | Action                                   |
| ------------------------------- | -------------------: | ---------------------------------------- |
| `node_modules/.vite`            |              122,880 | Retained                                 |
| `.next/dev`                     |           96,604,160 | Retained, includes generated route state |
| `.next/types`                   |              954,368 | Retained                                 |

All three were ordinary non-symlink ignored directories. No deletion was performed
in this recovery window, so reclaimed allocation is zero. Peer processes, source,
Git metadata, dependencies, private profiles, databases, Docker volumes, global
caches and user applications were not changed. The independent qualification clone
still needs a frozen pinned-Bun install because its idle dependencies were removed
in the earlier critical-pressure window.

## Next finite evidence

1. The mail owner has priority for its six selected receipt-owner PostgreSQL cases.
   Do not restart or infer a live run from a reservation or old handle. Wait for an
   explicit release, or verify a current owned process when observing a live run.
2. Prepare the selected Slack read-boundary regression for CONN-014. Keep revoked
   authorization, missing scope, missing resource, rate limit, transient outage and
   invalid configuration distinct without widening mutation retry semantics. Observe
   a meaningful red before changing production code. Action/UI propagation and full
   health/provider acceptance remain separate unfinished work.
3. Run the prepared native-session actor-freshness case through the existing real
   PostgreSQL 16 integration harness with one worker. Its positive control, valid CAS
   and denied target/audit/realtime effects must all remain meaningful. It has not
   yet produced a red result, and no production freshness fix has been made.

The existing optional workflow-only PostgreSQL 18 configuration does not select the
actor file and requires a different role. Do not silently relax its safety guard,
borrow the peer workflow database, or introduce a second harness to avoid the
recorded PostgreSQL 16 qualification lane.

## Observed results and released window

The coordinator explicitly released the mail window after its receipt cases became
terminal. The programme then ran only the following sequential selected profiles:

| Profile                                            | Evidence and result                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Actor initial red                                  | `actor-freshness-red-20261101`, group 80824; one pass/one failure, valid CAS and four actual-effect assertion failures   |
| Actor green                                        | `actor-freshness-green-20261101`, group 82612; two passes on PostgreSQL 16                                               |
| Slack failure red                                  | `slack-read-failures-red-20261101`, group 81296; 21 failures/two controls passed                                         |
| Slack failure baseline green                       | `slack-read-failures-green-20261101`, group 82444; 23 passes                                                             |
| Slack cancellation behavioral red                  | `slack-read-cancellation-red-20261101`, group 83065; three failures/three controls passed on the actual helper           |
| Slack cancellation green                           | `slack-read-cancellation-green-20261101`, group 84020; six passes                                                        |
| Failure/control reruns before monotonic correction | `slack-read-failures-final-20261101`, group 84029, 23 passes; `slack-legacy-controls-20261101`, group 84034, four passes |
| Monotonic deadline red                             | `slack-monotonic-red-20261101`, group 86783; four overdue-phase failures/eight controls passed, 12 cases                 |
| Monotonic deadline green                           | `slack-monotonic-green-20261101`, group 87650; 12 passes after absolute elapsed-time checks                              |
| Final-source retained regressions                  | `slack-final-classification-20261101`, group 88255, 23 passes; `slack-final-legacy-20261101`, group 88261, four passes   |

The actor correction is committed as `643738b`; its
[focused qualification](actor-freshness-qualification.md) records the pending 12-file
affected selection and authority/session/concurrency limits. Slack's three final
files initially contained 33 unique cases, not the sum of repeated red/green runs.
Independent source review then identified a blocking monotonic deadline gap:
an expired timer callback can be delayed while promise completion wins. After the
coordinator granted a separate tiny unit slot, four new overdue-phase cases reproduced
it without busy-waiting, and two new controls retained caller-abort precedence. The
12-case cancellation file passed after absolute deadline checks. The coordinator
then permitted the necessary retained regressions in the same small unit lane.
The final edit passed all 23 classification and four legacy controls too, giving
**39 unique passing cases on final source**. The partial CONN-014 slice still needs
scoped static and wider provider/action/health qualification; the task stays planned.

After those terminal runs, exact process checks found no owned campaign remaining,
Docker returned to its baseline three containers, and Data had 14,048,215,040 bytes
available. The programme explicitly released the finite slot to the waiting Sales
production build and held further campaigns. The larger affected regression, types
and scoped lint need a subsequent coordinated window, not an overlapping broad run.

Separately, UX-006's reviewed trilingual design catalogs are committed as `fc042b8`.
All 300 ICU messages parsed and their argument types matched; 135 copied values
matched source. The task register now records **38 completed, 408 planned**, still
446 tasks total. Runtime bindings, future journeys, native-speaker rendering and
browser acceptance are not implied by this design-copy closure. No other task was
closed for the actor/Slack work or resource recovery.

## Completed affected/static window

The later explicit handoff admitted the 12-file affected PG16 selection, which
passed 59/59. Final scoped Biome/type-aware ESLint and standalone types passed
after bounded repairs; 39 Slack and 51 guard unit cases passed too. Mail then
took the native lane, and no further programme PG campaign was started. All
programme campaign processes were terminal when the remaining slot was released.
See [the exact later evidence](qualification-20261101.md).

The independently reviewed MCP inventory and trilingual consent design subsequently
closed AISEC-001/002. Current tracker: **40 completed, 406 planned**, 446 total.
Those design/source closures do not implement scoped grants. The later D225 checkpoint
passed the complete 6,024-case unit lane, production/worker compilation and independent
frozen dependency install. D225 whole-source lint failed at Biome before ESLint; the later
docs-only `d238bcb` full-lint recheck passed. Full-PG,
runtime/browser and provider gates remain separate in the linked current record.
