# Disconnecting a mailbox

Disconnecting stops future syncing and sending through this CRM. Imported CRM conversations stay under their existing access permissions. A message already accepted by a mail server cannot be recalled by disconnecting.

## Before you confirm

Review the Outbox first. Disconnecting does not cancel or delete queued send attempts. Cancel eligible messages there before disconnecting if you no longer want them sent. Cancellation is limited to your own unclaimed, unsent pending/failed attempts with no non-rejected delivery receipt. An attempt that is currently claimed or still marked as started, or has a partially accepted or uncertain outcome, cannot be cancelled to bypass duplicate-send protection.

Both the mailbox manager and the Gmail control in Settings → Connections use a confirmation dialog explaining queued messages, retained conversations and provider access. Cancel closes the dialog without disconnecting. Confirm uses the existing authenticated disconnect action for that mailbox.

## Access at the provider

**Google:** when a saved refresh token exists, the CRM queues a durable revocation request and removes its local credentials in the same transaction. Local access is stopped independently of whether Google has confirmed revocation. A pending status means remote revocation is still outstanding. A complete status requires a recorded revoked result. If automatic revocation cannot be confirmed, check the Google account and revoke access there if needed; password-based mailbox instructions are not shown for this case.

**Independent IMAP/SMTP:** the CRM removes its stored credentials. This does not change the password or revoke an app password at the mail provider. Revoke provider-side access there when needed. Other mail clients are not disconnected by removing credentials from this CRM.

## What is retained

- Imported messages, threads and their existing CRM links remain subject to current ownership and visibility rules.
- Existing send attempts and delivery receipts remain; disconnecting is not a shortcut around an uncertain or already-started send.
- The account is marked disconnected and loses its default-sender status. If this was the default and another active, unpaused, send-capable account exists, the server chooses the earliest by creation time and ID as the new default.
- Local credentials are cleared, and connection/credential versions advance so stale connection operations cannot use the old authority.

## Implementation and evidence boundary

This is MAIL-008 (#279): explain revocation, queued-send cancellation and retained imported records. It does not relax ownership or cancellation rules, erase messages, prove a real provider revocation, or complete the whole mail programme. MAIL-001 (#272) remains its canonical prerequisite. The UI change is private pending integration and qualification; source review and focused tests do not establish installed-provider or complete journey acceptance.

Source baseline: `99f4a2df9a12dc60246c0e25274d6a4168636f0d`.

- `src/features/email/mailAccountsRepo.ts`: local disconnect, durable Google revocation intake, retained rows and default replacement.
- `src/features/email/mailConnectionMutations.ts`: native fresh-session and actor ownership boundaries.
- `src/features/email/mailConnectionHttpView.ts`: provider revocation status mapping.
- `src/features/email/worker.ts` and `sendConnection.ts`: disconnected-account/generation guards.
- `src/features/email/outboxCancel.ts`: guarded cancellation and delivery-receipt restrictions.
- `src/app/(app)/settings/connections/page.tsx`, `IntegrationHub.tsx` and `email-sync/EmailSyncClient.tsx`: the live Gmail settings entry point.
