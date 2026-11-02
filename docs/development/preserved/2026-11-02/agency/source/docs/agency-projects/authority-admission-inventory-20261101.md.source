# Agency authority and module admission, source inventory for owner review

1 November 2026. Read-only audit of Agency `d98574bb5dcfd5360158676ae87b96f2b0012c14`. No source edit, private data/configuration read, runner or database operation formed this audit. Findings and proposed options below are not accepted shared APIs, source qualification or a project enablement decision.

## Actual module-availability patterns

There is no generic native module registry/broker or Agency availability gate at this cut. `src/config/env.ts` exports `envSchema`, `parseEnv(raw)` and validated `env`. Its default-false `SALES_PIPELINE_LIFECYCLE_ENABLED` is checked after CSRF and before lifecycle mutation in `src/features/pipelines/pipelineLifecycleActions.ts`; the flag covers that candidate only. MCP HTTP/OAuth entrypoints separately check `env.MCP_ENABLED` and return unavailable/404 as appropriate.

`canWorkflow(actor, capability, ownerId)` in `src/features/workflows/access.ts` is current actor/owner permission, not module installation. Workflow admission additionally checks active/published state and supported handlers. `src/server/worker.ts` registers Workflow jobs unconditionally; fresh worker authority alone is not a module switch. Settings workflow controls are personal preferences. `invokeProvider()` validates the adapter boundary while its contract leaves authentication/grants to its caller; it supplies no Agency admission.

The smallest grounded new module proposal follows the central operator-env pattern, with a new owner-reviewed default-false Agency field and explicit native/server/worker gates. No field or helper is implemented here. Owners must settle disabled versus authorized historical reads, app/worker configuration consistency and deployment/reload behavior, queued admission at actual consumption, and the required denial/error states. A startup env value is not a dynamic policy generation or proof of immediate coordinated disablement. Availability remains independent from project/CRM/financial authority and from originating connection/app/MCP/resource/provider grants.

## Actual authority readers and partial locks

| Source surface | Current protection and limitation |
| --- | --- |
| `src/server/hydrateActor.ts` | Reads user, permission-set flags, visibility memberships and managed-team members. No authority generation/locks; request context can cache the result. |
| `src/features/pipelines/pipelineLifecycleAccess.ts`, `lockLifecycleActor()` | Fresh-session resolution, `FOR SHARE` on session, user, auth-user, assigned permission set and existing visibility memberships, then resolution/hydration again. Used by lifecycle and rename. Teams, auth-policy/passkey predicates and absent/new membership rows are not covered. |
| `src/features/identity/users.service.ts` | Assignment transaction and some target account/MCP/user locks exist. Preceding checks and the acting administrator's complete authority are not generally fenced. |
| `src/features/identity/permission-sets.service.ts` | Flag replacement and audit lack one encompassing transaction/CAS. A held permission-set share lock would block its update, but most current consumers hold none. |
| `src/features/identity/teams.service.ts` | Roster replacement is transactional; other operations and all team authority lack a shared fence. Its filtering-only/no-ACL comment conflicts with team-based hydration/visibility behavior. |
| `src/features/identity/visibility-groups.service.ts` | Checks and independent membership write/audit are not under a common fence. New restricted-pipeline bindings can also change membership-management dependencies. |
| `src/features/deals/dealUpdate.ts`, `dealAuth.ts`, `permissions/referenceCheck.ts` | In-transaction actor refresh/deal CAS and parent reads do not hold complete authority locks. Business revision CAS does not serialize actor or parent revocation. |

Native freshness also depends on `src/features/auth/better/sessionPolicy.ts`, `resolveWorkflowSession(..., { requireFresh: true })`: policy and passkey predicates can change, policy can be absent with defaults, and session resolution may update `lastSeenAt`. Locking existing policy/member rows alone leaves phantoms.

A concrete lock-order issue needs owner review: pipeline lifecycle can hold a session share lock or initial-touch write lock and then await a user; administrative revocation can hold the user then await a session. The lifecycle caller catches failure but has no explicit deadlock retry. No deadlock was executed or qualified by this audit.

## Participating writer surfaces to close

The initial source inventory includes user status/native admin/permission-set assignment, permission-set flag create/update/assignment, team create/update/delete/roster, visibility-group membership, future project owner/member writers, native session logout/revocation/security/operator recovery, auth policy, factor/passkey and account-locked auth-gateway paths. Owners must confirm all actual native-library mutation boundaries; this list is not a completed global closure proof.

CRM ceilings additionally depend on deal `changeOwner`, `updateDeal` customer/group links, archive/bulk archive, both delete implementations, merges and lead conversion; person/org update/delete/merge and merge relationship repointing; import `assignImportedOwner`, create/update-with-relations, undo/relationship cleanup; and pipeline archive plus restricted-group creation/binding. No pipeline group-reassignment API was found at this cut. Stage moves within the same pipeline do not independently alter that ceiling. Existing import/row/CAS locks are separate protections.

## Two proposed review options

1. **Coarse shared/exclusive transaction advisory fence for initial persistence.** Agree one namespace/scope and bounded acquisition. Project mutations acquire shared access before final native/CRM reads and retain it through project/history/protected-content/receipt commit. Every participating authority-changing writer acquires exclusive access before its checks and existing locks, then refreshes authority. This covers absent/new membership/policy dependencies only for participating writers. Fix one order: authority fence, existing account/MCP/lifecycle/import locks, deterministic row order; prohibit lock upgrades. Broad contention, incomplete writer coverage, native-library participation, cancellation/deadline behavior and actual race/rollback evidence remain required. No SQL/key/helper is allocated or implemented here.
2. **Finer account anchors and source-row locks.** Review reuse of actual `lockAuthAccount` for all affected actors, selected owners and old/new team managers, acquired in sorted order; add a real anchor for absent policy and hold required user/permission/session/auth/CRM/pipeline rows. Team/member writers must share these anchors. Recheck relationship plans after locking; a changed dependency set requires restart instead of acquiring new locks out of order. This reduces contention but substantially increases phantom/closure/deadlock proof and owner patch scope.

Neither `updatedAt`, actor refresh nor serializable isolation alone establishes the required wall-clock revocation ordering. A successful project CAS is not a substitute. Privacy purpose restrictions and ordinary project-writer fencing also need their actual owner contract; existing case-review/restriction authority cannot be substituted.

## Required decision and evidence

Platform/Identity/Settings/native-auth/CRM owners must select and review a bounded protocol, namespace/scope, lock order and complete participating patch set. Privacy must supply the actual ordinary project restriction/writer contract and protected-content decisions. Module availability/history/configuration behavior is an independent decision. The narrow accepted project.create registry contract settles none of these broader gates.

Before enabling persistence, real PostgreSQL must demonstrate permission/status/session/team/member/parent revocation races, new/removed membership and absent-policy changes, changed relationship plans, deadlock/timeout/cancellation recovery, no success audit on rollback, atomic project/history/protected-content/intent writes and concurrent unrelated work. No mock database, source review or current pure unit result closes those requirements. Canonical combined migration lineage, allocation and fresh/upgrade/rerun/restore qualification remain separately unresolved.
