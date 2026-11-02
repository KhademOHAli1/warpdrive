# Private intake forward schema contract

The proposed tables are `email_private_intake` and `email_private_intake_reviews`.
They hold provider observations and local review, not submission or acceptance authority.
Candidate-local migration 0094 is reserved by the parent; canonical/global 0094 and 0095
are not allocated. Preserve the existing SQL, snapshots and journal entries 0 through 93.
This note and its tests do not add DDL or a schema module.

## Evidence boundaries

- Structural RED: actual `pg_catalog` reports the two tables absent. This proves only
  that the forward schema is missing, not that any later privacy guard was exercised.
- Schema behavior: real PostgreSQL inserts, updates and constraint failures establish
  provider identity uniqueness, account-scoped references, immutable evidence and
  append-only history. Each test first asserts the structural prerequisites.
- Application behavior: actual intake, canonical ACK promotion, native authenticated
  review, cleanup and history replay need their server transactions and integration
  tests. A catalog row or a direct SQL insert cannot qualify these workflows.

## Required ledger properties

The immutable identity is `(account_id, provider, observed_provider_id)`. Supported
providers include Gmail and IMAP/SMTP. An RFC header is only an untrusted hint; no
attempt or notification relation exists because a public hint matches.

Retained evidence includes the observed payload and its hash, plus independent baseline
hashes for the owned local message, private thread and attachment locators. A new intake
must own its private copy atomically. Only `owned_message_id` is a nullable copy
reference, with an account-scoped composite foreign key. `baseline_thread_id` is an
immutable UUID snapshot with no second lifecycle foreign key. Derive and validate the
current thread from the locked message and account. The eventual confirmation pointer
also has an account-scoped composite foreign key.

An existing unrelated row with the same actual remote ID must remain unchanged. A
reserved synthetic local message identity allows the intake to own a distinct private
copy while recording the actual remote ID only in this ledger. A thread-name prefix or
the existing IMAP `message_fingerprint` field alone is insufficient provenance.

Existing same-account message, thread and attempt unique targets already exist; do not
add duplicate parent keys. Attachment baselines must filter by both message and account
and use deterministic ordering across all relevant metadata/locator fields. The schema
fixtures now call the shared `private_intake_hash_v1` and `private_intake_baseline_v1`
SQL APIs. Their version 1 projectors use explicit fields and Unix microsecond timestamps;
session timezone and unrelated new columns do not change a baseline. The original
schema oracles are preserved. Canonical kernel qualification does not establish the
new guard fragment's lifecycle behavior or native session authorization.

Synthetic copies leave Gmail message/thread IDs null and must not occupy a colliding raw
message fingerprint. The current Gmail attachment reader requires a message Gmail ID;
an owner-gated ledger provenance resolver or retained attachment bytes is necessary.
Never solve attachment access by assigning the unrelated row's real Gmail ID.

Confirmation reference and snapshot remain null until the existing canonical Gmail
API-ACK receipt proves this exact observed provider ID and account. Promotion must also
verify exclusive copy ownership and all unchanged baselines. It preserves message UUID
and thread. The owned copy may acquire the real Gmail/provider columns only if those
identities are unoccupied. A collision stays synthetic/private and enters conflict;
never repair by adopting, overwriting or reparenting a shared, linked, edited or
unrelated row. SMTP INBOX self-delivery remains an observation; public headers cannot
extend the stronger Sent-copy proof to INBOX.

The immutable confirmation snapshot is version 1 and contains account ID, attempt ID,
actual provider message ID and a hash of the submitted payload. Attempt purge may null
only the FK pointer; it retains that confirmed fact/snapshot. The proposed fixture
snapshot uses `{version, accountId, attemptId, providerMessageId, payloadHash}` and hashes
canonical `email_send_attempts.payload::text`.

## Review and retention are independent of confirmation

Reviews append `keep_private`, `dismiss` or `restore_private` decisions using an expected
revision. They use existing native session and mailbox-owner authority, not client-sent
owner identity, a new authentication engine or a resend engine. Earlier revisions are
immutable. All ledger state changes, including confirmation and content purge, advance
the ledger revision exactly once. A review occupies its next CAS revision. Effective
user disposition is independent of confirmation and survives promotion. Authenticated
actor cleanup may null the reviewer FK but cannot edit the decision or prior revision.

The legal review fixture mirrors the agreed native transaction order: lock the ledger,
check the expected revision, update expected to next, then insert the review at that
new current revision. The insert trigger does not advance the ledger. Schema mutation
tests cover this sequence, append-only update/delete rejection, duplicate/zero/stale/
future revision rejection, and retention of the latest review across a content-purge
revision gap. These raw SQL fixtures do not qualify native session authorization or
the public review API's through-commit CAS behavior.

Reference clearing is a coordinated content purge, not an ordinary nulling update:
remove the retained mail copy, attachment payloads/locators as appropriate, and every
duplicated body/raw payload in the ledger. Keep only the minimal provider identity,
hashes, disposition and review sequence needed to prevent replay from becoming ordinary
mail or resurrecting deleted content. Disconnect/reconnect must not erase that guard.

Do not cascade deletion of an owned message into deletion of the ledger or its reviews.
There is no paired message/thread-null constraint. The baseline thread UUID survives
owned-message deletion, so a still-existing empty private thread does not block cleanup.
Reference-only foreign-key cleanup must not null account_id or destroy earlier review
revisions. A parent-trigger exception is not authorization to purge a still-existing
copy from an ordinary UPDATE. Parent account purge explicitly cascades the ledger and
its review history.

An unknown send stays in manual `needs_review`; review cannot manufacture API-ACK proof,
set an emailed marker or authorize an automatic retry. Other mailbox intake continues
after private persistence commits. Review/dismissal of observed content is a separate
local decision from provider acceptance.

## Pending integration gates

1. Cross-account message, thread, confirmation and review references fail in PostgreSQL.
2. Provider identity, payload and baseline edits fail; a coordinated purge removes
   duplicated body data while retaining a minimal tombstone.
3. Header-only or mismatched-ID confirmation fails; an actual canonical API ACK may
   confirm only an untouched, exclusively owned copy.
4. Native owner review enforces current session/owner authority and CAS; revisions cannot
   be updated/deleted, and confirmation preserves the latest user disposition.
5. Purge and later provider/history replay preserve the tombstone and do not recreate
   ordinary mail, payload bodies, receipt authority or an automatic resend.

The table fields and single owned-message lifecycle reference are coordinated with the
parent. The SQL-only guard fragment remains separate from the root-owned composed
migration. Added guard regressions cover synthetic admission, exact-provider-ID/payload
binding, valid-shaped receipt forgery, actual ACK plus attempt cleanup and retained
disposition, and actor/account cleanup. No application-level gate is qualified by the
initial structural test, and raw SQL fixtures do not qualify native session/CAS APIs.
