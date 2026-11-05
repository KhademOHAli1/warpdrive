# Fixed-instant waits: bounded WF023 / #680 increment

4 November 2026. This note describes the private source increment and its bounded
local evidence. Formal blockers #670 and #679 remain open. It does not close #680,
the wider WF023 scope, integration, release, deployment or installation acceptance.

## Authored contract

A version-1 delay has exactly one config member:

```json
{ "minutes": { "kind": "value", "value": 60 } }
```

```json
{ "until": { "kind": "value", "literalType": "instant", "value": "2030-03-20T12:34:56.123Z" } }
```

Duration execution retains whole literal minutes from 1 through 525600. A fixed
instant requires a literal explicitly tagged `instant`, strict ISO date/time with
`Z` or an explicit UTC offset, exact whole-millisecond representability and a finite
native `Date`. Extra trailing precision zeros are accepted when the value remains
an exact millisecond; sub-millisecond values are rejected without truncation.
Civil dates, zone-free wall times, relative phrases and mapped deadlines do not
become executable schedules. Existing WF020 instant comparisons retain their own
precision contract.

Opening or blurring a configuration does not convert it. Explicit mode selection
replaces the whole config in one history edit, starts the newly selected mode empty,
and preserves the former wire in undo history. Raw offset text, invalid intermediate
input, reviewed incomplete/wrong-known intent and reference drafts remain available
for correction/copy without becoming ready. Unknown members/tags, mixed modes and
explicit `undefined` are rejected at the reviewed JSON boundary. Disabled,
denied and read-only views do not authorize edits. The older failed-task retry
profile excludes every own `until` member, including incomplete drafts.

## Runtime and presentation

Publication, readiness and admission replay are clock-free. On first reaching the
pinned node, execution uses the database clock sampled after acquiring the run-row
lock. A future target may be at most 525600 **elapsed minutes** away at that point;
the browser clock cannot authorize this bound. A target already due, including one
that became due after admission, completes immediately with its requested deadline
in the canonical `resumeAt` output, rather than replacing it with the current time.

A future live target arms the existing waiting cursor and stored `resumeAt`, then
returns the job. Subsequent wakes use that stored finite deadline: they do not rearm,
reapply the initial cap, or derive a new schedule from a draft, newer publication or
CRM data. Clock movement changes eligibility against the stored deadline. Due time
is eligibility, without an exact-time execution guarantee. Pinned versions, current
actor/workflow/archive/cancel/effect checks and the shared receipt/cursor transaction
remain in force. Simulation records the projected deadline without waiting and uses
the existing rollback of database-only task effects.

Calendar, numbering-system and time-zone preferences change display only. They do
not edit authored text or move an armed deadline. The fixed-instant editor and
summary show seconds/milliseconds with the display zone. Native `<time dateTime>`
retains the canonical instant and uses `aria-describedby` linked to readable exact
instant text; the exact description preserves authored text where available.
Existing timestamp consumers retain their default visible minute display. No civil
calendar conversion, DST disambiguation or rescheduling control is introduced.

Before enabling fixed-instant authoring, the application and every workflow worker
must run matching code that supports this contract. A duration-only worker cannot
execute the new `until` configuration. Matching deployment has not been established
by these source/local checks.

## Qualification record and open gates

The coordinator's local `workflow-680-resume` receipts retain this sequence:

- `baseline`: 3 controls passed and 5 existing-API behavior gaps failed.
- `focused1`: 353 passed / 1 failed across 13 files. The remaining failure was the
  unavailable-timing message oracle; configured accessibility checks also required
  correcting timestamp semantics. Both failures and the pre-correction freezes remain
  historical evidence.
- `ui2`: 79 current UI cases passed across 7 files, including all 8 original baseline
  cases and the corrected exact-instant/unavailable-timing assertions. The 275 backend
  cases passed in `focused1` on backend bytes unchanged by the timestamp correction.
  This is a **275-backend plus 79-current-UI evidence split**, not one all-green
  354-case run on the final aggregate.

The 15 new real-PostgreSQL cases in `fixedInstantWait.integration.test.ts` remain
pending hosted execution. They use the existing public publication/admission and
real persistence harness; edited stored-deadline fixtures do not establish actual
OS/NTP clock-change behavior. Actual worker restart, natural elapsed waits, native
pointer/keyboard/assistive-technology journeys and human product acceptance remain
UNRUN. Full aggregate CI, formal dependency acceptance and operational acceptance
must be recorded separately before broader delivery claims.

See [workflow architecture](../workflows/architecture.md) for immutable publication,
locking and transactional effects, [operations](../workflows/operations.md) for
worker/recovery boundaries, and [configuration](../workflows/configuration.md) for
draft and validation conventions. The status document preserves an explicitly historical task ledger; its disabled-wait
row does not describe this increment.
