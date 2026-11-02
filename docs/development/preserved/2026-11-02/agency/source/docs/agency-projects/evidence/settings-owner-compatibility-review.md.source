# Agency compatibility review

31 October 2026. Read-only review of the supplied `settings-agency-compatibility.patch` and the draft `docs/agency-projects/project-core-delta.md` in `/Users/ali/Developer/warpdrive-agency-projects`.

Settings reference: `ec9b3f8943e42736edc6713c099fd2ef14068d0a`. Agency base at inspection: `8e6e2a65349ea6ebd6e652228ffe46c7caac6327`, with adoption changes still staged/in progress. Draft SHA-256 at inspection: `b56a55ef9c9abd418046873179dddfc7524b6bb2270baad03f315a2fe1ce6ee9`. This is a snapshot review, not approval of later edits or full Agency enablement.

## Compatibility result

No blocking presentation issue found in the compatibility approach.

- The Agency worktree's production `SettingsNav.tsx` matches the committed Settings cut byte-for-byte.
- A structural JSON comparison retains every Settings-cut catalog leaf and all 18 pre-existing workflow permission labels across EN/DE/FA.
- The new test exercises the actual mobile Sheet: denied destinations remain absent, the regional destination keeps its URL, and selecting a destination dismisses the Sheet. Preventing JSDOM anchor navigation while forwarding the actual click handler is appropriate. The existing journey suite separately covers keyboard focus, same-route dismissal, route changes and RTL.
- The permission editor consumes `GLOBAL_FLAGS` and `ALL_PERMISSION_FLAG_KEYS`; the retained workflow registry entries therefore remain visible and are preserved when flags are normalized. Missing ordinary-set flags normalize to false.
- The owner's saved navigation result records 18 passing tests across both suites. I did not rerun a test campaign. A read-only Biome check of the current navigation test passed.

The supplied patch is an exported working-tree artifact. Regenerate it from the final owner commit after formatting/merge cleanup; use that commit as the eventual integration reference. This review makes no claim that the entire adopted Agency worktree has passed combined type/build/native qualification.

## Decisions required before project persistence is enabled

These are draft contract gaps, not demonstrated vulnerabilities in an enabled implementation.

1. **Map lifecycle commands to explicit grants.** Draft lines 24 and 34 separate edit from coordinate but do not yet authorize each transition. State who may start, hold, complete, cancel, archive, restore and reopen. The pure lifecycle policy at `src/features/agency-projects/projectLifecycle.ts:64` validates transitions, not actor authority. Neither edit nor coordinate should silently become general mutation authority. Freeze a command/grant truth table before implementing the service.

2. **Decide administrator and grantor behavior for `project.create`.** Draft line 22 correctly proposes default deny for ordinary sets, but this alone does not settle native administrator behavior or who may grant the flag. Existing `can()` bypasses flags for native administrators (`src/features/permissions/can.ts:38`), whose hydrated flag map is empty (`src/server/hydrateActor.ts:30`). Existing delegated permission managers can grant flags outside `HIGH_RISK_FLAGS` (`src/features/identity/guards.ts:27`). Explicitly decide the create check, high-risk classification, and the independent private-project membership rule. A project membership restriction can coexist with native parent policy, but must not accidentally rewrite the shared administrator contract.

3. **Specify revocation-through-commit coordination with authority writers.** Draft line 28 correctly says hydration is not an authority lock. A transactional recheck and project revision CAS alone do not prevent another transaction from revoking authority after the read. The protocol must cover user status/role assignment, permission-set flags, project membership and the team rows used by CRM ceilings. In particular, team manager and member writers (`src/features/identity/teams.service.ts:33` and `:84`) need to participate in the same ordering/fence contract. Keep the draft's real-PostgreSQL concurrent revocation cases as enablement gates; do not replace them with mocked authority data.

The proposed independent edit/coordinate grants, project membership intersected with canonical CRM parent ceilings, and default-denied ordinary create permission otherwise fit the committed Settings boundaries. Registration, migration allocation and service enablement remain with their named owners.

No source, schemas, providers, authentication, permissions or runtime services were modified by this review. The Settings worktree remains clean at `ec9b3f8`; its completed goal was not reopened.
