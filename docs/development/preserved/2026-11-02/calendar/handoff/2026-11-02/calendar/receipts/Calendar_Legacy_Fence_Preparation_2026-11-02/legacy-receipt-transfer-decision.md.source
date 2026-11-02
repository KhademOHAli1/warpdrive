# Legacy receipt transfer: decision map

Read-only source analysis, 2 November 2026. Private Calendar source was read in its
current workspace; canonical durable MAIL was inspected only through immutable public
Git objects at `a29c08c356af8a308056086ecbac98f2d70683e4`. No source/SQL edit, check,
test, native/provider execution or runtime consumer inventory was performed.

**Decision:** retain the actual notification UUID and its existing MAIL identity. Existing
intent/backlink fields can carry a proven delivered effect, but an old notification alone
cannot safely establish that proof. The compatible callback must atomically persist trusted
delivery provenance when it wins the Activity lock. Current data/contracts do not yet
separate that historical provenance from native future-send authority. This needs an
explicit durable representation and read/admission contract; it does not automatically
require a new physical table, and this note chooses no DDL.

| Existing persisted evidence | Safe use and limit |
| --- | --- |
| `notifications.id`, `userId`, type, entity reference, payload activityId/dueAt, createdAt/readAt/emailSentAt (`src/db/schema/notifications.ts:12–26`) | Retain the exact row, recipient, UUID and read/delivery markers. A legacy payload records the due value observed by its producer. It contains no original queued schedule/version, intended fireAt, civil-date/zone signature, policy revision or channel provenance. createdAt is production time, not intended fireAt. Multiple old notices can exist for the same activity/recipient; the schema provides no logical-reminder uniqueness. |
| Intent dueAt/fireAt/eventSignature, recipient, settings/default revisions, channels, delivered state and notificationId (`src/db/schema/activityReminderIntents.ts:13–39`) | These can represent a completed effect and keep a stable backlink. `deliverReminderIntent` returns without creating another notice for an already delivered intent (`reminderDelivery.ts:41`); the reconciler can retain its identity when `sameMoment` matches (`reminderIntent.ts:9–15,45–72`). They do not attest their own legacy origin. Empty signatures/null settings are compatibility wildcards, not evidence that a historical notice matches a new plan. The notification backlink index is non-unique. |
| No-ID notification backlink resolution (`calendarPrivacy.ts:166–186,211–223`) | An existing, uniquely matching authoritative intent can resolve an unchanged legacy payload without adding reminderIntentId to it. Ambiguous, malformed, cancelled or mismatched references remain denied. Creating a backlink changes admission semantics: it routes history through native channel/current-policy admission. It is not merely an identity alias. |
| Public MAIL notification binding | `notificationBinding.ts` calls enqueueSend with `idempotencyKey = notice.id`. `notificationBindingRows.ts` validates one matching attempt, purpose notificationId/recipientUserId, mailbox owner and idempotency key. `notificationBindingSnapshot.ts` freezes localized content/address/purpose; MAIL additionally retains connection generation and deterministic Message-ID. Reusing the same authentic UUID/recipient can reuse that send identity. It does not deduplicate a second notification UUID for the same Calendar moment. |

## Selective old-job scheduling evidence

Pinned a29 `scheduleReminder` passes an absolute Date computed as dueAt minus the fixed
lead, with singletonKey=activityId; it performs no application clamp. The installed and
lockfile-pinned PgBoss is12.38.0. Its Date path converts that value to ISO unchanged in
[`attorney.js:140–146`](/Users/ali/Developer/warpdrive-calendar/node_modules/pg-boss/dist/attorney.js:140),
and its insertion SQL casts that absolute timestamp directly in
[`plans.js:2869–2872`](/Users/ali/Developer/warpdrive-calendar/node_modules/pg-boss/dist/plans.js:2869).
Thus a known authentic, unchanged old job can retain the exact requested fire instant,
including a future instant. In this inspected Date path, even a past Date is retained
exactly and becomes immediately eligible; it is not clamped to insertion time.

That conclusion does not apply to every observed startAfter. Missing/immediate or
nonpositive numeric send options resolve to now; failure retries replace the timestamp
with retry delay/backoff (`plans.js:3086–3095`), resume/manual retry raise it to at least
now (`plans.js:2753,3791`), and update/upsert can rewrite it (`plans.js:3856`). Metadata
therefore may describe only the next eligible attempt. Neither created state nor
retryCount=0 proves an immutable original value. Known original enqueue provenance and
the absence of intervening queue mutation are additional conditions, not fields this
read invents from the timestamp.

The default Job shape has no startAfter. A compatible worker needs includeMetadata=true
or getJobById, whose result is JobWithMetadata (`types.d.ts:1141–1169`; `index.d.ts:71`).
Selective compatible handling may use a proven exact original fire instant, compare it
with the locked current schedule under an explicit policy, and record contemporary
receipt provenance. Metadata still does not record the original recipient, due snapshot,
version, civil-date certainty or personal/channel policy. Do not reconstruct those facts
from a fire timestamp or use it to reinterpret bare historical notification rows.

The actual SQL column is `start_after`, exposed as metadata `startAfter`:
[`plans.js:865`](/Users/ali/Developer/warpdrive-calendar/node_modules/pg-boss/dist/plans.js:865)
and [`plans.js:899`](/Users/ali/Developer/warpdrive-calendar/node_modules/pg-boss/dist/plans.js:899).
The original prepared diagnostic's three raw `startafter` projections were a source
setup defect discovered during this read. Root owns their minimal alias correction and
pending-pin supersession; no native run or failure evidence existed for that case.

## Concrete callback-to-takeover seam

The compatible callback must keep the shared Activity lock until notification production
and its trusted receipt record commit together. The real producer already returns either
the exact created UUID or suppression (`produce.ts:13–19,56–96`). The current
`notifyActivityReminder`/wire deliver seam returns void and swallows producer Result
errors (`wire.ts:13–24,84–107`), so takeover cannot recover that authoritative outcome
from the callback's return. A receipt-aware transaction seam must retain it explicitly;
searching for the latest similar notification after commit is not equivalent.

Minimum provenance to record contemporaneously is: server-owned legacy origin/version;
Activity and recipient; the locked due/temporal snapshot and observed authority revision;
the actual rule/fireAt whose effect is being claimed; channel authority separately from
channel enqueue/acceptance outcome; and the exact producer UUID or explicit suppressed
outcome. Define a retry-stable logical-effect key compatible with current sameMoment
semantics and an explicit rule for deliberate reauthoring. Serialize/retain one authoritative
mapping under the shared lock. An old job UUID alone does not identify every duplicate
old job for the same moment. No old payload attests its original due/version, and an
unprovable all-day civil date must remain unprovable.

If the compatible callback wins, takeover reads this committed proof under the same
Activity lock and excludes that already completed logical effect before making native
pending work. It retains the original notification UUID. If represented as a delivered
intent, its exact snapshot must match the authorized plan, and an explicit legacy-origin
history rule must prevent the new backlink from weakening existing denials or hiding
otherwise eligible history. A separate provenance record consulted by takeover avoids
manufacturing a native backlink for historical rows. The representation choice remains
with the accepted schema/admission review.

Bare historical notices without this proof remain historical notices. Do not fabricate
fireAt from createdAt, infer civil dates, choose one of ambiguous notices or blanket-import
them as delivered intents. Their missing provenance cannot be recovered by a marker change.

## History is not permission to send

- Current unlinked history survives automation=false only while its legacy policy and
  recipient/CRM/calendar gates permit it (`calendarPrivacy.ts:123–151`). Native backlink
  admission additionally requires delivered state, a permitted channel and current intent
  authority (`calendarPrivacy.ts:177–186`; `reminderAdmission.ts:99–105,145–157`). Merely
  attaching a delivered intent can therefore hide that history when automation is disabled.
  Any legacy-origin treatment must preserve own-policy denial and all explicit/invalid/
  ambiguous/cancelled/mismatched-reference fail-closed controls; no generic fallback.
- A retained inbox UUID proves no pending email authorization. `reminderEmailHandoff.ts:39–58`
  requires a currently eligible email channel and preference, then enqueues by that UUID.
  `reminderIntent.ts:65–70` can reopen handoff for an eligible channel addition. Imported
  historical visibility must not silently become such an addition. Do not reset existing
  MAIL attempts, suppressed/uncertain/accepted state, mailbox snapshot or emailSentAt.
- Public `notificationAdmissionPolicy.ts` currently checks recipient/account, CRM visibility
  and email preference, but no Calendar engine/ACL/due/settings/receipt/channel authority.
  Its systemPurpose identifies notification and recipient, not a Calendar moment. Root's
  required Calendar integration at the existing final MAIL admission boundary remains open,
  preserving MAIL locks and proven-unsubmitted/retained-outcome rules. A Calendar backlink
  neither replaces that boundary nor grants a new send.

This decision supplies the missing durable transfer contract. It proves no implementation,
row-lock race, consumer drain, canonical upgrade or provider behavior.
