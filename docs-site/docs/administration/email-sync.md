---
title: Email sync
description: "Connect Gmail or an IMAP and SMTP mailbox, manage synchronization, and troubleshoot connection problems."
---

# Email sync

Open **Settings > Email sync** (`/settings/email-sync`) to manage the mailboxes
you use in Warpdrive. Each mailbox belongs to the account that connected it.
Use **Email content** (`/settings/email`) to manage signatures and templates.

![Earlier Gmail-only Email sync screen](/img/screenshots/email-sync/settings.png)

The screenshot shows an earlier Gmail-only screen. If your installation offers
**Add mailbox**, use it to choose Gmail or **Work or personal email**. Earlier
installations can offer **Connect Gmail** directly.

## Connecting a mailbox

- For Gmail, choose **Connect a Gmail account**, select your mailbox in Google,
  and review the permissions on the consent screen. Ask your operator to check
  the Google OAuth client if Gmail is unavailable.
- For an IMAP and SMTP mailbox, choose **Work or personal email**. Enter the
  incoming and outgoing server details and the credentials your mail provider
  supplied. Choose **Check connection**, then select the folders and how many
  days of history to sync. Choose **Connect mailbox** to start synchronization.
  The connection check itself sends no message.

### Required scopes

For Gmail, Warpdrive requests `openid`, `email`, `gmail.modify`, and
`gmail.send`. Google uses the identity scopes to identify the mailbox selected
during consent. See [Installation](/setup/) for setting up the OAuth client.

### Offline access

Gmail authorization must provide a refresh token so sync can continue in the
background. If the consent screen has been open for more than ten minutes,
start the connection again.

## What the first sync does

The first Gmail sync records the current Gmail history position and syncs changes
from that point forward. For an IMAP mailbox, the first sync imports from the
folders and history window you selected. It can take time for messages to appear.

## Disconnecting

Choose **Manage mailbox**, then **Disconnect**. The CRM stops future sync and
sending from that mailbox and keeps conversations already imported. Reconnect
the same address to resume its existing connection. Cancel any queued messages
you no longer want to send from **Outbox** before disconnecting.

## Troubleshooting

- If Gmail asks you to reconnect, use **Update connection** and complete the
  Google consent screen again. This is commonly needed after Google revokes
  the previous grant.
- If an IMAP connection fails, verify the server addresses, ports, TLS options,
  and credentials against your provider's settings. Use an app password if your
  provider requires one.
- If mail stops syncing while the mailbox is connected, check the mailbox status.
  Ask the deployment operator to check the worker if the problem persists.

## Related

- [Email](/features/email/)
- [Installation](/setup/)
