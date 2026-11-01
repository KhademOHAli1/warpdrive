# Project-create registration: Settings review decision

1 November 2026. **Accepted for test-first implementation within the exact registration scope below.** This is the Settings compatibility review decision, not source qualification or project persistence enablement. No change to the supplied production patch is requested.

Reviewed base: `3e84bc14c60cd3abb7c6340ba2022e6aa0dc3af2` in `/Users/ali/Developer/warpdrive-agency-projects`.

Reviewed artifact: `/Users/ali/Documents/Codex/2026-10-31/warpdrive-agency-projects-implementation/outputs/project-create-registration-review.patch`.

Exact patch SHA-256: `a711f391c5f6fad2281937d38105fb2109c4df61b2a65e275ef273a2edb6df23`.

## Accepted contract

- Add `project.create` once to `GLOBAL_FLAGS`, once to `HIGH_RISK_FLAGS`, and to the existing `GlobalAction` union. No ownership, record or team variant is introduced.
- Leave `REGULAR_TRUE` unchanged. Ordinary regular-account defaults deny the new flag; missing or false stored flags confer no create authority. An explicit true regular-account flag satisfies only this global permission check.
- Preserve the existing native active-administrator behavior of `can()`: inactivity denies first, then native administrator type bypasses flag resolution. Native type continues to derive from `users.isAdmin`; permission-set names and client input do not establish it. Administrators need not acquire an explicit flag merely to pass this global check.
- Classify granting the flag as high risk. Existing create/update/assignment paths must continue using the existing grantor guards. A delegated `permissions.manage` actor cannot grant it or assign a set carrying it; native-administrator handling follows the existing shared policy.
- Accept the exact Settings labels: FA `ایجاد پروژه`, DE `Projekt erstellen`, EN `Create project`, at `_labels.permissions.project_create`. The current dot-to-underscore lookup and registry-driven editor need no replacement. Copy review does not establish native rendered or accessibility acceptance.

The production delta remains five existing files and six added lines. Companion tests may be added by the implementation owner. No migration, backfill, project writer, route, membership rule, finance grant, new shared authorization helper or change to `can()` is included in this decision.

## Two precise qualifications for the implementation tests

**A flag update checks every submitted true flag.** `updatePermissionSetFlags()` collects all true values from the incoming map, rather than only false-to-true changes (`src/features/identity/permission-sets.service.ts:63`). Therefore a delegated manager also cannot submit a map retaining `project.create: true`, even while changing another flag. The accepted policy preserves this behavior. Do not weaken it to a change-only check as part of this registration. A submitted false value is not itself a high-risk grant, subject to the other existing edit restrictions.

**Sparse stored maps and sparse schema writes have different boundaries.** Hydration reads true entries only (`src/server/hydrateActor.ts:30`), and the Settings editor completes missing keys to false (`src/app/(app)/settings/permission-sets/permissionSetFlags.ts:6`). However `permissionFlagsSchema` uses Zod 4's exhaustive `z.record(enum, boolean)` (`src/features/permissions/schemas.ts:6`). The installed Zod 4.6.7 implementation validates every enum key; the trailing TypeScript `Partial` assertion does not make sparse write maps valid. The editor already supplies a complete map. Omitting the entire `flags` property during create is the separate existing `.default({})` path in `src/features/identity/schemas.ts:6`. Preserve these boundaries and test them explicitly; do not introduce `partialRecord`, a defaulting helper or a schema relaxation under this acceptance.

## Meaningful test-first evidence to supply

1. Registry/defaults: exactly one global/key-registry entry, high-risk membership, false regular default, unchanged existing regular defaults; no new scoped variant.
2. Permission matrix: regular missing/false deny, true passes only the global check, inactive regular and inactive native administrator deny, active native administrator with an empty flag set passes. A permission-set name such as Admin must not change native type.
3. Grantor paths: delegated create/update reject true, including unchanged true on update; delegated assignment rejects a set carrying true. Preserve the existing native-administrator, self-edit and target-administrator rules. Database-backed service cases remain separate from pure guard tests.
4. Schema/editor boundary: complete maps recognize the new boolean key; unknown keys and nonboolean values reject; raw sparse maps retain the current rejection behavior. Separately show omitted stored keys become false in hydration/editor and cover the create default path without conflating it with raw `{ flags: {} }` input.
5. Settings: all three exact labels resolve without raw-key fallback, catalog parity remains intact, and the new global checkbox is unchecked when the stored key is omitted. Native layout/RTL acceptance requires its own rendered evidence.

## Review evidence and remaining gates

Read-only checks confirmed the Agency HEAD matches the stated base, all five working source files match that base, and in-memory reconstruction matches every patch context line and every proposed file hash in the supplied MD. The diff contains exactly six additions and zero deletions. Proposed JSON parses successfully. Existing registry/editor/lookup and authorization/grantor implementations were inspected independently. No patch application, source edit, test runner, formatter, build or runtime operation was performed for this review.

Relevant existing authority points are `src/features/permissions/can.ts:35`, `src/server/hydrateActor.ts:65`, `src/features/identity/guards.ts:28`, `src/features/identity/permission-sets.service.ts:24` and `:66`, and `src/features/identity/users.service.ts:58`. The grantor review describes their present policy; it does not qualify revocation or assignment races through commit.

The project action table, native-administrator project membership policy, active accepted owner admission, canonical CRM ceilings, Privacy/schema/module admission and coordinated revocation-through-commit protocol remain independent open gates. Passing `can(actor, "project.create")` alone does not settle any of them. This decision enables the narrowly scoped test-first registration work, not project persistence or a release.

The completed Settings implementation remains unchanged at `ec9b3f8943e42736edc6713c099fd2ef14068d0a`. Peer worktree changes and services were left untouched.
