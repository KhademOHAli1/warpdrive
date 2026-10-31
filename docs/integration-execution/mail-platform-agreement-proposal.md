# Shared mail/platform agreement proposal

31 October 2026. Coordination authority was verified directly in source chat
`01a18868-3300-7dc2-b49d-c3bdb067fae7`: human reply
`01a1924c-6aa0-76d0-bff9-7b71b09604d8`, “Yes, coordinate these shared interfaces”.
This authorizes the chats to coordinate APIs and migration numbering. It does not authorize
real provider actions, change either goal or import the separate 586-row planning draft.

Mail's prepared `docs/mail-platform-reconciliation.md` was read in
`/Users/ali/Developer/warpdrive-integrations`. Its current committed head is
`a1a8f6da1ce366c35002900bf33508356dfbb995`; mail code/migrations remain uncommitted.
Platform checkpoint is `82f76438d1a4e41b8d3b8ed8edffceb76ed41c66`, qualified source
`89adc8158f3e04c14e48ed6258e14abf3f179cc7`. Preserve both source trees and previews.

## Named responsibility

| Owner                                                | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mail chat `01a18868-3300-7dc2-b49d-c3bdb067fae7`     | Existing MAIL domain/schema, native connection checks/proofs, endpoint/DNS/TLS primitive, current credential/generation fences, IMAP/SMTP, send attempts/repair, mailbox UI and IG-06 conventions. Prepare the immutable mail handoff and proposed rebased mail DDL. Its approved SMS domain/provider work can consume shared interfaces after agreement without creating a registry/queue/credential engine. |
| Platform chat `01a19217-d257-7813-88e0-cf41cb36d93a` | Canonical integration registry, shared connection/grant/capability/lifecycle contract and final integrated migration journal/snapshots; common event/admission/effect contract and existing pg-boss/workflow integration. Own shared binding/authority/event DDL after mail's reserved range.                                                                                                                 |
| Workflow peer                                        | Existing engine/editor and its own reviewable commits. Platform adopts an immutable cut and qualifies it; neither chat builds another engine.                                                                                                                                                                                                                                                                 |

The provider registry and seven-operation runner are implemented. The shared credential
broker, richer persisted lifecycle, generic grant intersection and event outbox/delivery
API are architecture contracts, not currently exported runtime services. Do not point mail
or SMS code at imagined exports or substitute the synthetic fixture for provider conformance.
The current runner's initial exchange candidate is OAuth2 Bearer-shaped; do not encode SMTP
passwords/API keys as fictitious Bearer grants just to satisfy that profile.

## Proposed single migration allocation

The platform's applied/reviewable history remains immutable:

- 0083 integration connections.
- 0084 adopted workflow schema, retaining original version/pinned-run safeguards.

Reserve **0085 through 0091 exclusively for the mail handoff**. Platform will not allocate
inside that range. Proposed mapping of the mail-only disposable sequence:

| Existing isolated mail item                              | Integrated slot | Ownership                                  |
| -------------------------------------------------------- | --------------- | ------------------------------------------ |
| 0083 provider-neutral mailbox model                      | 0085            | Mail prepares, platform integrates/reviews |
| 0084 encrypted check proofs                              | 0086            | Mail prepares, platform integrates/reviews |
| 0085 remote folders/locators/provider IDs                | 0087            | Mail prepares, platform integrates/reviews |
| 0086 atomic payload preparation                          | 0088            | Mail prepares, platform integrates/reviews |
| 0087 complete draft/send intent                          | 0089            | Mail prepares, platform integrates/reviews |
| 0088 explicit remote-trash intent                        | 0090            | Mail prepares, platform integrates/reviews |
| Pending sourceFingerprint locator extension, if required | 0091 reserved   | Mail owns until handoff                    |

This is a source-integration reservation, awaiting the peer's acknowledgement. It is not
permission to rename files on an installed database or reset the active mail preview. Because
mail reports only disposable local use, it can prepare a new immutable source cut against the
combined platform baseline in another isolated checkout/database. Preserve existing local
preview data and let its owner choose any fixture recreation.

Do not merely rename snapshot files. Regenerate/merge the metadata chain against the combined
schema so integration/workflow tables and all custom constraints/triggers survive. Preserve
mail SQL semantics and UUIDs, ciphertext, generation fences, outbox receipts and hashes.
Platform owns the final journal/metadata commit and real-PostgreSQL clean-install plus
integration-0084-to-mail upgrade review. Divergent mail-dev and workflow-0083 databases need
their own explicit recovery/upgrade evidence; no production/customer path is inferred.
No shared/SMS migration below 0092 is allocated. Above that boundary, consult the one allocator
before choosing any number; an unused reservation is explicitly released rather than reused
by assumption.

## Incremental CONN binding, proposed version 1

Bind to existing mail domain identities instead of moving its storage prematurely. Preserve
`gmail`, `imap_smtp` and `microsoft` domain provider IDs, mailbox UUIDs, account uniqueness and
native fresh-auth proof policies. Catalog IDs and domain provider IDs are explicit mappings,
not locale-dependent aliases or a reason to create a duplicate account/credential.

The first server-side projection shape is proposed as:

```ts
type ConnectionLifecycleV1 =
  | "unconfigured"
  | "authorizing"
  | "configuring"
  | "active"
  | "degraded"
  | "reauthorization-required"
  | "paused"
  | "revocation-pending"
  | "removed";
type ConnectionReasonV1 =
  | "setup_required"
  | "resource_missing"
  | "authorization_expired"
  | "owner_hold"
  | "administrative_hold"
  | "offboarded"
  | "transport_unavailable"
  | "local_key_unavailable"
  | "remote_revoke_pending";
type MailControlOperationV1 = "check" | "pause" | "resume" | "disconnect";
type MailConnectionProjectionV1 = {
  version: 1;
  domain: "mail";
  domainAccountId: string; // existing mailbox UUID, unchanged
  providerId: "gmail" | "imap_smtp" | "microsoft";
  owner: { kind: "personal"; userId: string };
  state: ConnectionLifecycleV1;
  reasonCode: ConnectionReasonV1 | null;
  domainGeneration: number; // existing current account generation
  resources: readonly { id: string; kind: "mailbox"; name: string }[];
  operations: readonly MailControlOperationV1[];
  capabilities: readonly (
    | "mail.messages.read"
    | "mail.drafts.read"
    | "mail.drafts.write"
    | "outbound.mail.send"
  )[]; // implemented support, not consent or authority
};
```

No token/password, proof nonce, TLS connection object or raw provider error enters this
projection. Do not fabricate a separate credential ID/generation if mail does not yet persist
one. Its server-internal tagged domain handle is resolved by mail's current fence; the future
common broker delegates to that owner and preserves the generation checks. A later binding
migration can map shared connection/grant/credential IDs explicitly without copying secrets
into a second store. Existing personal mailbox privacy has no administrator content bypass.

Proposed directional hooks, each with required AbortSignal and Result:

1. Mail owns `projectMailConnection(accountId, actorId, signal)`: non-secret projection or
   indistinguishable missing/foreign denial under existing mailbox authority.
2. Mail owns `executeMailConnectionOperation(domainRef, expectedGeneration, actorId,
   operation: MailControlOperationV1, input, signal)`: revalidate current native/domain authority and generation,
   then delegate to existing domain service. Input is the exact Zod-validated control shape,
   never a raw send body. Connect/reconnect/credential replacement remain the existing native
   mail proof workflow, not a generic control call. This hook never submits SMTP DATA and
   never resolves a client-supplied allow flag.
3. Platform owns common `evaluateIntegrationAuthority` and any shared grant/binding resolver.
   It intersects current CRM visibility, explicit grant/app-role/resource limits and lifecycle,
   then delegates to mail's existing stronger domain fence. No platform admin or MCP bearer
   token substitutes for fresh native proof on sensitive setup/rotation.
4. Platform projects the canonical lifecycle from domain facts; mail retains its operational
   state and attempts. Map paused to paused, invalid credentials to reauthorization-required,
   local key/transport outage to degraded, revoke failure to revocation-pending, successful
   removal to tombstone. Do not relabel accepted/unknown mail submission as connection state.

These are reviewable interface names and shapes, not live exports. Exact closed operation,
state/reason and error mappings should be agreed against the immutable mail cut before code
adopts them. Personal ownership remains the only mail ownership profile in this first binding.
Shared/delegated mailbox behavior requires its own accepted permission/data contract.

## EVT-to-MAIL delivery binding, no second sender

A future shared effect references the existing MAIL attempt, never competes with it:

- Platform owns `(sharedEffectId, actionVersion, executionActorId, sourceRecordRefs,
  connectionRef, expectedGeneration)` and admission/rule permission/disclosure intent.
- Mail owns its existing `(accountId, idempotencyKey)` uniqueness, prepared business/MIME
  snapshot, semantic hash, attachment hashes, Message-ID, SMTP DATA boundary, receipt,
  accepted/rejected recipients and Sent-copy/CRM repair. Reusing a shared effect must resolve
  to the same mail attempt. One-to-one binding is unique and transactional, not random on retry.
- Proposed `admitSharedMailEffect(effectRef, preparedMailIntentRef, actorId, signal)` creates
  or returns that domain attempt once, without performing SMTP I/O in the admission transaction.
- Proposed `readSharedMailEffect(domainAttemptRef, actorId, signal)` returns a bounded
  normalized outcome plus original domain certainty. It delegates to the existing owned send
  status/repair path where appropriate; status repair is not another SMTP send.
- Accepted stays accepted even if CRM copy/Sent append fails. Partial stays partial and unknown
  stays unknown, with their holds preserved. Generic retry, cancellation, reconnect, new
  credential generation or reauthorization cannot clear those holds or resubmit accepted DATA.
- A rejection may be retried only under MAIL's proven pre-DATA/rejection policy and the same
  immutable attempt/payload contract. An intentional resend is separately authorized, gets a
  new linked effect/attempt and displays duplicate risk. Shared queue acknowledgement never
  means accepted, delivered or read.
- Future cancel delegates to MAIL's pre-start cancellation rules. In-flight/accepted/partial/
  unknown effects retain their observed outcome; abort cannot promise remote recall.

The existing generic provider runner is not a scheduler and does no retries. Do not route
SMTP submission through its OAuth2 connect/disconnect methods or bypass the MAIL attempt
manager. The future shared dispatcher nudges the one existing pg-boss/workflow system; the
current EVT outbox is still to be implemented under the reviewed architecture contract.

## Safe integration sequence and evidence

1. Both owners acknowledge this reservation and API direction; record changes explicitly.
2. Mail creates a reviewable committed handoff while preserving its active UI/auth/mail work
   and ongoing tests. Platform does not stage or copy the dirty tree.
3. Platform inventories/adopts current committed auth refinements and the selected clean
   workflow cut separately, preserving their history and current UI.
4. Mail prepares its reserved DDL/combined-schema metadata against that reviewed base; platform
   performs integrated source/migration review and real-DB preservation/recovery tests before
   another shared/SMS migration. No receipt, source fingerprint or generation fence is dropped.
5. Add the projection/delegation seam incrementally; test native freshness, offboarding, stale
   generations, hidden records, mailbox switching and partial/unknown attempts across FA/DE/EN.
   Match actual evidence to canonical MAIL/CONN/QA rows without marking source-only work done.
6. SMS can reuse the agreed common contracts after this interface review; pure segmentation,
   safe rendering and explicit fixture research need no real provider account. Its actual
   registry/credentials/shared DDL stay with the one platform owner and do not create a new
   delivery engine. The separate planning amendment's task import remains its own scope action.

Mail preview3106/WS3107, platform3160/WS8080 and existing main previews remain distinct.
This proposal does not authorize real mail/SMS, calls, financial writes, purchases, domain
configuration, deployment or publication. The installation can outlive its creating admin;
creator grants are revoked on offboarding, and if that person is the current custodian,
automation pauses until explicit active-custodian recovery. It is not silently deleted or
allowed to run under ambient worker administration.
