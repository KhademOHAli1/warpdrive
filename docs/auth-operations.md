# Authentication operator runbook

[English](auth-operations.md) · [فارسی](auth-operations.fa.md) · [Deutsch](auth-operations.de.md)

These commands run on the deployment host with its database access. They have no HTTP endpoint. Protect host access as an administrative capability, keep the database/encryption secrets out of shell arguments, and use the same validated environment as the app and worker. Commands print generic outcomes, never invitation/reset links, passwords, session tokens or recovery codes.

Production requires an HTTPS `BASE_URL`, a dedicated strong `AUTH_SECRET`, the existing stable `TOKEN_ENCRYPTION_KEY`, and working SMTP configuration. The app, operator process and worker must agree on these values. Use `AUTH_MAIL_TRANSPORT=smtp` in production; `capture` records a development result without delivering a message. Configure the verified first administrator address as `SEED_ADMIN_EMAIL`.

## Commands in a deployed container

The runtime image includes `dist`, not the source checkout. `bun run build:workers` bundles the operator CLI during the image build. Run these commands in the app service's existing environment:

```sh
bun dist/auth-operator.mjs bootstrap --email owner@example.com --name "Workspace owner" --locale fa --confirm
bun dist/auth-operator.mjs recover --request-id APPROVED_CASE_UUID --confirm
```

From a source checkout, the equivalent entry point is `bun run auth:operator`. Both entry points use the same services and argument validation. Exit status 0 means the operation committed and the message was queued, 1 means refusal/failure, and 2 means invalid arguments. A queued message is not evidence of delivery.

## First administrator

Apply the current database migrations before bootstrap. Start the normal worker service so its `auth-maintenance` schedule can deliver encrypted outbox messages. Verify HTTPS and SMTP configuration, then run the bootstrap command with the intended mailbox and explicit `--confirm`. The address must match `SEED_ADMIN_EMAIL` when that setting is nonempty. The default locale is `fa`; use `--locale de` for German or `--locale en` for English.

Bootstrap takes the existing PostgreSQL election lock `815274001`. It refuses a closed bootstrap or any existing CRM user, including an unbound placeholder. It never promotes, relinks or overwrites an existing identity. In one transaction it creates the default permission sets, Everyone membership and initial catalog as needed, creates a new administrator placeholder, saves locale/calendar defaults, issues the normal expiring invitation, queues its encrypted message, and closes bootstrap. The token is stored only as a hash outside the encrypted mail payload. No native identity, password or usable session is provisioned by the command.

The recipient completes the existing invitation and email-verification workflow. Administrators must enroll and verify a strong factor before receiving application access. Persian defaults to the Iranian calendar; German defaults to the Gregorian calendar. Both retain the app's initial time zone, `UTC`, until the user selects one.

Bootstrap is intentionally one-use. If delivery is pending or failed, repair SMTP/worker health; queued-mail retries can deliver an invitation only while its link remains valid. Invitations expire after 72 hours. The security event is `bootstrap.invitation`.

### Renew an unclaimed first-administrator invitation

Retrying an expired message does not renew its invitation. If the first administrator has not claimed the account, issue a replacement through the host-only command:

```sh
bun dist/auth-operator.mjs resend-bootstrap --email owner@example.com --confirm
```

The recipient must match both the stored invitation/account and the configured `SEED_ADMIN_EMAIL` when nonempty. This command accepts only the original sole active administrator placeholder, a closed bootstrap and its unaccepted, unrevoked self-issued invitation; that invitation may be expired. It refuses an accepted invitation, any native identity or Google subject, any other workspace user, and attempts to replace the intended administrator. It accepts no name or locale override: the new message retains the stored invitation's language.

Under lock `815274001`, the operation invalidates old links, cancels old queued messages and issues a fresh 72-hour invitation through the normal hashed-token/encrypted-mail path. Overlapping requests observing the same invitation produce one replacement. Queue failure rolls everything back. UUID, permissions, group membership, preferences and the closed bootstrap remain unchanged. The audit event is `bootstrap.invitation_renewed`. This renews an invitation; it does not create another administrator or reopen bootstrap.

## Ordinary lost-factor recovery

1. The account owner opens a factor-recovery request through the existing recovery workflow.
2. An independent active administrator reviews the case in Security administration. Approval records a reviewer and review time; a browser cannot approve its own factor recovery.
3. The host operator independently verifies that the request concerns the established CRM owner, records the ownership-review evidence through the organization's trusted process, and executes the approved case UUID with `--confirm`.

The ordinary CLI never approves a pending case. It calls the approved-recovery service, removes registered factors, revokes existing application/OAuth access, clears reusable integration grants, and queues the native password-reset workflow only to the account's active, verified email. It preserves the CRM UUID, provider subjects, existing password hash, permissions and record ownership. Remote integration revocation is retried by the worker after local access has ended.

Completion, its security notification and reset-message enqueue share one transaction. The completion notice and native reset email are separate messages. The host service explicitly verifies the outbox insertion because native Better Auth intentionally suppresses reset-mail callback failures. A queue failure rolls the recovery back. Reusing a resolved case cannot issue another recovery. The completion event is `recovery.complete`; the owner follows the mailbox link and enrolls a replacement factor through the normal UI.

## Emergency: the sole established administrator is locked out

This is a separate host-only ownership review. It accepts an existing **pending** factor-recovery case only when its owner is the sole established active administrator, has a verified native identity, and has matching CRM/native email addresses. Inactive, invited, unverified or non-sole administrators are refused.

Before running it, a human host operator must verify ownership outside the locked browser session using existing organizational records and a previously trusted contact channel. Record who performed the investigation and its evidence in the organization's incident process. The flags record the operator's attestation; they do not verify a person's identity.

```sh
bun dist/auth-operator.mjs recover --request-id PENDING_SOLE_ADMIN_CASE_UUID --confirm --emergency-last-admin --confirm-ownership
```

All three flags are required. The host service takes the common account lock before administrator/identity/case row locks, rechecks eligibility, writes `recovery.emergency_review` with the operator-attestation method, then calls the existing recovery completion and native reset-link workflow. Review, completion, revocation, audit events and encrypted message enqueue commit atomically. Concurrent executions produce one winner. There is no public route, browser self-approval, arbitrary destination-email override or operator-selected password.

## Delivery, cutover and verification

The regular worker registers `auth-maintenance` every minute. It delivers pending mail, retries integration revocation, and expires authentication records. Review mail status/attempts through the existing administration workflow. A host can inspect aggregate status without exposing encrypted payloads:

```sql
SELECT kind, status, count(*) FROM auth_mail_outbox GROUP BY kind, status;
```

Authentication cutover revokes old application sessions and pre-cutover MCP grants. Users sign in again and MCP clients obtain fresh authorization. Preserve an encrypted, restorable database backup before applying deployment migrations; a source build alone is not a deployment/restore qualification.

Qualification covers disposable PostgreSQL bootstrap races, existing-identity refusal, first-admin seed/locale/invitation storage, ordinary and emergency recovery admission, one-use concurrent execution, and real constraint-induced mail-queue rollback. The packaged CLI is built and exercised after removing its source paths. Tests do not send operational email or verify a real external identity-provider tenant. Retain the remaining dependency findings in [auth-dependency-review.md](auth-dependency-review.md) when accepting a release.
