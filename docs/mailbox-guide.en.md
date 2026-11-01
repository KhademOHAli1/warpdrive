# Mailbox guide

[فارسی](mailbox-guide.fa.md) · [Deutsch](mailbox-guide.de.md)

Mailbox connections are separate from signing in to Warpdrive. This guide describes the implemented IMAP/SMTP workflow; it does not certify compatibility with every provider. See the [current acceptance gaps](local-integrations-progress.md), including external-provider and complete browser qualification.

## Connect a mailbox

1. Open **Settings → Email sync → Add mailbox** and choose **Work or personal email**. Gmail is a separate option when its mailbox OAuth configuration is available.
2. Enter the authorized email address and sender name. Fill in the incoming IMAP and outgoing SMTP host, port, security mode and username separately. Use the provider's password or app password, as required. **Direct TLS** and **Upgrade with STARTTLS** both require a verified encrypted connection; there is no plaintext fallback.
3. Choose **Check connection**. This checks access without sending a test email. If identity confirmation is required, complete the native account-security prompt, using an authenticator code when required, then retry the previous action. Mailbox passwords are cleared before this confirmation and must be entered again. A successful check removes the password fields; an expired check must be repeated before saving.
4. Review the folders, history and Sent-copy choices, then choose **Connect mailbox**. Credentials are encrypted on the server and are not shown again when editing the connection.

Authentication errors require corrected credentials; certificate errors require the right host, port or trust configuration. Ask the operator to resolve certificate/network policy failures rather than bypassing TLS verification.

## Folders, history and progress

Review the suggested Inbox and recognized Sent folders; select at least one folder. History defaults to **90 days**, with an editable range of **1–3,650 days**. Importing history does not delete messages from the mail server. Read-only folders can be synchronized; **Access not checked** does not mean a folder is writable. Available read, move and trash actions depend on the connection's capabilities.

Synchronization runs in the background. The settings list refreshes while the tab is visible; **Refresh mailbox status** also requests an update. “Items processed” counts mailbox items in the selected folders, including skipped items, rather than unique messages or conversations. A total may be unavailable.

Skipped items show finite reasons: processing limits, unreadable message structure, or a message no longer present on the server. Current parsing limits are **25 MiB per message, 10 MiB per attachment, 2 MiB of body content, 64 KiB of headers and 50 attachments**. Oversized or invalid messages are skipped rather than silently truncated; they are not deleted from the server. Review them in the original mailbox. See the [implemented limits](../src/features/email/providers/rawMimeTypes.ts).

The CRM keeps a copy of accepted outgoing mail in either Sent-copy mode. **CRM copy, no extra server copy** is the default. Choose **Also save a copy in a Sent folder** only when the provider does not already save outgoing messages, and select the intended folder. Automatic detection is unavailable. Unknown folder access is checked before append; a known read-only folder cannot be selected. A failed or uncertain additional Sent copy does not cause the email to be sent again.

## Choose the sender and schedule a message

You can connect multiple personal mailboxes and choose a default sender through **Manage mailbox → Make default sender**. New messages use an available default; **Choose sender mailbox** selects another active send-capable account. Switching asks you to **Create draft copy**: recipients, body and attachments are retained in a separate draft, and the original remains in its previous mailbox. Replies stay with the original conversation's mailbox. Reopening a saved draft retains its mailbox.

Use **Send later** beside Send to choose a future date and time. Check the displayed time zone and UTC offset; calendar display follows your preferences. Nonexistent local times are rejected. For a repeated clock time, the picker explains that the earlier occurrence will be used. Scheduling creates a durable request, not proof of sending; the worker and mailbox must be available when it runs.

## Read the sending result

| Result                        | What to do                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled / sending / pending | Keep the saved request and use **Check send status**.                                                                                                                 |
| Accepted                      | The SMTP server accepted the message; this is not confirmation of recipient delivery.                                                                                 |
| Accepted, CRM copy incomplete | Check status to finish local receipt/copy repair without resending.                                                                                                   |
| Partially accepted            | Review accepted and rejected recipients. Accepted recipients may already receive the message; do not resend the whole message blindly.                                |
| Unknown                       | The server may have accepted it. Keep the draft/request and check status before deciding on any new send.                                                             |
| Known failure                 | If offered, **Retry the same request** follows the existing intent. **Edit draft** creates a fresh intent only after the previous unsent request is safely cancelled. |

Status checks do not resend email. Partial and unknown submissions are held for review rather than automatically resubmitted. A network timeout alone does not prove failure. Structured delivery-status notification (DSN)/bounce reconciliation remains an open qualification gap; investigate later delivery failures with the mail provider.

## Pause, update or disconnect

**Pause synchronization** temporarily prevents new synchronization and sending through that connection; **Resume synchronization** restores its use. Review scheduled requests separately. **Retry synchronization** concerns receiving mail, not resending outgoing messages. **Update connection** checks fresh credentials for the same mailbox and retains its existing conversations and saved scope; passwords are blank. **Disconnect** requires confirmation, stops future access and preserves CRM conversations under their existing permissions. It cannot recall an accepted message. Removing an IMAP/SMTP password here does not revoke that password or app password at the provider; revoke it there when needed. If provider access removal is shown as pending, local access is already stopped while remote revocation remains incomplete.

## Operator setup and recovery

Use the [environment template](../.env.example), [deployment guide](deploy.md) and [authentication operations](auth-operations.md). `AUTH_SMTP_*` delivers authentication notices; it does not connect a customer's mailbox.

Public endpoints use verified TLS. Internal hosts and private addresses require operator-managed grants through `MAIL_INTERNAL_ENDPOINTS`, a JSON array, or `MAIL_INTERNAL_ENDPOINTS_FILE`, a path to that JSON file. These are deployment settings, not mailbox-form fields. Each grant matches an exact `protocol`, `host` and `port`; mail protocols are `imaps`, `imap+starttls`, `smtps` and `smtp+starttls`. Prefer explicit `allowedAddresses` pins. Loopback additionally needs `allowLoopback: true`; metadata and other prohibited addresses remain blocked. For a private CA, the grant's optional `ca` contains PEM certificate text, not a filename. Certificate hostname/IP verification remains enabled. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or broaden access to fix a failed check. Provide the policy to both app and worker and restart affected processes after configuration changes. Exact fields: [mail configuration](../src/config/mailEnv.ts), [file-variable loading](../src/config/env.ts), [endpoint policy](../src/features/connections/endpointPolicy.ts).

Keep credentials, policy files, encryption keys and backup archives out of Git and diagnostic reports. Preserve `TOKEN_ENCRYPTION_KEY`; replacing it does not decrypt existing credentials. Mail attachments remain subject to CRM permissions. Outgoing snapshots use private object storage; some incoming attachment bytes are fetched from the original mailbox on demand. A database dump alone therefore does not preserve every attachment. Back up the database, private objects and required encryption/signing secrets together, retain needed provider-side data, and verify a restored installation. Follow the [migration and restore qualification plan](mail-migration-qualification.md); a passing build or local send is not restore or production acceptance.
