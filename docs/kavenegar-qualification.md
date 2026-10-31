# Kavenegar qualification and SMS implementation contract

Research snapshot: **31 October 2026**. Scope: IG-07 in the [approved plan](local-integrations-plan.md), cross-referenced as SMS-001..016 by the [coordination amendment](integration-coordination.md). **Public-contract qualification plus the independently tested pure estimator below.** No customer account, key, provider API request, purchase, callback installation or SMS send was used. No provider adapter, complete workflow or migration is established by this document.

Kavenegar remains a suitable first adapter candidate. Public documentation supports development of a bounded adapter and realistic fixtures. Complete live qualification still needs an authorized account, sender line, test recipients and spending ceiling. Missing account capabilities must remain visible; they cannot be replaced with simulated success.

## 1. Public contract

### REST facts

The [official REST reference](https://kavenegar.com/rest.html) documents HTTPS, a key in the URL path, JSON `return.status`, Unix seconds and integer IRR costs. Request status `200` means acceptance, not delivery.

| Operation                  | Documented boundary                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `sms/send`                 | `receptor,message,sender,localid`; 200 recipients; ordinary SMS maximum 1,800 characters |
| `sms/status`               | 500 IDs; 48-hour lookup                                                                  |
| `sms/statuslocalmessageid` | 12-hour lookup; conflicting batch limits 3,000/500                                       |
| `sms/select`               | Full message details; source IP configuration required                                   |
| `sms/receive`              | 100 records; fetching marks records read                                                 |
| `sms/inboxpaged`           | 200/page; two-day query window; fetching marks records read                              |

| Provider status | Meaning                                       |
| --------------- | --------------------------------------------- |
| `1`             | Queued                                        |
| `2`             | Scheduled                                     |
| `4,5`           | Handed to carrier                             |
| `6`             | Failed                                        |
| `10`            | Delivered                                     |
| `11`            | Undelivered                                   |
| `13`            | Cancelled/problem; refund indicated           |
| `14`            | Recipient advertising block; refund indicated |
| `100`           | Unknown/invalid/archived/foreign identifier   |

`localid` is documented as `Long`; reuse returns the existing record. Message IDs are `Long`. Errors distinguish credentials (`403`), IP (`416,429,451`), credit (`418`), plan (`426`), line access (`427`) and test-account restrictions (`501`). Exact request-per-second quotas, deduplication retention and inbound body retention remain unestablished. A query window is not a retention guarantee. See the [same reference](https://kavenegar.com/rest.html).

### Callbacks and provider retry behavior

The [official solutions page](https://kavenegar.com/webservice-solutions.html) labels duplicate prevention and inbound URL delivery as advanced-service features. It describes LocalId as an ID or GUID, conflicting with the REST numeric type. It names inbound callback fields `Message`, `MessageID`, `From`, `To`. Non-200 callback responses trigger another attempt after one minute for up to 48 hours; successful inbound callbacks mark messages read. Delivery callbacks have the same retry description. An optional provider setting retries undelivered/failed sends once.

No cryptographic callback-signature scheme, signed timestamp/replay contract, exact delivery-callback payload or callback IP-range maintenance contract was established from these public pages. Treat callbacks as untrusted hints until an authoritative provider lookup confirms the event. Do not assume generic marketing references to SSL or Basic Auth specify callback authentication. The missing details require provider/account evidence before enabling callbacks.

### Account, line and commercial gates

The [official FAQ](https://kavenegar.com/%D8%B3%D9%88%D8%A7%D9%84%D8%A7%D8%AA_%D9%85%D8%AA%D8%AF%D8%A7%D9%88%D9%84.html) requires a dedicated line for inbound reception and describes configuring GET/POST callback URLs per line. Reissuing an API key invalidates its predecessor. A child key can be disabled; master-key rotation uses the console. The FAQ's unrestricted status-history and 200-item status-batch descriptions conflict with REST. It generally excludes refunds for ordinary undelivered messages, while describing advertising-block refunds. Do not make a blanket refund promise.

The [official pricing page](https://kavenegar.com/pricing.html) distinguishes service tiers, sender-line families, tariffs and a delivery-based offering for some lines. Its extracted feature table does not reliably preserve enabled/disabled indicators. Account-specific plan, line ownership, service-line approval, receiving rights, tariff basis and actual refund behavior therefore remain qualification items. No purchase or upgrade is implied. Do not route ordinary CRM messages through an OTP service to bypass line rights or suppression.

## 2. Library and transport decision

**Proposed:** a small native HTTPS adapter, using Warpdrive's existing endpoint policy, encrypted credential store, Results and AbortSignal conventions. Add no SDK dependency.

The [official Node SDK source](https://raw.githubusercontent.com/kavenegar/kavenegar-node/master/kavenegar.js) uses native HTTPS POST with URL-encoded forms. It lacks request cancellation/deadlines and bounded response buffering; parse failures are printed and network errors surface raw strings. Its wrappers cover send, status, local-ID status, select, receive and account operations, but not the current paged inbox or blocklist surface. This is an implementation assessment of the inspected source, not a claim that the service is insecure.

The [repository manifest](https://raw.githubusercontent.com/kavenegar/kavenegar-node/master/package.json) declares version 1.1.5, MIT and no production dependencies; its test script does not run tests. The [official npm registry metadata](https://registry.npmjs.org/kavenegar) returned latest 1.1.4, MIT, published 6 October 2018. These versions do not establish a maintained Bun-compatible integration. Copy no SDK code; keep the new adapter independently tested.

Proposed transport controls:

- Fixed provider host, verified TLS, all DNS answers validated, pinned connection address with original-host certificate validation; no caller-selected host, redirect or TLS-disable option.
- POST form bodies; explicit sender every time; server-selected method allowlist. Never expose the credential-bearing path in HTTP errors, traces, logs or client responses.
- Bounded request/response bytes, per-request deadline plus caller abort, finite operational errors, shared throttling and jittered backoff. A provider-body IP-denial code and HTTP throttling are separate conditions.
- Lossless decimal provider IDs stored as text. Accept JSON numeric IDs only when safe integers; unsafe or malformed identifiers are an uncertain result, never rounded identifiers. Use numeric local IDs until the conflicting GUID contract is qualified.
- Read account/configuration for a setup check, without sending. Never silently change supplier-wide retry, debug, default-sender or logging settings. A valid key does not prove that a particular line or inbound capability is usable.

## 3. Segments, text and cost

[ETSI TS 123 038 Release 18](https://www.etsi.org/deliver/etsi_ts/123000_123099/123038/18.00.00_60/ts_123038v180000p.pdf), sections 6.2.1/6.2.1.1, defines the default GSM alphabet and escape extension. Extension characters consume two septets. German umlauts and `ß` are present in the default alphabet. Persian text needs the Unicode path. [Twilio's encoding reference](https://www.twilio.com/docs/glossary/what-sms-character-limit) documents the usual GSM-7 160/153 and UCS-2 70/67 single/concatenated limits. These are estimator inputs, **not qualification of Kavenegar billing**.

Proposed shared estimator: inspect the exact rendered body; count GSM septets or UTF-16 code units; reject unpaired surrogates. Preserve Persian digits, ZWNJ, punctuation and message bytes. Do not transliterate, replace smart quotes or normalize text after confirmation. Non-BMP emoji handling and supplier segment charging need explicit pilot comparison. The UI labels segments/cost as estimates until the supplier result is reconciled.

| Fixture                            | Expected local estimate                           |
| ---------------------------------- | ------------------------------------------------- |
| `A` repeated 160 / 161             | 1 / 2 GSM segments                                |
| `^` repeated 80 / 81               | 1 / 2 GSM segments                                |
| `س` repeated 70 / 71               | 1 / 2 Unicode segments                            |
| `ÄÖÜäöüß`                          | GSM                                               |
| Smart quotes, Persian digits, ZWNJ | Unicode                                           |
| Emoji / malformed surrogate        | Qualified Unicode policy / reject malformed input |

Keep actual and reserved costs in exact canonical IRR, independent of FA/DE display and the chosen rial/toman unit. Supplier balance is informational; it does not replace application spending limits. Do not infer carrier or tariff solely from a mobile prefix. Keep actual charges and confirmed refunds as separate observations.

### Implemented pure estimator boundary

`src/features/sms/smsSegmentation.ts` exports `estimateSmsSegments(input: unknown)`, returning the existing Result type. Success preserves `originalText` exactly and returns encoding `gsm7|unicode`, unit `septet|utf16_code_unit`, total units, segment count, per-segment units and the single/multipart capacities. `estimateOnly` is always true; `provider_billing_unqualified` is always present. Supplementary characters also produce `non_bmp_unqualified`; their UTF-16 estimate does not claim that an UCS-2-only provider supports them.

Packing treats each extension symbol and each surrogate pair atomically. This can require more parts than `ceil(totalUnits/capacity)`: 153 carets need three parts `[152,152,2]`; 67 emoji also need three `[66,66,2]`. No normalization, trimming, transliteration or line-ending rewriting occurs. CR/LF are accepted and counted separately. C0/C1 controls, including literal ESC, DEL, tab and form feed, are rejected; tab/form-feed behavior is not qualified. Persian ZWNJ/ZWJ and decomposed German text are preserved. This is scalar-safe packing, not a grapheme-cluster encoder or a provider packetizer.

Typed errors are `invalid_type`, `empty_text`, `invalid_utf16` and `unsupported_control`; the last two report only the UTF-16 index, without echoing message contents. Whitespace-only bodies are rejected. There is no provider length cap, account check, send permission, rate limiter, price calculation or IO in this utility; future callers retain those responsibilities.

The scoped suite covers 133 boundary/validation/preservation cases in `smsSegmentation.test.ts`, including GSM extensions, Persian/German strings, all prohibited C0/C1 controls, malformed surrogates, Unicode switching and non-BMP uncertainty. It is local utility evidence only, not provider or UI acceptance.

## 4. Shared domain and DDL surface — proposal for CONN/EVT owners

**Do not allocate a second connection registry or delivery queue.** Resolve platform/mail migration heads and named ownership first. The following are logical records/constraints for the agreed shared contracts; final table names and migrations belong to the schema owner.

Coordination provenance: on inspection, `integration-coordination.md` was untracked, and its referenced `docs/integration-execution/tasks.csv` and two task-import/override CSVs were absent from this worktree. Its lines 22/30 explicitly require named ownership and reconciliation of planned foundations with actual code. No implemented general CONN registry or EVT contract was established here; no author/chat identity can be inferred from an untracked file. The root maintainer must resolve these references with the platform owner before assigning SMS source or DDL. The additive mail migrations and mail security implementation remain owned by their current writers.

Subsequent coordination: the root maintainer reports agreement with the actual platform owner on shared interfaces and migration reservations. Generic credential and EVT APIs remain design contracts, without live exports available to this utility. The independently authorized estimator adds no registry, queue or schema. The root-owned [reconciliation handoff](mail-platform-reconciliation.md) tracks consolidation; SMS DDL remains outside this increment.

| Logical record      | Required fields and constraints                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared connection   | Installation-managed connection ID/provider; encrypted key; credential version; dispatch generation; paused/disconnected state; qualification/capability revision; nonsecret config allowlist; audit provenance                                                                                                                                |
| SMS line            | Shared connection FK; exact provider service address; verified rights/capabilities; generation; state. Unique connection + service address. A service address is not a personal E.164 number.                                                                                                                                                  |
| Sender grant        | User/group + line + separate send/read/manage permissions; revision; revocation audit. Contact/deal visibility remains independently enforced.                                                                                                                                                                                                 |
| Message             | Direction, line, canonical remote number, preserved input, encrypted rendered body, actor/visibility, optional permitted contact/deal links, provider identifier. Unique connection + line + direction + provider ID.                                                                                                                          |
| Send intent/attempt | Agreed shared delivery-intent reference; immutable body/recipient/sender snapshot and payload hash; actor; line/grant/connection revisions; stable client idempotency key; stable provider local ID; lease; submission outcome; delivery state; budget reservation. Unique actor + line + idempotency key, and connection + provider local ID. |
| Receipt observation | Append-only verified observation or untrusted hint; source; provider status; event/received times; bounded redacted metadata. Replays cannot create another message or regress a verified delivery.                                                                                                                                            |
| Suppression         | Canonical recipient + installation/line scope; reason/source; explicit release audit. Provider block hints do not become verified outcomes without reconciliation.                                                                                                                                                                             |
| Limits/reservations | Configured count/segment/IRR caps per actor, line and installation; period; atomic reservation and settlement; exact numeric amounts. Unknown outcomes retain reservation until reconciled or explicitly reviewed.                                                                                                                             |
| Inbox checkpoint    | Line/generation; bounded overlap window, page/lease and recovery coverage. Supplier-read state is separate from a CRM user's read state.                                                                                                                                                                                                       |
| Template version    | Permitted merge fields; message language; version; rendered-body snapshot. Template language never follows the operator's UI language implicitly.                                                                                                                                                                                              |

Reuse shared proof, audit, revocation, encryption, authorization and job foundations. A connection installed by an administrator remains installation-managed when its creator leaves; their grants and queued personal authority are revoked. Do not invent a tenant ID or a second auth model. Sensitive setup/rotation/line-grant/limit changes require current native authentication and the existing fresh/MFA policy fence. A bearer/MCP token is not a substitute for that proof.

Suggested internal API; all inputs from callers are validated as unknown, all IO accepts AbortSignal, and all operations return Results with finite public errors:

```ts
checkSmsConnection(db, nativeContext, input, signal); // read-only, no send
saveSmsConnection(db, nativeContext, proofInput, signal);
mutateSmsConnection(db, nativeContext, mutation, signal);
setSmsSenderGrant(db, nativeContext, input, signal);
saveSmsDraft(db, actorContext, input, signal);
previewSmsSend(db, nativeContext, draftInput, signal);
confirmSmsSend(db, nativeContext, confirmation, signal);
dispatchSmsIntent(db, durableIntentId, signal); // agreed shared delivery worker
reconcileSmsAttempt(db, attemptId, signal);
syncSmsInbox(db, lineId, expectedGeneration, signal);
receiveSmsCallbackHint(db, untrustedHint, signal);
```

Preview produces a short-lived, session-bound proof for the frozen body, expanded recipients, sender line, revisions, segments and maximum reserved IRR. Confirmation rechecks policy/visibility/grants/suppression and available limits under the shared lock order, then reserves and enqueues atomically. Reusing its idempotency key returns the same intent. Reusing it for a changed payload fails.

No numeric production spending cap is invented here. Sending stays disabled until an administrator explicitly configures positive finite volume/segment/IRR ceilings and the applicable tariff ceiling. Unknown tariff cannot become an unbounded reservation. Concurrency tests must prove that two confirmations cannot spend the same remaining capacity.

## 5. Delivery and recovery rules — proposed behavior

Maintain separate submission and delivery states. An accepted API response cannot label a message delivered. A timeout, abort after possible transmission, malformed success or crash between external acceptance and local persistence creates an uncertain submission. It must not enqueue a fresh provider identifier or blindly resend.

Persist the stable provider local ID and frozen request before network dispatch. Reconcile within the qualified lookup horizon and verify sender, recipient and body identity before adopting a recovered record. Deduplication namespace, cross-application collision behavior and retention need qualification. Same-ID retry is enabled only after that capability is established for this account; expired/ambiguous outcomes remain reviewable. A new manual send needs a new explicit confirmation that explains the possible duplicate and holds the original charge reservation separately.

Provider polling is authoritative; callbacks only schedule bounded reconciliation. Persist a hint/reconciliation job before HTTP acknowledgement. Use a high-entropy callback route secret as defense in depth, bounded parsing and rate limits; it does not establish provider authenticity. No callback can grant access, directly render untrusted HTML, unsuppress a recipient or dispatch another message.

Poll read and unread inbound ranges with overlap and message-ID deduplication to recover a crash after fetch but before local commit. Revisit page ranges when fetching changes their membership. Checkpoints advance only after durable storage; retention gaps become visible recovery gaps rather than an empty success. Provider inbox read flags never mark a CRM conversation read.

Verified delivery is not downgraded by an older queued/carrier/unknown observation. Conflicting terminal outcomes remain in history and trigger review. Keep the latest verified state when a later lookup loses history. Suppression, limits, actor activity, sender grants and generation are checked again before dispatch. Authority-changing mutations fence stale jobs; a credential version is separate from dispatch authority. An already admitted external request may still complete. No database lock is held across provider IO.

## 6. FA/DE/EN workflow and acceptance contract

Preserve the current shell and shared form/dialog/status components. Deliver connection setup, line entitlement review, sender grants, recipient review, manual/template composer, preview/confirmation, per-recipient history, inbound conversation/contact linking, suppression, quotas and recovery together. Unsupported capabilities are shown explicitly and rejected on the server. Shared lines must never expose private contact data to another user through matching, history or notifications.

| Meaning           | Farsi                                      | German                               | English                            |
| ----------------- | ------------------------------------------ | ------------------------------------ | ---------------------------------- |
| Queued locally    | در صف ارسال                                | In der Warteschlange                 | Queued                             |
| Provider accepted | ثبت‌شده در سامانهٔ پیامک                     | Vom Anbieter angenommen              | Accepted by provider               |
| Carrier handoff   | ارسال‌شده به شبکهٔ تلفن همراه                | An das Mobilfunknetz übergeben       | Handed to carrier                  |
| Delivered         | رسیده به گیرنده                            | Zugestellt                           | Delivered                          |
| Undelivered       | به گیرنده نرسید                            | Nicht zugestellt                     | Undelivered                        |
| Uncertain         | وضعیت ارسال نامشخص است؛ نیاز به بررسی دارد | Ausgang unklar; Prüfung erforderlich | Outcome uncertain; review required |

Farsi first, then German: all validation, permissions, fresh-auth expiry, limits, callback-disabled states, partial results, unknown outcomes, disconnect and manual provider-side rotation instructions need contextual copy. Display sender/recipient addresses and identifiers with bidi isolation. Selected phone country and recipient/template language remain independent of UI language. Use the [qualified phone/date/money conventions](data-conventions.md).

Before merging implementation, require test-first adapter fixtures and real PostgreSQL coverage for simultaneous confirmations, budgets, suppression, hidden contacts, revoked grants, offboarding, proof replay, stale generations, crash recovery, duplicate/out-of-order observations, redaction, malformed/oversized responses and provider-read side effects. Qualify abort/deadline/TLS/pinned-DNS behavior with controlled local servers. Exercise FA/DE/EN UI states, keyboard/focus, RTL/LTR, mobile and light/dark. Record production builds and operator recovery separately from live delivery evidence.

## 7. Remaining live qualification gates

1. Explicitly authorized account access, dedicated sender line, recipient test numbers, maximum spend and send count. No development approval silently supplies these.
2. Exact plan/API capabilities, numeric local-ID range/namespace/retention, callback entitlement/authentication/payload/retries and actual rate limits.
3. Read-only setup checks with correct egress IP, line rights, provider retry/debug settings and safe key rotation. No setup SMS.
4. Approved Persian/German segment vectors, actual charges/refunds, Unicode/emoji behavior and per-recipient outcomes.
5. Inbound body retention, read/unread recovery, pagination stability, outage beyond the available history, duplicate receipts, callback replay and mismatched sender/recipient identity.
6. Export/restore of encrypted message history, checkpoints, reservations and stable identifiers without replaying external sends; revoke/disconnect and reinstallation cannot resurrect authority.

Until these are recorded, release wording is **public contract reviewed / pure estimator tested / provider adapter pending**, never “Kavenegar fully supported.” Register implemented, controlled-server, fixture and authorized live evidence as separate states. Coordinate subsequent Melipayamak and other qualified providers through this same SMS/CONN/EVT contract rather than duplicating it.
