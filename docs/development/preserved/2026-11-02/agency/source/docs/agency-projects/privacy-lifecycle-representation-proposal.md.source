# Lifecycle-only protected representation proposal

1 November 2026. **Review only, unselected and unimplemented.** This is a concrete response to the Privacy6091c22 decision, not an attempt to reuse case crypto. It selects no production key, purpose, envelope, reader, writer, retention period or migration. The original schema notation remains nonexecutable.

## Bounded command scope

Propose edition1 for exactly `start`, `hold`, `resume`, `complete`, `cancel`, `archive`, `restore`, `reopen`. These are the actual `ProjectCommand` actions in `projectLifecycle.ts`. The existing transition policy requires a reason for hold/cancel/archive/restore/reopen. Create, membership, owner transfer and other operations need separately reviewed encodings; they cannot be passed through this edition.

At the actual native ingress, validate command/project/actor/intent identities once. Use the existing lower-case canonical UUID and bounded revision rules. The existing reason schema trims text; omitted or accepted empty reason becomes null. Preserve every remaining accepted character exactly, with no Unicode normalization, case conversion or locale formatting. This is a request-comparison representation, not a claim that current native authority has been loaded.

## Proposed canonical comparison input

Propose the UTF-8 bytes of the following fixed-order JSON array, using well-formed JSON.stringify string escaping, compact separators and safe integer decimal representation:

`["agency-project-lifecycle-request",1,actorUserId,intentId,projectId,action,expectedRevision,reasonOrNull]`

The literal is a proposed domain discriminator, not a PrivacyContext purpose. Encoding edition1 means this exact field order and normalization. Exclude transport/CSRF fields, clock values, generated result/history IDs, native session contents and other request body properties. The complete normalized value is private input to the future keyed-comparison API and must not be logged, projected, persisted as plaintext or sent to telemetry. Changed project/action/revision/reason must compare differently. Matching bytes alone never grant current read/replay authority.

Propose a private comparison record containing domain/encoding edition, comparison format identifier, opaque comparison-key reference and keyed comparison bytes. Existing fingerprintPrivacy cannot produce this contract: it has no Agency context, old-key reference lookup or selected rotation/replay semantics. No raw SHA, alternate token-encryption wrapper, public fingerprint or invented key ID is proposed.

## Proposed protected reason slot

For the first eight commands, propose the four-store history protected-slot variant as the smallest physical option. Immutable event facts and protected/disposition fields remain separate columns and require separately enforceable mutation rules. This is not acceptance of that placement; Privacy may require the separately proposed fifth content store if its lifecycle boundary is needed. No second reason copy belongs in request receipts or routine activity/audit projections.

Propose a reason state of `not-supplied`, `present` or `disposed`. Not-supplied has no ciphertext/key metadata. Present requires opaque protected bytes, envelope format identifier and opaque encryption-key reference. Disposed removes protected bytes and retains only a separately approved minimal disposition kind/actor/time/correlation record. Missing/unresolvable key is an operational unavailable state, never evidence of disposition or verified erasure. A reason-required transition must atomically insert its event and present protected payload; disposition cannot satisfy initial insertion.

Propose associated-data bytes for binding as a second fixed-order JSON array:

`["agency-project-lifecycle-reason",1,projectId,historyEventId,"reason",1]`

The two edition fields distinguish binding encoding and content schema. The future API must bind the accepted key reference/envelope metadata as its contract requires and reject project/event/domain/content substitution. Load the exact same-project event before projecting its reason. This proposed domain is not a new caseId or an existing PrivacyContext purpose; no current crypto import can implement it safely.

## Existing intent with missing material

After current native project/parent authority checks, an existing logical intent with absent comparison material, disposed result, unavailable old key or unusable tombstone remains non-executable. Propose one bounded recovery-unavailable result without revealing protected content or execution timing. Never execute again because comparison material is missing. This proposal chooses no tombstone lifetime, automatic expiry, restore behavior or retained comparison policy; persistence stays disabled until those choices exist.

## Concrete owner decisions requested

Please review the eight-action scope, exact comparison encoding/domains, four-store slot placement, associated-data binding and explicit reason states. If accepted, specify the actual Agency envelope/comparison interfaces, opaque encryption/comparison-key references and lookup/rotation semantics, plus disposition/terminal-record lifetime and restore behavior. These are new interfaces to select and implement, not APIs presumed to exist. If the fifth store is required instead, select that physical boundary explicitly before the SQL notation changes.

Required later source-bound cases include normalized-equivalence and changed-intent conflicts, cross-project/event/domain substitution, missing/rotated keys, reason-required event/payload rollback, current-authority replay, disposed result and late retry, and backup/restore replay. Physical erasure, provider and backup residuals remain separate evidence. No codec source or tests execute in this review-only increment.
