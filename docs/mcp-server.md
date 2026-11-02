# Warpdrive MCP server

Warpdrive exposes an OAuth-authenticated Model Context Protocol server for CRM reads and writes. It lets compatible AI clients search CRM data and create or update records without granting more access than the signed-in Warpdrive user already has.

CRM records cannot be deleted through MCP. Leads can be archived and restored, and users can delete their own unsent email drafts.

## Enable the server

Generate a 32-byte signing key encoded as base64:

```sh
openssl rand -base64 32
```

Set these values in the Warpdrive environment:

```dotenv
MCP_ENABLED=true
OAUTH_SIGNING_KEY=<generated-base64-value>
```

Docker secret deployments may set `OAUTH_SIGNING_KEY_FILE` to a file containing the key instead. Keep this key secret and stable across app restarts. Ensure `BASE_URL` is the public HTTPS origin clients use to reach Warpdrive.

When `MCP_ENABLED=false`, the MCP and OAuth endpoints return HTTP 404.

### Locking down client registration

`OAUTH_REGISTRATION` controls RFC 7591 dynamic client registration, and defaults to `open`.

Open registration is what makes "paste the server URL into your MCP client" work: the client
POSTs to `/oauth/register` with no credential and gets a `client_id` back. The cost is that
anyone on the internet can do the same, and the `client_name` they supply is the text your users
read on the consent screen. That is the setup for consent phishing: register a client called
something reassuring, send a signed-in user the authorize link, and a single "Allow access" hands
over an access token with that user's full CRM permissions.

Three things reduce that risk out of the box. The consent screen presents the name as
self-reported rather than in the product's own voice and shows the host the grant will be sent
to; registration is rate limited per address; and the app refuses to be framed, so the consent
screen cannot be clickjacked.

Once you have connected the clients you need, close the door:

```dotenv
OAUTH_REGISTRATION=disabled
```

Existing clients and their grants keep working. `/oauth/register` returns 404 and
`registration_endpoint` disappears from `/.well-known/oauth-authorization-server`, so discovery
reflects the policy instead of pointing clients at a dead endpoint. Set it back to `open`
temporarily when you need to onboard another client.

Registered redirect URIs must be `https`, `http` on a loopback address (RFC 8252 for native
apps), or a private-use scheme such as `vscode://`. Plain `http` to a remote host is refused,
as are `javascript:`, `data:`, `file:` and similar.

## Connect a client

The remote MCP endpoint is:

```text
https://<domain>/api/mcp
```

Signed-in users can find this URL under Settings > Connected apps > AI clients. The setup panel includes ChatGPT, Claude and generic MCP instructions with a copy button. The directory remains visible when `MCP_ENABLED=false` and explains that an administrator must enable the server first.

The local preview does not expose an internet endpoint. Cloud-hosted clients need a reachable HTTPS deployment before they can connect. See [Connections and client packages](integrations.md) for package generation and provider setup, and the [platform plan](integration-platform-plan.md) for the remaining work.

Warpdrive supports stateless MCP 2026-07-28 requests and 2025-era Streamable HTTP at the same endpoint, plus OAuth discovery, dynamic client registration, authorization code flow, and PKCE with S256. Each request authenticates its bearer token and uses that user's current permissions. The older HTTP+SSE transport is not served.

To connect from Claude or Claude Desktop:

1. Open Settings, then Connectors.
2. Select Add custom connector. Team and Enterprise owners may need to add it under Organization connectors first.
3. Enter a name such as `Warpdrive` and the endpoint URL above.
4. Select Connect, sign in to Warpdrive, review the consent screen, and approve access.
5. Enable the Warpdrive tools you want to use from Search and tools in a conversation.

Remote connectors are added through Settings in Claude Desktop, not through `claude_desktop_config.json`. See Anthropic's [custom connector guide](https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp) for current client controls.

Other MCP clients can use the same endpoint when they support remote Streamable HTTP servers and OAuth.

### Resource and issuer profile

Include exactly one nonempty `resource` in the authorization request and in every token
request, including refresh. Use the `resource` advertised by
`/.well-known/oauth-protected-resource`, for example:

```text
resource=https://crm.example.com/api/mcp
```

Authorization query parameters, token form fields and token JSON members follow the same
rule. Missing, repeated or foreign resources receive HTTP 400 with `invalid_target` before
grant lookup or mutation. Repeating an identical resource is also rejected. JSON compatibility
is retained, including detection of duplicate member names written with Unicode escapes.
Other malformed input receives `invalid_request`; unusable credentials for a valid target
receive `invalid_grant`.

Warpdrive supports one MCP resource. Its audience is the configured `BASE_URL`, with one
trailing slash removed, followed by `/api/mcp`. Resource matching permits scheme and host
case differences while preserving the port and path bytes, path case and trailing slash.
Query strings, fragments, user information, raw whitespace or controls, backslashes and
normalizing dot segments are rejected. The configured issuer is `BASE_URL` literally,
including a trailing slash when configured; discovery and signed tokens use that same issuer.

Validated authorization callbacks for approval and denial include exactly one `iss` equal to
this literal issuer. Authorization-server metadata advertises
`authorization_response_iss_parameter_supported: true`. Before exchanging a returned code,
clients must compare the decoded `iss` string with the issuer recorded from discovery and
reject a missing or different value. Do not normalize scheme, host, port, escaping or a
trailing slash for this comparison.

The MCP profile requires a valid HTTPS `BASE_URL` without a query, fragment or user information.
An invalid profile hides the MCP endpoint in Settings and makes MCP discovery, registration
and protocol entry points unavailable. This profile does not change other applications'
URL validation. Keep `BASE_URL` stable: opaque codes and refresh grants do not store a
historical resource binding across configuration changes. Plan a separate migration and
fresh consent when changing the public identity.

The strict single-resource and missing-resource rejection rules are Warpdrive compatibility
policy. Older clients that omit `resource`, including on refresh, must update their requests.
[RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) permits multiple resource indicators;
Warpdrive deliberately accepts one. See the targeted
[MCP authorization profile](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
This policy does not add per-client scopes or make existing grants read-only.

## Tools

Read tools:

- `search`
- `list_deals`, `get_deal`
- `list_leads`, `get_lead`
- `list_persons`, `get_person`
- `list_organizations`, `get_organization`
- `list_activities`, `get_activity`
- `list_pipelines`, `get_pipeline`
- `pipeline_summary`
- `list_emails`, `get_email`, `list_email_drafts`

Write tools:

- `create_deal`, `update_deal`, `move_deal_stage`
- `create_lead`, `update_lead`, `convert_lead_to_deal`
- `archive_lead` (use `archived: false` to restore a lead)
- `create_person`, `update_person`
- `create_organization`, `update_organization`
- `create_activity`, `update_activity`, `complete_activity`
- `add_note`
- `create_email_draft`, `update_email_draft`, `delete_email_draft`

## Permissions and safety

MCP acts as the user who completed OAuth. Existing Warpdrive visibility rules and permission flags apply to every tool call. A user who cannot see a record cannot read it through MCP, and a user without a required edit or create permission receives the same denial through MCP.

Access tokens are bound to the configured `/api/mcp` resource audience. Tool responses include structured data alongside a text fallback, and tools advertise read-only or destructive hints where appropriate. These hints help clients present actions; they do not replace authorization. Separate per-client read/write scopes remain planned.

Review write-tool requests in the client before approving them. The only delete tool removes the authenticated user's own unsent email draft.

## Revoke a connection

In Warpdrive, open Settings, then Connected apps. Select Revoke beside a client to revoke all of its access and refresh tokens for your account. The client must complete OAuth again before it can use Warpdrive.

A connection remains listed while it has a valid refresh token, even after its short-lived access token expires, so the user can still revoke it.

You can also remove the connector configuration from the client's Connectors settings.
