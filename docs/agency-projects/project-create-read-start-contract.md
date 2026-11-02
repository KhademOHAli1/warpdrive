# First project journey: create, read, start

One shared-contract note for the integrator, before authoring the reserved0099 project-persistence DDL. This is the actual data/authority boundary needed by the first user journey; routine private implementation continues while the shared decisions are resolved.

## Journey and existing policy

An accepted active native staff actor with global `project.create` creates a planned internal project with an eligible active accepted owner and at least one canonical deal/person/organization anchor. Creator and selected owner must see every supplied anchor. A different creator receives explicit read/edit membership. The actor opens the workspace and starts the project from revision0 to1; stale replay cannot advance twice. A native administrator still needs project ownership or explicit project membership for local access.

Reuse `planProjectCreation`, `checkProjectLocalAction`, `transitionProjectForLocalActor`, the strict project ingress and pure lifecycle policy. Native session/CSRF/module, CRM and Privacy gates remain additional current authority. Do not turn local project actions into CRM `VisibleRecord` values or infer budget/quotation authority from deal value/status.

## Minimum persistence boundary

- `agency_projects`: UUID, title, canonical ownerUserId, nullable canonical deal/person/org anchors(at leastone), state, exact safe revision, coherent archivedFrom, server timestamps. No unique project per customer/deal and no CRM acquisition-status write.
- `agency_project_members`: composite projectId/userId identity; explicit read membership with independent projectEdit/assignmentCoordinate defaultsfalse. Insert creator read/edit row when creator differs fromowner.
- `agency_project_history`: project/event/native recorder, finite operation/policy version, previous/new revision/state/archive facts, server recorded time and correlation. One event per(project,newRevision). Creation records0 with no fabricatedpreviousstate. Protected reason content remains separate from ordinary facts.
- `agency_project_requests`: unique native(actor,operation,intentId), private semantic comparison representation, result project/revision and same-project history reference. Replays reauthorize current access before revealing the previous result.

Proposed finite first operations are `create` and `start`. Revision storage must cover0..9007199254740991, with DB bounds and exact numeric decoding. No invoice, payment, asset, provider, external account or financial record is introduced.

## Native interfaces and actual shared decisions

Canonical012 supplies `loadLiveSessionByToken`, `hydrateActor`, `guardCsrf` and `assertReferenceVisible`. The project command must additionally check accepted invitation, selected-owner eligibility, deal archivedAt and all supplied parent relationships. Hydration inside a transaction alone is not through-commit authority.

The integrator needs to settle these actual shared points once:

1. Additive `project.create` registration and default-false module setting, preserving reviewed native flags/actor/visibility behavior. They exist in the preserved prototype but are not assumed present in canonical012.
2. Participating authority/revocation/restriction fence, lock order, key/API and owning writers. The current authority candidate is rejection-only; case-bound `withPrivacyAuthority` is not a project API. Private implementation must not present checkpoint hydration as this fence.
3. Agency protected reason placement, crypto/AAD/key/disposition and keyed private replay comparison/rotation/tombstone semantics. Current case-bound crypto purposes cannot be reused as an Agency API. Missing/revoked keys must fail closed.
4. Title representation and multi-anchor consistency/deletion rules. Proposed title is trimmed validUnicode bounded to1..160codepoints, so PostgreSQL `char_length` and ingress agree; do not mix JS UTF-16 limits with SQL character counts. Explicit conflicting CRM relationships reject rather than being silently rewritten.

## Atomicity and publication

Creation atomically admits current actor/session/module/staff/CRM/Privacy facts, then inserts project, conditional creator membership, creation history and request receipt. Start authorizes before exposing revision details, applies the existing decision, updates by project+expectedrevision and appends history/receipt in the same transaction. A returned error after writes must cause rollback. Unknown commit outcomes are not confirmed failures or permission to duplicate.

Workspace reads intersect current native/module/CRM/Privacy gates with explicit local access. The reserved0099 slot prevents collision; it is not schema acceptance or an installed-upgrade claim. The integrator owns final migration journal/snapshot ordering and source registration. Heavy real-PostgreSQL/browser validation uses its single queue after the concrete implementation is ready.

## Accepted implementation boundary, 1 November 2026

Settings accepted this bounded create/read/start contract: `project.create` defaults false for regular users, the persisted module gate fails closed, native references remain restrictive, and current actor/owner anchor visibility must be revalidated at commit/start. Private repository, form and tests may proceed with injected adapters that fail closed when unbound. Optional reasons remain rejected until the Agency codec binding exists.

Two production bindings remain owned by Settings and explicitly unavailable: a participating authority fence acquired before other locks, with post-lock READ COMMITTED no-touch session/accepted-actor/policy/grant checks through commit; and the Agency-domain private replay codec/disposition binding with context AAD, key identity/rotation and terminal handling of cleared, unreadable or disposed payloads. Existing touching session resolvers and case-bound Privacy APIs do not satisfy these bindings. No production key or retention values are inferred.

The native fixture freezes committed Main `714eda0f3496f3faea1dd35da3324083335aa901`, SQL0000..0097 and its journal, in the existing ignored Agency runtime directory. Reserved0099 is an explicit private overlay. The first native allocation will exercise the implemented schema's real constraints and reads/writes; known missing-table/setup errors are not behavioral RED. Repeating the unchanged wider private TSC failure is deferred in favor of checking the additive increment against an exact current-Main integration candidate. Earlier core114 and creation88 evidence remains attached to its actual source cuts.
