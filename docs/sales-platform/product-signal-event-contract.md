# Proposed first-party product-signal V1 contract

1 November 2026. Reviewable original specification for subsequent test-first work,
derived from [the source decision](product-signal-source-decision.md), approved
TASKS.csv SP-12.1 through SP-12.8 and INTEGRATION-SAFETY.md. All event names,
limits, thresholds and algorithms below are proposed, unqualified design choices.
No parser, evaluator, connector, storage, permission or UI is implemented by this
specification. No actual source is qualified. All SP-12 parent tasks remain open.

## Smallest useful increment

Build a pure strict event-object parser and a bounded synthetic dry-run evaluator.
They can demonstrate validation, explicit identity states, duplicate/conflict
classification and an explainable example of completed product work without an
HTTP route, DB, queue, credential, provider, persistent record or business effect.
They must not export a production admission decision or a contact/deal command.

SP-12.1 still requires an actual permitted source and operational owner before a
connector. SP-12.2 also depends on SP-06.2 identity contracts. This pure preparation
does not replace either gate. Native ingestion and follow-up remain unavailable.

## Candidate event-object contract

Proposed name: `ProductSignalEventV1`. Accept an object with exactly these keys:

| Key          | Exact candidate bound                                                                     | Reason                                                                          |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `version`    | Integer literal `1`, required                                                             | Explicit schema evolution; future versions refuse intact.                       |
| `eventId`    | Required opaque source ID, whole-string ASCII grammar `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` | Stable retry identity without requiring the source to adopt a new UUID version. |
| `eventName`  | One of the five exact names below                                                         | Deliberate domain events, no arbitrary tracking vocabulary.                     |
| `accountId`  | Required opaque source ID using the same 1 to 128 byte pattern                            | Explicit product account; never inferred from actor/email.                      |
| `actorId`    | Optional opaque source-user ID with the same bound; absent is allowed, null/empty is not  | Account-level events need not manufacture a person.                             |
| `occurredAt` | Required strict timestamp profile below, at most 29 ASCII bytes                           | Keep event and receive time distinct and ordering reproducible.                 |
| `properties` | Required event-specific strict object below                                               | No arbitrary property bag, content or hidden routing instructions.              |

Every ID character must fit that grammar; leading/trailing whitespace and trailing
newlines are invalid. IDs are case-sensitive and retained exactly; no trimming,
case folding, Unicode normalization, numeric coercion, URL decoding or email/domain
matching. A UUID
already fits the opaque-ID grammar. A syntactically valid ID can still encode
personal information, so this parser cannot certify source purpose or data
minimization. A qualified producer must emit opaque stable identifiers, not names,
email addresses, telephone numbers, message text or customer record content.

| Event name                   | Exact required properties                         | Meaning of the proposed producer event                                         |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pipeline.created`           | `{pipelineId: SourceId}`                          | A successful committed creation, not opening its dialog.                       |
| `opportunity.created`        | `{opportunityId: SourceId}`                       | A successful committed creation in this product account.                       |
| `follow_up.completed`        | `{opportunityId: SourceId, activityId: SourceId}` | A successful committed work completion linked to that opportunity.             |
| `account.user_added`         | `{memberId: SourceId}`                            | The product user was actually added; an invitation being sent is insufficient. |
| `sales_assistance.requested` | `{requestId: SourceId}`                           | An actual submitted request, only if a future product offers that operation.   |

All property values use the same SourceId bound. Maximum seven top-level keys,
maximum two property keys, no nested property objects/arrays, optional properties,
free text, URLs, money, counters or extra keys. Do not infer an existing assistance
feature or instrument one merely because the event grammar can describe it.
`account.user_added.actorId` is the initiator, not necessarily `memberId`.

Timestamp profile: four-digit Gregorian year 0001 through 9999;
`YYYY-MM-DDTHH:mm:ss`, optional one to three fractional second digits, followed by
uppercase `Z` or an explicit `+HH:mm`/`-HH:mm` offset. Validate real month/day and
leap-year combinations; hours 00 through 23; minutes/seconds 00 through 59; offset
no greater than 14:00, with minutes zero at either 14-hour extreme. Reject leap
seconds, `24:00`, missing offsets, lowercase variants and unknown-offset `-00:00`.
Retain the authored timestamp and derive an integer UTC millisecond instant;
equivalent offsets denote the same instant. Do not silently repair invalid dates.

The proposed native single-event body limit is 4096 raw UTF-8 bytes, including
whitespace. There is no batch intake in V1. That gives ample space for this small
fixed grammar while bounding intake work. The object parser alone cannot enforce
raw-byte, duplicate JSON-key, decoding or pre-parse depth limits. A later native
transport must bound bytes before allocation/parsing and reject ambiguous duplicate
keys and invalid UTF-8. Do not advertise those protections from object-unit tests.

## Source, destination and identity authority

Destination context, registered source ID, source environment/generation, receive
time, source-enabled state, identity mapping, suppression and retention policy are
server-owned. None is an accepted event key. In particular, a submitted workspace,
CRM organization/person, source ID, authority token, permission, receive time,
rule ID, retention duration or follow-up flag is an unknown-key rejection.

Later transport must derive the destination and source from validated native
context and the qualified source registration, never from a payload account ID.
The current single-installation model must not acquire an invented parallel tenant
or auth store. Future SP-14 isolation needs its own reviewed authority contract.

`accountId` identifies the product account in a particular registered source.
An explicit, unambiguous mapping relates it to an existing permitted CRM customer
organization. That customer organization remains separate from auth/workspace
membership. A source-user ID is neither a CRM person nor a destination user.
Account-level evidence can use an explicitly permitted pseudonymous product-user
identifier without creating a CRM contact; a person association requires a separate
reviewed mapping. Never merge by matching email, phone, name or company domain.

The dry-run fixture has one current source/account/subject context for the whole
batch. Delivery records contain no authority, mapping or suppression state.
Current state is looked up explicitly from two bounded arrays:

- `accounts`, at most 100 entries, uniquely keyed by source `accountId`: identity
  `mapped`, `unmapped` or `conflict`; suppression `clear`, `suppressed` or `unknown`.
- `users`, at most 200 entries, uniquely keyed by `(accountId, userId)`: identity
  `account-only`, `mapped`, `unmapped` or `conflict`; suppression `clear`,
  `suppressed` or `unknown`. An entry applies to both actors and other referenced
  product users, including `account.user_added.properties.memberId`.

A missing account/user entry means unknown current subject state, never permission.
Duplicate lookup keys make the fixture invalid; the evaluator cannot choose the
most favorable entry or use delivery order to resolve contradictory state.
`account-only` explicitly permits the synthetic account-level example without a
CRM-person association; it is not a fallback after a failed person lookup. An
absent event actor needs no invented anonymous user or lookup entry.

Each mapped account and each mapped/account-only user entry also requires a
`mappingRevision` opaque SourceId and `effectiveFrom` timestamp. Those fields are
current fixture facts, not submitted event authority. A changed association or a
transition from unresolved to mapped starts a new revision/effective time. An
otherwise eligible event whose occurrence or original receive instant precedes
any referenced current mapping's `effectiveFrom` gets `mapping_review_required`
and does not contribute. V1 has no override that automatically promotes such
historical data; a later reviewed reconciliation contract is separate work.

Current source state and subject suppression apply across every delivery and
semantic duplicate group. Suppression excludes the whole event; never remove its
actor or member ID and retain it as anonymous account evidence. Unavailable current
subject state or unresolved/conflicting required identity would quarantine it.
The fixture is a synthetic snapshot, not a guarantee of native lookup freshness,
locking, after-wait authorization or durable suppression.

## Time, duplicate, deletion and replay boundaries

Candidate bounds below are versioned engineering hypotheses, not a legal retention
decision or an assertion about a provider. Native values need the source/privacy
owner's reviewed contract before ingestion is enabled.

| Boundary                   | Exact proposed dry-run behavior                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Future clock               | Event time later than receive time plus five minutes: `would_reject`, code `future_clock`. Equality is allowed. A tolerated future event later than evaluation time is `would_defer` and contributes no current evidence. Never clamp its time.                                                              |
| Late arrival               | Receive time minus event time greater than 24 hours: mark `late`. Equality is on time. Late evidence stays visibly late; it never authorizes retroactive follow-up.                                                                                                                                          |
| Replay age                 | Event time earlier than receive time minus 30 exact 24-hour days: `would_reject`, code `outside_replay_window`. Equality is allowed. This is an admission-age bound, not raw-data or tombstone retention.                                                                                                    |
| Duplicate scope            | Tuple of server-owned destination, registered source ID, source generation and source `eventId`; never event ID alone or actor ID. Only syntactically valid parsed events enter a semantic group. Same ID is reused for retries.                                                                             |
| Identical duplicate        | Same normalized business fields within that tuple: one evidence item. Differing JSON key order or equivalent timestamp offset does not create another item. Preserve original receive time; retry arrival is not a new activation date.                                                                      |
| Conflicting duplicate      | Same tuple with changed name/account/actor/time/property value: `would_quarantine`, code `event_id_conflict`; no version of that conflicting identity contributes to the example result. No last-write-wins replacement.                                                                                     |
| Import/backfill            | Provenance is supplied by the fixture's simulated server context. Historical/import mode is disclosed and excluded from the live-reference rule by default, even if the first delivery has a new ID. Submitted properties cannot promote it.                                                                 |
| Deleted/suppressed subject | Resolve current group/account-wide context for every account, actor and member referenced by any copy. Suppression excludes the group before evidence aggregation, regardless of earliest delivery. Replay or remapping does not remove it. Rebuild starts from current state, not only old acceptance rows. |

Apply this deterministic order before evaluating any rule:

1. Validate the fixture structure and unique current-state lookup keys. Parse each
   contained event strictly. An invalid event is `would_reject`, identified only
   by its bounded record index and safe issue codes/known paths. Do not extract
   its untrusted event/account/actor IDs into diagnostics or duplicate groups.
2. Group syntactically valid parsed events by the exact duplicate-scope tuple.
   Compare all normalized business fields. A future/old event is still syntactically
   valid for grouping; relative-time handling cannot hide a conflicting copy.
3. Collect all accounts, actors and member subjects referenced by every parsed
   copy in a group. Apply current source and subject context across that whole
   set, before selecting an earliest delivery. A non-active source returns
   `would_reject`; any suppressed subject returns `would_reject`; unknown current
   subject state returns `would_quarantine`. These gates outrank every copy.
4. With those gates clear, semantic conflict returns `would_quarantine` with
   `event_id_conflict`; no copy contributes. Unmapped/conflicting required identity
   also quarantines. A newly favorable mapping cannot bypass the original receive
   and occurrence versus current `effectiveFrom` history check.
5. Only an otherwise admissible identical group selects the earliest injected
   receive instant and its provenance. On an exact receive-time tie, historical
   provenance wins and the lexically first authored timestamp is retained. Apply
   time/provenance rules and expose at most one evidence item; other identical
   deliveries are duplicates. No later delivery repairs an earlier admission state.

Group diagnostics may retain bounded conflict/late flags, but a favorable duplicate
label never overrides a blocking current state. Output order is deterministic by
source tuple/event ID, not input-array order. Semantic comparison covers only the
known normalized business fields; it is not cryptographic authenticity. Current
identity/suppression/source state is never part of a selectable delivery payload.
Invalid diagnostic records disclose no payload values. Blocked group diagnostics
use record indices and bounded codes; contributor IDs appear only for eligible
synthetic evidence, not as a way to disclose suppressed subjects.

No durable dedup or deletion guarantee follows from an in-memory example. Native
dedup uniqueness and acceptance must be atomic under actual PostgreSQL concurrency.
Deletion must also invalidate derived evidence, queues, caches, exports and any
allowed downstream history according to the owning privacy contract. Minimal
tombstones and their permissible retention remain a shared design decision.
Expiring an event/dedup row must not make a deleted account/user admissible again.
If suppression history cannot be established after cleanup/restore, fail closed;
do not claim the 30-day age bound alone prevents resurrection or event-ID reuse.

Pausing/revoking a source closes new native admission and future effects. It does
not silently erase historical business records or allow a new source generation
to bypass suppression. Restore/rebuild starts without outbound activation.

## Pure API shape and reference rule

Candidate responsibilities, not implemented exports:

1. `parseProductSignalEventV1(input: unknown)` returns a Result containing a strict
   discriminated event or bounded validation issues. No I/O, environment, clock,
   hashing service, mutation or authorization lookup. Issues contain stable codes
   and known schema paths only, at most eight; never echo rejected values or
   unknown property names into diagnostics.
2. `previewProductSignalsV1(fixture)` accepts at most 100 event records plus
   explicit receive instants, simulated source/identity/suppression/provenance
   states, source-completeness state and one evaluation instant. Its context is
   synthetic input, not a reusable validated native-context type. It deterministically
   classifies events and computes the original reference rule below. No hidden
   current-time reads, persistent quarantine, provider client or command callback.

Keep the first preview fixture explicit and single-scope: literal `version: 1`
and `mode: synthetic-dry-run`; one `scope` containing `destinationRef`,
`registeredSourceRef` and `generationRef` using the SourceId grammar; one current
source state `active`, `paused`, `revoked` or `unavailable`; coverage `complete`,
`incomplete` or `unknown`; one `evaluationAt`; the current `accounts` and `users`
lookup arrays above; and zero through 100 records. Each delivery record has only
`event`, `receivedAt` and provenance `live`/`historical`. It cannot carry identity,
suppression, mapping revision, source state or an override. Unknown record/context
keys refuse rather than supplying alternate authority.

Times use the strict profile; receive time and current mapping `effectiveFrom`
cannot exceed evaluation time. Fixture structure errors return a bounded fixture
error. Invalid contained events return record-indexed safe rejection diagnostics,
without extracting identifiers. A non-active source contributes no simulated new
admissions. References, mappings and provenance here are synthetic scenario values,
never credentials or assertions about an actual native context. Cross-source and
destination tests use separate fixtures; there is no process-global dedup state.
No native source status or retention lookup is implemented by this fixture shape.

Every preview result carries literal `mode: synthetic-dry-run`, `persistence: none`,
`nativeAdmission: unavailable`, `followUp: unavailable` and an empty effects list.
Use `would_accept`, `would_quarantine`, `would_reject`, `would_defer`, `duplicate`
and `excluded_historical` for simulated dispositions. A parsed/accepted example is
not a connected source, authorized record query or accepted production event.

Original reference rule ID: `warpdrive-work-loop-example`, version 1. Rolling
window is `(evaluationAt - 14 exact 24-hour days, evaluationAt]`. It uses event
instants, never arrival order or the operator's selected calendar/timezone.

- Setup: list distinct eligible `pipeline.created` evidence; it is context only.
- Activation example: one `opportunity.created` followed at the same or a later
  instant by `follow_up.completed` for the same source/account/opportunity, with
  both events in the window. Equal instants are disclosed as timestamp-limited
  ordering; they do not prove finer causal order. Use the earliest matching
  completion and count an opportunity at most once. This describes historical
  successful work, not the activity's current completion state.
- Repeated-use example: at least two distinct completed opportunity loops, on at
  least two UTC dates, with earliest/latest completion separated by at least
  24 hours. The interval guard avoids treating a midnight boundary a minute apart
  as repeated use. Show the exact UTC-day basis and threshold as a hypothesis.
- Collaboration context: disclose distinct known product actors on completed
  work and any `account.user_added` evidence separately. Missing actors stay
  unknown. Do not infer present membership or team adoption from an invitation,
  one added-user event or old work; full collaboration qualification is deferred.
- Declared intent: show eligible assistance-request event IDs/times separately;
  no synthetic native assistance feature, conversion prediction or contact grant.
- Fit: `unknown`, reason `fit_not_supplied`. Team-size bands and other fit
  attributes need their own owner-approved account contract; no inference from
  locale, country, names, user counts or guessed domains.

The preview returns no universal score, probability or overall qualified-opportunity
flag. Per dimension use `observed`, `not_observed_in_example` or `unknown`, with
stable reason codes, rule version, exact window, thresholds, contributing event IDs,
missing evidence and excluded/late/duplicate/conflict counts. Positive observed
evidence remains visible during incomplete source coverage; absence becomes
`unknown` when coverage is unknown/incomplete. A non-active source or unavailable
current subject context also makes affected missing evidence `unknown`, even if
the fixture claims complete coverage. A source outage is never inactivity.

## Meaningful subsequent test-first matrix

These are proposed tests, all unrun. Keep unit parser/preview proof separate from
real transport/DB/auth/retention and working-browser proof. Do not mock SQL.

| Pure-core test family           | Load-bearing oracle                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Five legal event shapes         | Each exact variant parses with its required properties; source IDs and authored timestamp survive unchanged.                                                                                                                                                             |
| Strict grammar and bounds       | Missing/null/wrong-version/unknown top or property keys, arrays, arbitrary text, empty/129-byte IDs and non-ASCII IDs refuse; 1/128-byte bounds pass. No coercion or silent stripping.                                                                                   |
| Timestamp boundaries            | Leap/non-leap Feb 29, invalid month/day, missing offset, 24:00, leap seconds, -00:00 and offsets beyond 14:00 refuse. Equivalent offsets produce the same instant without rewriting authored time.                                                                       |
| Safe issues                     | Unknown attacker key/value containing sensitive text never appears in errors. Invalid records containing plausible IDs remain record-indexed rejects, never dedup identities; error count and known paths stay bounded.                                                  |
| Authority confusion             | Submitted destination/source/receivedAt/CRM-person/rule/follow-up fields refuse rather than changing fixture context.                                                                                                                                                    |
| Mapping and suppression         | Unmapped/conflicting required subjects quarantine; account-only use needs an explicit current lookup state. Suppressed accounts, actors or member subjects exclude every copy. Missing/duplicate context cannot choose a favorable state or invent anonymity.            |
| Duplicate identity              | Retry gives one item; separate source/destination fixtures remain independent; changed semantic content quarantines the entire parsed group. Invalid copies do not enter semantic grouping or disclose IDs. Reverse input order yields the same result.                  |
| Context outranks first delivery | An earliest valid delivery cannot win against current paused/revoked source, account/actor/member suppression or unavailable state. A conflicting copy referencing a suppressed subject never leaves an accepted earlier contribution. Per-record authority keys refuse. |
| Mapping history                 | Changing current mapping to favorable does not promote records whose occurrence/original receive precedes its effective time; replay retains the original history boundary and yields `mapping_review_required`.                                                         |
| Boundary instants               | Exactly +5 minutes, 24 hours late and 30 days old versus one millisecond beyond; tolerated future cannot contribute before evaluation time.                                                                                                                              |
| Work-loop specificity           | Wrong account/opportunity, completion before creation, missing creation, outside-window boundary and duplicate completions cannot satisfy a loop. Valid matched pair does.                                                                                               |
| Repeated-use threshold          | One loop, same opportunity repeated, same UTC day and less than 24 hours fail the example threshold; two distinct loops/days separated by 24 hours pass. Explain exact contributors.                                                                                     |
| Independent dimensions          | Setup alone does not activate; intent alone does not show repeated value; fit remains unknown; unknown actor is not an anonymous contact or false collaboration proof.                                                                                                   |
| Outage/history/deletion         | Missing evidence with incomplete coverage is unknown; historical import is excluded; suppression applied before rebuild removes prior contributors and replay does not restore them.                                                                                     |
| Pure reproducibility            | Frozen input/evaluation instant produces identical output regardless of external clock, locale and input permutation; 100 records allowed, 101 refused; effects always empty and inputs unchanged.                                                                       |

Later native proof must independently cover: body size/UTF-8/duplicate-key limits;
real authenticated source/destination and revoke-after-wait authority; bounded
rate admission/backpressure without job flooding; atomic duplicate/conflict races;
unknown identity quarantine/read permissions; deleted-user/account replay after
raw expiry, tombstone cleanup and backup restore; actual retention and downstream
cache/export deletion; historical/late thresholds without retroactive effects;
and stable shared WF/IG follow-up receipts under retries/flapping. None can be
proved by supplying favorable context to the pure evaluator.

## FA/DE/EN workflow implications

Use existing SettingsCard/Dialog/Select adapters. Start with an explicitly synthetic
example and visible source status. Keep product account, optional CRM company,
optional person mapping and destination context visually distinct. Show the
explanation before any future action. Never label a parsed event as connected,
qualified or permitted to contact. Source setup may remain a draft with the owner
missing; do not send the user another technical source-selection question.

| Intent           | Farsi proposal                                        | German proposal                                                  | English proposal                                               |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Example          | نمونهٔ آزمایشی با داده‌های ساختگی                       | Beispiel mit synthetischen Daten                                 | Example with synthetic data                                    |
| Unmapped         | ارتباط حساب محصول با سازمان مشتری هنوز مشخص نشده است. | Das Produktkonto ist noch keinem Kundenunternehmen zugeordnet.   | This product account is not mapped to a customer organization. |
| Late             | این رویداد با تأخیر دریافت شده است.                   | Dieses Ereignis wurde verspätet empfangen.                       | This event arrived late.                                       |
| Missing coverage | داده‌ها برای نتیجه‌گیری کافی نیستند.                    | Für eine Aussage fehlen Daten.                                   | There is not enough data to draw a conclusion.                 |
| No effect        | این پیش‌نمایش چیزی ذخیره نمی‌کند و پیامی نمی‌فرستد.      | Diese Vorschau speichert nichts und versendet keine Nachrichten. | This preview saves nothing and sends no messages.              |

Copy is proposed original wording, not contextual native-language acceptance.
Farsi is first, RTL uses current Vazirmatn; German/English retain existing shell
and Inter. Keep opaque IDs LTR-isolated and stable, untranslated. Use existing
regional formatting for displayed instants while labeling the rule's UTC basis;
locale/calendar/timezone changes never alter evidence IDs, event instants or rule
meaning. Complete states need keyboard/screen-reader and narrow-layout review:
empty example, invalid input, unknown identity, duplicate, conflict, late/future,
source paused/outage, deleted/suppressed data, missing fit and unavailable follow-up.

No vendor compatibility, source installation, real product adoption, causality,
privacy clearance, outreach authorization or release qualification is claimed.
