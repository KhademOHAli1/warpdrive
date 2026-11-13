---
sidebar_position: 14
title: MCP server
description: "Connect AI assistants (Claude, ChatGPT, Cursor) to Warpdrive over an OAuth-authenticated MCP server: enabling it, connecting a client, the available tools, permissions, and revoking access."
---

# MCP server

Warpdrive exposes a [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
server so AI assistants like Claude, ChatGPT, and Cursor can search your CRM and act
on it in natural language: find deals, log activities, update records, add notes.

Every action runs as the Warpdrive user who signed in, and is bounded by that user's
existing permissions and visibility rules. Connecting an assistant never grants it more
access than you already have.

:::important
MCP can create and update CRM records and archive or restore leads. It can delete
unsent drafts in your mailbox. Review write requests in your client before
approving them. Email sending and permanent deletion of CRM records remain
actions outside the MCP tool list.
:::

## Enabling the server

The MCP server is on by default and needs one secret: a signing key for the access
tokens it issues. Generate a 32-byte key encoded as base64:

```sh
openssl rand -base64 32
```

Set it in your Warpdrive environment (the box `.env`):

```dotenv
MCP_ENABLED=true
OAUTH_SIGNING_KEY=<the-generated-base64-value>
```

:::caution
Keep `OAUTH_SIGNING_KEY` secret and stable. Replacing it invalidates existing signed
access tokens after every serving app instance uses the new key. Revoke affected
clients separately to invalidate their refresh grants. When `MCP_ENABLED` is true,
Warpdrive requires a valid 32-byte key at startup. For Docker secrets, set
`OAUTH_SIGNING_KEY_FILE` to the file holding the key.
:::

Make sure `BASE_URL` is the public HTTPS origin your clients reach Warpdrive at. When
`MCP_ENABLED=false`, the MCP and OAuth endpoints return HTTP 404.

## Connecting a client

Open **Settings > Connected apps > AI clients** and copy the MCP server URL.
If your installation shows no URL, ask your operator to check the server
configuration. The endpoint uses this format:

```text
https://<your-domain>/api/mcp
```

Warpdrive is a full OAuth 2.1 authorization server: it handles discovery, dynamic
client registration, the authorization code flow, and PKCE (S256). Sign in using a method
enabled for your Warpdrive installation, complete any required MFA, then review and approve
the client's consent request. Administrators always require strong authentication. There
are no API keys to copy.

To connect from Claude or Claude Desktop:

1. Open **Customize > Connectors** and select **Add custom connector**.
2. Enter a name such as `Warpdrive` and paste the server URL.
3. Connect, sign in to Warpdrive, and review the consent screen.
4. Enable the connector in a conversation. Your organization may need to approve it first.

For current client controls and network requirements, see the
[Claude custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
Other clients can use the same endpoint if they support remote MCP over
Streamable HTTP with OAuth and PKCE.

## Tools

**Read**

- `search` (across everything)
- `list_deals`, `get_deal`
- `list_leads`, `get_lead`
- `list_persons`, `get_person`
- `list_organizations`, `get_organization`
- `list_activities`, `get_activity`
- `list_pipelines`, `get_pipeline`
- `pipeline_summary`
- `list_emails`, `get_email`
- `list_email_drafts`

**Write**

- `create_deal`, `update_deal`, `move_deal_stage`
- `create_lead`, `update_lead`, `convert_lead_to_deal`, `archive_lead`
- `create_person`, `update_person`
- `create_organization`, `update_organization`
- `create_activity`, `update_activity`, `complete_activity`
- `add_note`
- `create_email_draft`, `update_email_draft`, `delete_email_draft`

The draft tools use your connected mailbox and can link drafts to a deal or
person. Review and send the draft from Warpdrive.

## Permissions and safety

MCP acts as the user who completed the OAuth sign-in. Your visibility rules and
permission flags apply to every call: a record you cannot see is not readable through
MCP, and an action you lack permission for is denied through MCP the same way it is in
the app. Every write is recorded in the change log, attributed to you, exactly like a
change made in the UI.

:::tip
Check the record, fields, and intended action before approving a write. Start with
a read request to check that the client reaches the correct workspace.
:::

## Revoking a connection

Open **Settings > Connected apps > AI clients** and find the client under
**Authorized apps**. Select **Revoke** and confirm to invalidate its access and
refresh tokens for your account. The client must sign in again to reconnect.
You can also remove the connector from the client's own settings.

Authentication upgrades, account recovery and stricter MFA policies can also revoke existing
grants. Reconnect the client, complete the required sign-in and MFA steps, and approve a new
consent request before it can access the workspace again.
