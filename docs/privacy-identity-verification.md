# Privacy identity and recipient foundation

Status: partial DPL-04 source qualification. There is no new public endpoint, user interface, verification email or installed delivery receipt in this change. Operator, external-subject and self-service UI/HTTP/mail walkthroughs remain open.

## Binding model

Each case has one current `privacy_case_verifications` slot. A pending recipient can occupy that slot without a verified subject. A complete current proof requires an identified method/reviewer, authenticated ciphertext for subject, recipient and minimized evidence, and matching case scope, recipient and verification versions. The case's `verifiedAt` timestamp alone grants nothing.

Subject identifiers are explicit references to an existing user or contact, or a reviewed external description. No address matching, contact merging or record-owner inference occurs. Two contacts sharing an address remain two contacts. External people do not need a CRM account or identity-document upload.

The recipient is separately reviewed. Email, an existing verified active in-app user, and operator-assisted delivery are supported recipient descriptions. A description is a workflow binding, not proof that delivery occurred. Delivery credentials and actual local SMTP qualification belong to the later delivery tasks.

## Internal service APIs

All service actors must originate from authenticated server context. Submitted user/session identifiers are never credentials. Commands use `caseId`, `expectedVersion` and a UUID `commandId`. Unknown fields, identity-document payloads, malformed/oversized evidence and future observation times are rejected.

`verifyPrivacyCaseIdentity(db, actor, command, signal)` requires current `case.review` authority for the assigned case. The command includes an explicit subject, recipient, and operator attestation:

```json
{
  "trustedChannel": "previously_verified_email",
  "evidenceRef": "reference-to-the-operator-investigation",
  "observedAt": "2026-10-31T12:00:00Z",
  "confirmedSubject": true,
  "confirmedRecipient": true
}
```

The trusted-channel options are a previously verified email, previously verified phone, in-person confirmation or an organizational record. These fields record a human's investigation; the software does not perform that external investigation or attest that the reference proves ownership. Store a short reference to controlled evidence, not an identity-document image or unnecessary personal history.

`verifyOwnPrivacyIdentity(db, actor, command, signal)` uses a fresh, active, verified authentication session. It needs no reviewer grant. It requires a server-bound `requesterUserId` matching the actor, and an original intake subject/recipient that identifies only that same user and in-app account. It cannot verify a contact through its owner, adopt another user's identifier, or overwrite a subsequently changed recipient/reviewed subject. Operator intake does not set this self-service binding; the future authenticated self-intake path must do so server-side.

`changePrivacyCaseRecipient(db, actor, command, signal)` requires current case review authority, a selected recipient and a reason. It increments recipient and verification versions, clears case verification and revokes the prior proof. Running/approved/response-ready work becomes `needs_attention`. Existing job tickets and later sensitive guard checks deny until a new valid review binds the new recipient.

`privacyIntakeAcknowledgement()` returns only `{ "accepted": true }` and performs no match lookup or send. It is a generic response building block, not a durable public intake implementation. A future public handler must durably receive the request and apply abuse/origin controls without revealing whether a person matches CRM records.

## Atomicity, minimization and current-proof checks

Verification updates the proof, case versions and encrypted immutable case-event receipt together. Changed subject or recipient selections increment the corresponding version. Every new proof increments verification version. Duplicate command bodies return the existing receipt; changed bodies reusing the same command ID fail with `idempotency_conflict`. Stale versions cannot overwrite a later decision. Failed operational Results, database failures and cancellation roll back prepared writes.

Current proof data is authenticated and parsed before sensitive authority is granted. Missing, revoked, corrupted or incorrectly bound proof denies with `forbidden`. The case transition service uses the same `currentCaseIdentityBinding` helper. Routine events contain case/actor/action/state identifiers; evidence references, reasons and recipient/subject descriptions remain encrypted. Keyed digests remain protected metadata, not anonymous data or an address blacklist. Their retention still requires the applicable installation policy and later cleanup integration.

## Local development evidence

Test-first execution began with a missing identity module. Further actual failing regressions showed:

- A timestamp without a current proof could authorize disclosure; the guard now requires the authenticated, version-bound proof.
- Self verification could overwrite a newly changed recipient; it now checks the current selected binding.
- A database trigger rejecting the self-service case update left the prepared proof committed after a failure Result; the self-service transaction now rolls back that Result.

With Bun 1.4.4 and Vitest 5.0.5, the final scoped local run passed **44 real-PostgreSQL tests in seven files**, covering the 29 authority tests plus 15 identity tests. PostgreSQL uses actual migrations through `0085_privacy_identity`, synthetic accounts/contacts and injected constraint failures. The identity tests cover explicit same-address contacts, wrong cases/actors, nonexistent references, duplicate/stale commands, recipient change, proof corruption, minimized receipts and self-service without reviewer grants.

Command environment: `PATH=/Users/ali/Developer/warpdrive/.runtime/bin:$PATH`, `DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock`, `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. Run `bun run test:integration src/features/privacy/identity.integration.test.ts src/features/privacy/identitySecurity.integration.test.ts src/features/privacy/permissions.integration.test.ts src/features/privacy/authorityManagement.integration.test.ts src/features/privacy/authorityFences.integration.test.ts src/features/privacy/authorityAtomicity.integration.test.ts src/features/privacy/authorityPolicy.integration.test.ts --maxWorkers=1`.

These are local source/runtime results before the final versioned candidate. They do not establish exact-commit CI, localized browser acceptance, real external-channel verification, message delivery or legal/operator acceptance. DPL-04 remains incomplete until its dependent paths are implemented and evidenced.
