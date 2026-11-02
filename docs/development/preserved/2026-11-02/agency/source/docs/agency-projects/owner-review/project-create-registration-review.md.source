# Project-create registration patch for owner review

1 November 2026. **Review-only, unapplied and untested. Not authority acceptance.**

Exact source base: `3e84bc14c60cd3abb7c6340ba2022e6aa0dc3af2`. HEAD was read and matched that full commit when this artifact was prepared. The patch is registration-only: five existing production files, six added lines, no deleted lines. No writer, route, project access policy, API, new shared helper/export, migration, permission-set backfill or source application is included. The frozen 52-file Agency candidate was not edited.

Patch: `project-create-registration-review.patch`
SHA-256 of exact UTF-8 patch bytes: `a711f391c5f6fad2281937d38105fb2109c4df61b2a65e275ef273a2edb6df23`.

## Exact proposed delta

1. `src/constants/permissionFlags.ts`: add `project.create` to `GLOBAL_FLAGS` and `HIGH_RISK_FLAGS`; leave `REGULAR_TRUE` unchanged, so the existing `buildFlags` produces false for regular defaults.
2. `src/features/permissions/actions-meta.ts`: add `project.create` to `GlobalAction`, with no ownership, record-scoped or team variant.
3. `src/features/identity/messages/settings.fa.json`: add `_labels.permissions.project_create` = `ایجاد پروژه`.
4. `src/features/identity/messages/settings.de.json`: add `_labels.permissions.project_create` = `Projekt erstellen`.
5. `src/features/identity/messages/settings.en.json`: add `_labels.permissions.project_create` = `Create project`.

The labels use the existing `_labels.permissions` and dot-to-underscore lookup convention. `PermissionFlagGroups` already enumerates `GLOBAL_FLAGS`; `settingsPermissionLabel()` resolves these catalog entries. These supplied labels remain review copy, with no native-language or rendered acceptance claimed.

## Byte identity and textual reconstruction

SHA-256 below hashes raw file content, not Git blob objects. Proposed hashes refer to in-memory post-patch content only. They do not identify applied source.

| Exact path | Base content SHA-256 | Proposed content SHA-256 |
| --- | --- | --- |
| `src/constants/permissionFlags.ts` | `b97543143da451bb58fc0c8b7c94b1bf587a259c768f39d31fc861fbf50b37a2` | `6a5213b101ed6cb03a1430f8ba006e4f14412dd6b5a3cdb1ee975286e69109ee` |
| `src/features/permissions/actions-meta.ts` | `ba455ca84dcd28446138edee51402b6e4c27c83be162cb0c449e68221123f052` | `049d9ee0864e58b0b0e44b66c215c4af6655cbcd2e305d12a8695c3da9913d9d` |
| `src/features/identity/messages/settings.fa.json` | `4e74330b1e79f6587d6807fdaa99472ec4656011aecccbdcac4512951db79293` | `db0473c64039891143786973932fe387b7b5e652016392768dd6d53713b4e2fe` |
| `src/features/identity/messages/settings.de.json` | `72470543977153a401a09e1669625453d126dabb4e590ad6100c505f883336e7` | `42d7e769bc8fc9adc75e16ad346c1df9c4d0ac5cd5337c0a8abf9f27d82b7d80` |
| `src/features/identity/messages/settings.en.json` | `1930dc03a0884663c2e03a9f2d94acb2600848d4ce5c2f4d30fd44254c67836a` | `c4bee0a196f68fc9498d175faa0778d8e5bcd13ee75d7b776584eea384f76cb6` |

The patch was generated from `git show <full-base>:<path>`. A bounded text-only reconstruction matched every context/removal line against those exact base bytes and reproduced each proposed hash in memory. No `git apply`, checkout/index mutation, compiler, formatter, lint or test runner was used. This textual check is not application, source qualification or runtime evidence. Revalidate against any later base before application.

## Existing native-admin and grantor semantics are unchanged

- `src/features/permissions/can.ts`, `can()`: inactive actors deny first; an active actor with native `type === "admin"` returns true before flag resolution. Global regular-account permission checks then use the actor's effective flag set. Registering this flag does not create a new administrator exception or make administrator creation require an explicit flag.
- `src/server/hydrateActor.ts`, `hydrateActor()`: native type is derived from `users.isAdmin`; administrator flags remain empty at hydration. Permission-set names, labels and client booleans do not establish native administrator status. No direct `actor.flags.has("project.create")` writer is added here.
- `ADMIN_DEFAULT_FLAGS` already derives all registered keys as true for stored clarity; this proposal does not alter that convention. `REGULAR_DEFAULT_FLAGS` derives false for the new key because it is absent from `REGULAR_TRUE`. Existing maps that omit the key gain no explicit true entry from this artifact.
- `src/features/identity/guards.ts`, `canGrantFlags()`: a non-admin with `permissions.manage` cannot enable a flag in `HIGH_RISK_FLAGS`; a native admin can. `createPermissionSet()` and `updatePermissionSetFlags()` already use that guard. `assignPermissionSet()` in `src/features/identity/users.service.ts` also routes a non-admin assignment of carried enabled flags through `canGrantFlags()`. These implementations are unchanged.
- `permissionFlagsSchema` in `src/features/permissions/schemas.ts` derives known keys from `ALL_PERMISSION_FLAG_KEYS`; `completePermissionFlags()` supplies false for absent keys in the Settings editor. Neither helper is edited or replaced. Schema recognition alone is not an authorization grant.

No `can()` or create-flag outcome supplies project ownership/membership, canonical CRM parent visibility, accepted owner eligibility or financial access. A later writer must intersect the accepted project policy with current native authority and every applicable CRM ceiling. The source patch contains no such writer and cannot bypass or qualify those checks.

## Required meaningful scenarios, all NOT RUN

These are proposed acceptance scenarios, not added tests or observed results:

- Registry/defaults: the key is global and high risk, appears once in the key registry, regular defaults are false, and existing regular flags remain unchanged. Existing omitted/false flags do not gain runtime authority.
- `can()` matrix: regular missing/false denies; explicit true permits the global check only; inactive regular and inactive native admin deny; active native admin behavior matches the explicitly accepted shared contract.
- Grantors: delegated `permissions.manage` cannot enable `project.create` via create/update or assign a permission set carrying it; native-admin grant behavior remains the accepted existing rule. A permission-set display name such as Admin must not establish native admin authority.
- Boundary: the registered boolean key is recognized, unknown keys/nonboolean values remain invalid, and the existing complete-map/omitted-key boundary semantics are retained without inventing a new defaulting API.
- Settings: all three catalogs resolve the exact new key without raw-key fallback, parity remains intact, and the existing editor includes the new global flag as false when omitted. Native FA/DE/EN, RTL and rendered accessibility review remain separate.
- Before any writer enablement: a create grant must not supply existing-project read/edit/membership or finance; hidden/deleted/archived CRM parents, unaccepted/inactive selected owner and cross-client links deny under the accepted transaction policy. Revocation races require the real PostgreSQL lane.

Likely existing test surfaces for an authorized later test-first patch are `src/constants/permissionFlags.test.ts`, `src/features/permissions/can.test.ts`, `src/features/identity/guards.test.ts`, `src/features/identity/assignSetEscalation.test.ts`, `src/features/identity/germanFactories.test.ts` and the adopted catalog/editor tests. Exact additions and runners remain owner-selected. No red, green, static, PostgreSQL, browser or native acceptance is supplied by this artifact.

## Owner decisions still required

1. Platform/Settings must accept the exact five-file registration and label scope, native-admin create behavior, and admin-only high-risk grantor/assignment policy. Default-deny here means ordinary regular-account defaults, not a new denial rule for native administrators.
2. Agency/Settings must accept the separate project action table: owner versus read/edit/coordinator membership, lifecycle grants, owner/membership changes and whether native administrators need explicit project membership. This patch grants none of them.
3. Native CRM/current membership and selected owner admission must remain explicit: active accepted internal identities, current owner/member grants, all authoritative CRM links and link consistency. Existing `assertReferenceVisible()` gaps for deal-level archive and invited users still need the already proposed project-command checks.
4. Shared authority owners must agree the revocation-through-commit protocol and participating writers, including permission-set/user state, project owner/membership, visibility groups, teams and CRM/pipeline restrictions. No shared lock/fence export is invented here.
5. Actual module admission, schema/Privacy/migration acceptance and real repository/native qualification remain independent enablement gates. This registration proposal is not approval of project-core persistence, a commercial baseline or financial behavior.
