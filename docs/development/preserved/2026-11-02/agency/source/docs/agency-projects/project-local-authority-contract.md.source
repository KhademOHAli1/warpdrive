# Project-local policy and creation planning, accepted design

1 November 2026. **The accepted local contract is implemented as pure policy and creation planning. Actual 197 cases across two files pass after formatting; focused types, Biome and unchanged-rule typed ESLint pass for six new TS files.** The exact owner decision is retained in `evidence/settings-owner-project-local-authority-decision.md`, SHA-256 `1deac897cccc52b40e3333a0ad4ed4886ff841aecd263c938e17fa3f1604e39d`, reviewing Agency6091c22. This is local-policy acceptance, not a schema, migration, writer, native admission or enabled module.

## Local actions over trusted facts

The feature-local `projectLocalAccess` boundary consumes the existing native `AuthUser` identity/type/active fields, canonical project/owner IDs, one current actor-scoped membership row and an already validated `ProjectSnapshot`. Membership must match both actor and project. It is a pure policy over server-supplied facts. No browser authority-context parser, authentication proof, module/CRM/Privacy boolean adapter or shared action-union cast is introduced.

- `checkProjectLocalAction(context, snapshot, action)` returns actual Result with true local eligibility or bounded local denial. Actions are the existing eight `ProjectAction` values plus read, edit-content, manage-members and transfer-owner.
- `transitionProjectForLocalActor(context, snapshot, command)` checks the local relation/grant before calling actual `transitionProject()`. That function supplies existing state/reason/revision conflict and exhaustion semantics; the graph is not copied into authorization. An outsider must receive local denial before revision details.
- `hasProjectAssignmentCoordinateEligibility(context)` reports only a state-neutral local grant. It does not authorize an assignment command, progress archived work or supply version/Calendar/provider/financial authority.

An active current owner derives read/edit/coordinate and owner-only maintenance rights. A non-owner's scoped member row means read; its edit and coordinate flags are independent. Native administrator type, global project.create, team management or role labels create no private-project bypass. Only the acting staff's current activity is inspected here; an inactive owner identity does not erase a different active member's independent rights. Read and owner access maintenance are eligible in every lifecycle state. Content editing is eligible only in planned, active or on-hold. Start/hold/resume/complete require owner or edit membership; cancel/archive/restore/reopen require ownership, with exact validity decided by the existing transition policy.

After an actual ownership transfer, fresh supplied owner/member facts determine access. The policy creates no former-owner member row, copies no derived privileges and removes no explicit memberships. Removing an owner-associated member row does not remove ownership. Actual persisted transfer/revocation, recovery after access loss and historical fact encoding remain native service work.

## Pure creation plan over current native records

`planProjectCreation({actor, creator, selectedOwner})` uses actual `can(actor, "project.create")`. `actor` is the existing `PermSetUser`; creator/selectedOwner records use only canonical users id/isActive/invitedAt fields. The creator record must match the acting identity and both records must be active/accepted. The selected owner does not need the global create grant.

The plan contains only ownerUserId, initial planned/revision0/archivedFrom:null and creatorMembership. Same creator/owner needs no member row. A different creator gets one read-member row plan with projectEdit:true and assignmentCoordinate:false. Output objects are detached, with no copied workspace grants, other implicit members, generated IDs, insertion or receipt. This default applies only to initial creation; no transfer/recovery path is added.

## Native gates and evidence still required

Every actual reader/command still needs real module availability, current internal-staff authentication, freshness/CSRF for mutations, every current old/new CRM parent and selected-owner ceiling, ordinary Privacy restrictions and the complete participating transaction fence. This source increment implements none of those loaders or protocols. Its typed inputs are not an authority token; a stale supplied snapshot cannot be detected by a pure function.

Actual changing edits/member/transfer/lifecycle writes must use expected-revision CAS, advance once, and atomically commit project/member/history/request facts; no-ops add no event. Full operation/fact encoding, protected reason/replay/tombstone contracts, accepted lineage/schema/allocation and native race/rollback/recovery proof remain open. Tests of supplied local facts will not be reported as native freshness, revocation-through-commit, selected-record visibility or real database evidence.

## Actual scoped execution

Root observed two missing-module failures, then 133 failed and 64 passed against rejection scaffolds before implementation. All 197 cases in two files passed, including after three test-format corrections. Focused noEmit, Biome and unchanged-rule typed ESLint pass for the six primary TS files. The seven source tools ran serially in 12.071086 seconds with at least 12,999,340,032 free bytes. All groups were terminal and observed empty; the 45-second source slot is released. The three earlier unit groups 61599, 61628 and 62131 were also empty.

Exact hashes, commands, logs and the owner capture are indexed by `qualification-project-authority-20261101.json`. These results do not establish native/database admission or acceptance beyond the stated local policy.
