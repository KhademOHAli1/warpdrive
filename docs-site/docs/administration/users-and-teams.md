---
sidebar_position: 1
title: Users and teams
description: "Manage invitation-only accounts, authentication security and recovery, deactivate users safely, and organize teams and managers."
---

# Users and teams

## The first administrator

The deployment operator creates the first administrator with the host-only
`bootstrap` command described in [Installation](../setup.md#4-bootstrap-the-first-administrator).
`SEED_ADMIN_EMAIL` defines the intended recipient; signing in with that address
does not automatically create or promote an account.

Bootstrap is locked and one-use. It creates the Regular and Admin permission sets,
Everyone group, initial pipeline and labels, plus an administrator placeholder and
an expiring invitation. It refuses an existing user or initialized workspace.
The recipient must claim the invitation and complete verification and the required
strong-factor enrollment before application access.

An expired, unclaimed first-administrator invitation can be renewed only with the
host's `resend-bootstrap` command. Renewal keeps the original account and recipient;
it cannot replace the administrator or reopen bootstrap.

## Users

`/settings/users` lists everyone, filterable by status. `/settings/security-admin`
adds searchable account details, invitation management, delivery status, recovery
requests, authentication policy, and the security activity log. Sensitive changes
require a fresh identity confirmation. If prompted, confirm your identity in
`/settings/security`, then retry the action.

![The users list, showing active, invited, and deactivated accounts](/img/screenshots/users/list.png)

### Inviting

Inviting creates a placeholder account, assigns a permission set, joins the user to
the Everyone group, and queues a localized invitation email. The invitation expires
after 72 hours and can be used only once. Its bearer token is stored as a hash;
delivery content is encrypted in the outbox.

The invitee opens the link and joins with the exact invited email address using a
password or a configured provider. Password-based joins must complete email
verification before signing in. Provider admission also checks the invitation and
the returned address. A shared email domain alone never grants access.

Resending creates a new invitation and invalidates previous links; revoking blocks
an unclaimed invitation. Delivery retries do not renew an expired invitation.
Review email delivery separately from invitation acceptance: a queued message may
still need SMTP or worker attention. Invitations and authentication messages support
Persian, German, and English.

### Account identity and sign-in methods

The stable CRM user UUID remains the account's identity and record owner across
authentication methods. Existing Google identities are migrated using their stored
provider subjects while preserving those UUIDs. A matching email address never
automatically merges two accounts or attaches a different provider identity.

Users manage password, passkeys, authenticator, recovery codes, linked providers,
and sessions in `/settings/security`. Adding a provider is an explicit action by a
verified, freshly authenticated account with a matching email. Verified email
changes update the existing profile; they do not transfer another account's data.

Google, Microsoft, and OIDC sign-in are optional deployment choices. Google sign-in
and Gmail mailbox connection have separate consent flows and callbacks. Connecting
Gmail does not create a CRM user or bypass an invitation.

### Authentication policy

Administrators always require a verified strong factor, either an authenticator
challenge or a passkey with user verification. An administrator can require it for
everyone in Security administration. Users who have enabled two-factor
authentication must also complete it at sign-in.

The default policy is a 30-minute idle limit, a seven-day absolute session lifetime,
and a five-minute fresh-authentication window for sensitive changes. Tightening the
MFA policy or promoting a user to administrator invalidates the affected existing
MCP grants, so clients must obtain fresh authorization under the new requirement.

### Deactivating

Deactivation ends local access in the same transaction: application sessions and
MCP access/refresh grants are revoked, outstanding authorization codes and invitations
are invalidated, and the mailbox is disconnected. The worker retries remote Gmail
revocation separately, after local access has ended. The account and CRM history
remain available for administration and ownership transfer.

Two guards apply:

- You cannot deactivate yourself.
- The **last established active administrator** cannot be deactivated or demoted.
  An unclaimed invited administrator does not count as a replacement.

Reactivation is administrator-only. It does not restore old sessions, MCP grants,
or mailbox connections. Account security changes are audited and relevant changes
queue a localized security notice to the affected user.

### Lost passwords, lost factors, and account closure

Use the normal password-reset flow for a forgotten password. Its email link expires
after 15 minutes; a password reset does not remove a required authenticator or passkey.

For lost factors, the owner submits a recovery request. An independent active
administrator reviews it in Security administration. Approval records the review;
it does not remove factors. A deployment operator then verifies ownership through a
trusted process and completes that approved case from the host:

```sh
docker compose exec app bun dist/auth-operator.mjs recover \
  --request-id APPROVED_CASE_UUID --confirm
```

Completion removes registered factors, revokes existing access and reusable
integration grants, and queues both a security notice and the normal password-reset
message to the verified owner's address. It preserves the CRM UUID, permissions,
provider subjects, and record ownership. Resolved cases cannot be replayed.

A sole locked-out administrator has a separate host-only emergency procedure that
requires explicit ownership review and additional flags. There is no browser
self-approval or operator-selected password. Follow the
[authentication operator runbook](https://github.com/KhademOHAli1/warpdrive/blob/main/docs/auth-operations.md)
for the ordinary and emergency procedures.

Account-closure requests are also reviewed in Security administration. Resolving an
approved closure deactivates the account under the same self/last-administrator
protections; it does not delete CRM history. Transfer record ownership separately
when needed.

## Teams

`/settings/teams` groups users and gives them managers.

![Teams](/img/screenshots/teams/list.png)

Teams exist to express management, not just grouping: a permission set can grant an
action over records owned by members of a team you manage. See
[Permission sets](./permission-sets.md).

A manager sees their members' records only when their permission set also includes the
relevant view permission. Managing a team is not by itself a grant of visibility.

:::caution
Creating a team and setting its roster are two separate operations, as are saving a
team's details and its roster. If the second fails, the first has already applied. A
failed save can leave a team created but empty, or renamed with an unchanged roster.
Re-open the team and confirm before retrying.
:::

Deleting a team has **no confirmation step** and removes its roster with it.

## Who can administer users

Administrators can do everything below. Holders of `permissions.manage` who are not
administrators can view the page and invite ordinary users, but cannot:

- promote or demote administrators,
- deactivate or reactivate anyone,
- invite an administrator,
- assign their own permission set, or
- assign a set containing high-risk permissions.

:::note
The interface still renders those controls for a non-administrator holding
`permissions.manage`. The restriction is enforced when the action is submitted, so
some visible controls will report a permission error rather than being hidden.
:::

## Related

- [Permission sets](./permission-sets.md)
- [Visibility groups](./visibility-groups.md)
