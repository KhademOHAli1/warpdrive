# Better Auth implementation and qualification

Prepared 31 October 2026 from fork baseline `01dd1dd`, then merged with latest main `d37518a`
and its upstream import/permission updates. The upstream migration 0077 is preserved;
authentication migrations follow as 0078 through 0082. The scope is the
[approved twenty-task plan](auth-implementation-plan.md). This report records source changes,
local qualification and the controls needed for deployment. Production activation requires
the installation's real provider, SMTP, domain and backup checks below.

## Access policy and transitions

| State                                    | Allowed workflow                                            | Application access                                         |
| ---------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| No invitation                            | Sign in to an existing account or request help              | No new account admission                                   |
| Valid invitation                         | Claim its exact email and existing CRM UUID                 | Requires verification and applicable strong authentication |
| Unverified email                         | Verification/resend and recovery instructions               | Denied                                                     |
| Required factor missing                  | Initial strong-factor enrollment                            | Denied until the factor is verified                        |
| Factor challenge pending                 | Verify an enrolled factor or use a single-use recovery code | Denied                                                     |
| Active, verified and policy-compliant    | CRM operations under existing permissions                   | Allowed                                                    |
| Sensitive action after freshness expires | Confirm identity with an appropriate existing method        | Action denied until confirmation                           |
| Suspended or revoked                     | Public sign-in/help workflows                               | Sessions and grants denied                                 |
| Approved account closure                 | Guarded suspension, ownership review and retention          | Access revoked; records retained                           |

Administrators always require strong authentication. An installation may require it for every
user. A user-verified passkey satisfies the strong policy; a password or federated identity
alone does not satisfy required MFA. The default idle, absolute and freshness limits are
30 minutes, 168 hours and 5 minutes. The same CRM authority and active-user checks remain in
HTTP, tRPC, server actions and WebSocket admission.

## Implementation coverage

| Plan           | Implemented evidence                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BA-01 to BA-04 | Explicit admission/assurance policy, native adapter qualification, additive schema migration, existing UUID/actor preservation and route integration.                                                                 |
| BA-05 to BA-10 | Localized sign-in/invitation/verification/reset/recovery, configured federation, passkeys, administrator MFA, optional workspace MFA and audited operator recovery.                                                   |
| BA-11 to BA-13 | Personal credentials, confirmed email changes, provider linking, devices, administration, invitation delivery, suspension/reactivation, ownership and policy workflows.                                               |
| BA-14 to BA-17 | Fresh authentication, last-method/admin protections, shared PostgreSQL rate limits, hashed bearer credentials, encrypted mail outbox, audit, revocation and data-expiry workers.                                      |
| BA-18          | Farsi/German/English catalogs, Iranian dates and digits, RTL/LTR layouts, focused dialogs and review against the existing shell. See [UI design and captures](auth-ui-design.md).                                     |
| BA-19 to BA-20 | Real protocol/PG tests, browser review, build/typing/lint checks, migration/restore rehearsal and the [host operator runbook](auth-operations.md). Release acceptance retains the installation-specific checks below. |

Private plugin tables have no public CRUD endpoints. Raw native session-list/token APIs,
implicit account merging, destructive user deletion and impersonation are unavailable.
Session tokens and recovery codes are stored as hashes. Reusable provider credentials and
outbox bodies are encrypted. Authentication changes produce localized notices without
credential values. Host recovery removes factors and revokes access only after the required
review; a password reset alone cannot bypass required MFA.

MCP consent rechecks a fresh, fully authenticated native session inside the grant transaction.
Code exchange and refresh rotation serialize with policy, promotion, recovery and factor
revocation. Tightening MFA policy invalidates existing grants; clients must authorize again.

## Migration and backup rehearsal

`migration.integration.test.ts` builds the pre-authentication schema through migration 0077,
inserts established and invited users plus existing CRM ownership/preferences and old access
grants, then applies the new migrations. It verifies unchanged CRM identities, names, roles,
ownership and locale preferences, exact Google subject binding, no identity for an unclaimed
invitation, and invalidation of old sessions/MCP access/refresh/auth codes. A real failing
regression exposed surviving MCP grants before the cutover SQL was corrected.

A separate local PostgreSQL 18 `pg_dump`/`pg_restore` rehearsal used the isolated synthetic
authentication demo. Nine comparisons covered CRM identities, native identities, factor and
session state, provider bindings, preferences, permission sets, group membership and contact ownership. The restored
probe database was removed after comparison. The encrypted-factor/session backup remains a
private local test artifact and is excluded from Git. This small fixture rehearsal does not
establish restore time or capacity for a production database.

## Qualification record after merging main

- Complete merged-tree unit suite on Bun 1.4.4: **5,713 tests across 918 files passed**.
- Focused UI suite: **52 tests across 17 files passed**, including progressive disclosure,
  Farsi/German text, dialog dismissal, focus restoration and expired-freshness recovery.
- Real native WebAuthn, TOTP and controlled OIDC qualification covers origin/issuer/PKCE/nonce,
  signature, user verification, invitation binding, explicit linking and replay/concurrency.
- Real PostgreSQL regressions cover shared limits, hash-only storage, last-method/admin
  races, operator recovery, outbox failures, grant-policy races and migration preservation.
- Browser review uses disposable local accounts. Password login, native administrator TOTP,
  actual POST logout, protected redirects, Iranian dates/digits, desktop/narrow layouts and
  keyboard focus were exercised. New credentials are tested through native protocol fixtures.

Final combined merged-tree PostgreSQL suite on Bun 1.4.4: **2,048 tests across 456 files
passed** in 140.00 seconds.

Merged-tree TypeScript, Biome and ESLint checks passed. The Next production application,
all five server/operator entrypoints and the documentation site also built successfully.
Tests use isolated databases; no production users, real invitations or operational provider
consent were changed. GitHub CI outcomes are separate from these local results.

## Hardening regressions

Actual failing regressions were captured before fixes for pending-session factor replacement,
cross-challenge TOTP replay, discovery-issuer mismatch, email-token replay/UUID reassignment,
concurrent administrator demotion, last-method removal with disabled providers, in-flight MCP
grant escape and native mutation/outbox rollback. Verification emails now open the localized
confirmation screen, including old/new-address steps, resend and account-selection recovery.
Pre-cutover email-verification links have no UUID-bound ledger entry and require a new message.

The broad PostgreSQL campaign also exposed retained test databases exhausting the disposable
container. Closing a fixture now drops an unused database without forcing external listeners
off their connections. WebSocket resource-limit qualification requires the pinned Bun 1.4.4
runtime, as detailed in [runtime compatibility](bun-runtime-compatibility.md).

## Installation and release checks

1. Preserve the current database, uploaded objects and encryption/authentication keys in a
   protected backup. Rehearse restoration with the installation's actual data size.
2. Configure HTTPS, a dedicated `AUTH_SECRET`, stable `TOKEN_ENCRYPTION_KEY` and verified SMTP
   delivery. Configure only the providers the installation uses, with exact callback/issuer
   values. Passkeys remain bound to the chosen domain.
3. Apply migrations during the agreed cutover. Existing sessions and MCP grants require fresh
   sign-in/authorization. Preserve UUIDs and reconcile existing Google subjects before rollout.
4. Exercise real Google/Microsoft/configured OIDC accounts and SMTP delivery in the target
   installation, including the intended first administrator's invitation and verification.
   Configure Gmail consent separately if used. Controlled local OIDC and captured mail do not
   prove external tenant, mailbox or SMTP configuration. Verify passkey enrollment and sign-in
   on the installation's intended physical devices and browsers; synthetic protocol fixtures
   do not establish device compatibility.
5. Retain the remaining dependency findings and their reachability limits from
   [the dependency review](auth-dependency-review.md). The recorded audit retains nine scanner
   entries across six package names, including runtime MinIO paths and development tooling;
   no clean-audit claim is made.

Rollback requires restoring the matching application version, database and stable keys from
the pre-cutover backup. Keep access disabled while reconciling a rollback; do not restore old
bearer grants as a way to bypass the new assurance policy.
