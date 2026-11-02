# MCP security operations

[فارسی](mcp-security-operations.fa.md) · [Deutsch](mcp-security-operations.de.md) · [English](mcp-security-operations.md)

For self-hosters and client developers. Source profile described on 2 November 2026:
this source implements the single-resource policy, per-user/client revocation,
authorization-response `iss` support and refresh-token-family replay containment.
The earlier qualified Main `09288d518fd574fd069fb6a1dc670596f71a8831` already includes
the first three; the refresh-family increment has its own bounded local qualification record.
Check the installed version against its own release evidence. This guide does not establish
installed behavior.
Start with [MCP setup and tools](mcp-server.md) and the installed version's release evidence.

## Supported identity and compatibility profile

Keep `BASE_URL` stable and HTTPS, without user information, a query or a fragment.
The issuer is the literal configured value, including a configured trailing slash.
The one resource/audience is `BASE_URL` with one trailing slash removed, plus `/api/mcp`.
Read its value from `/.well-known/oauth-protected-resource`; discover the authorization
server at `/.well-known/oauth-authorization-server`.

Send exactly one nonempty `resource` in authorization, code exchange and refresh requests.
Missing, repeated (even identical) or foreign targets receive `invalid_target` before
credential lookup or mutation. Other malformed requests receive `invalid_request`;
unusable credentials for a valid target receive `invalid_grant`.
Single-resource rejection is Warpdrive policy: [RFC 8707 section 2](https://www.rfc-editor.org/rfc/rfc8707.html#section-2)
permits multiple indicators. Older clients omitting `resource` must update.
Resource scheme/host case differences are permitted; port/path bytes and trailing slash
remain significant. Issuer spelling stays literal. Codes and opaque refresh grants do not
retain a historical target across `BASE_URL` changes. Changing public identity requires a
separately reviewed migration and fresh consent; editing the URL is not that migration.

Local SDK fixtures exercise stateless MCP 2026-07-28 and 2025-era Streamable HTTP at
the same endpoint. Older HTTP+SSE is not served; named external-client versions are unqualified.

## Current broad-grant ceiling

Credentials are bound to a user and client. Approved granular capabilities, installation
roles and a read-only grant ceiling are not delivered. Passing `scope=read`, hiding tools
in a client, or reading a tool's `readOnlyHint` does not constrain the server grant.
Existing grants must never be described as silently migrated to read-only.

The [operation inventory](integration-execution/mcp-operation-inventory.md) and its
[CSV](integration-execution/mcp-operation-inventory.csv) record actual domain checks and
gaps, including lead edits, draft links, linked projections and indirect reminder effects.
Mutations can trigger existing jobs/notifications; derived-outbound approval is not implemented.
Token/actor checking per request does not prove fresh authority at every later effect.
Full permission-intersection, read-only and authorization-matrix work remains open
(AISEC-006, AISEC-008, AISEC-023). Enable broad MCP access only with this ceiling understood.

## Codes, refresh and client handling

Registration accepts HTTPS, HTTP loopback and private-use callback schemes; remote HTTP is refused.
Use the exact registered redirect URI and S256 PKCE. Generate a fresh high-entropy verifier
for each authorization; retain it securely until exchange. The S256 transform is specified
in [RFC 7636 section 4.2](https://www.rfc-editor.org/rfc/rfc7636.html#section-4.2).
Bind returned `state` to the saved authorization transaction before using the code
([RFC 6749 section 10.12](https://www.rfc-editor.org/rfc/rfc6749.html#section-10.12)).
Before authorization, record the issuer from validated authorization-server metadata with
the PKCE/state transaction. Compare any returned, decoded `iss` literally with that record.
If metadata advertises issuer-response support, reject a missing `iss` too. This source
advertises that support and returns one configured literal `iss` on validated success and
denial responses. Compatibility with older, unadvertised servers is a separate client case;
do not apply that exception to this source. Check success and error responses
before using a code or acting on error contents, and do not normalize the issuer;
see [the pinned MCP authorization profile](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
Warpdrive codes expire after 60 seconds and are one-use. Approval uses the existing signed-in
session and fresh-verification policy; MCP does not provide a parallel sign-in system.

Access tokens expire after one hour. A newly issued refresh token expires after 30 days;
successful rotation consumes the old refresh token and returns a replacement token pair.
The replacement receives its own expiry. This is not a fixed overall family lifetime.
Serialize refresh per stored token and persist the replacement pair safely. A lost response
can leave an uncertain outcome; do not blindly replay the old token. On `invalid_grant`,
stop automatic replay and obtain fresh authorization after reviewing the connection.
Replaying a consumed refresh grant validates its descendant chain and revokes active
refresh tokens in that same user/client chain. The denial commits that containment;
already-revoked timestamps and independent grant chains remain unchanged. Incomplete,
cyclic or cross-user/client chains are rejected without a partial sweep. This source does
not revoke already-issued access tokens by refresh family; their expiry and the existing
per-user/client Revoke control remain separate.
Do not log bearer tokens, refresh tokens, authorization codes or PKCE verifiers.

## Choose the correct control

Schema defaults are MCP enabled and registration open; inspect loaded deployment config.
Apply config through the deployment's existing mechanism and restart the serving app
processes as required. Editing a config file alone does not change an already running app.

| Control                                         | Actual effect                                                                                                                 | Retained authority                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `OAUTH_REGISTRATION=disabled`                   | `/oauth/register` returns 404; discovery omits `registration_endpoint`.                                                       | Existing registered clients can authorize and existing grants can exchange/refresh.                     |
| `MCP_ENABLED=false`                             | MCP and OAuth protocol endpoints, including discovery, return 404.                                                            | Stored codes/tokens are retained; this is not database revocation or proof that in-flight work stopped. |
| Settings > Connected apps > AI clients > Revoke | Confirmed action revokes that user's access/refresh tokens for the selected client and consumes its pending codes atomically. | Other users and clients retain their grants.                                                            |

The Connected apps page remains available when MCP is off. Its list includes refreshable
connections after access-token expiry, but is not every registered client or pending-code-only
authorization. The displayed client name is self-reported, not verified publisher identity.
Removing a connector from an external client is not evidence of server-side revocation.
If Revoke reports an error, keep the outcome unresolved, refresh the page and investigate or
retry the existing action. Record confirmation and scope rather than assuming success.

| Symptom                      | Safe checks                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 404                          | Requested route, loaded MCP switch, registration policy; HTTPS profile if discovery/MCP is unavailable.           |
| `invalid_target`             | Exactly one advertised resource on authorization and every exchange, including refresh.                           |
| `invalid_request`            | Request structure, content type and required parameters.                                                          |
| `invalid_grant`              | Expired/used code, redirect/client/PKCE binding, or invalid/expired/revoked refresh; review before fresh consent. |
| Bearer authentication denial | Access expiry/revocation, loaded signing key, literal issuer/audience and active user.                            |

## Signing-key maintenance

Access tokens use HS256. Keep `OAUTH_SIGNING_KEY` secret and stable across ordinary restarts.
It is read at module/process initialization, with no hot keyring or overlapping key-ID scheme.
The key must decode to 32 bytes; it is neither a client secret nor the provider encryption key.
The existing `_FILE` secret mechanism is described in [MCP setup](mcp-server.md).
For suspected key exposure, replace the key through that mechanism and restart every serving
app instance consistently. Once all use the replacement, old signatures no longer verify.
Opaque refresh grants are separate database records: key replacement does not revoke them,
and surviving grants can mint access tokens signed by the new key. Pending opaque codes are
also not invalidated by replacing the signing key. Keep a compromised old key out of service.

## Incident containment with existing controls

1. Record the affected deployment/version, UTC times, users and client IDs through the
   existing incident process. Preserve useful error/status evidence without copying secrets.
2. Set `MCP_ENABLED=false` and `OAUTH_REGISTRATION=disabled` through the existing deployment
   mechanism. Verify each serving app instance loads those settings and the same previously
   verified protocol URLs return 404. A wrong route or one disabled instance does not prove
   workspace-wide containment; neither does this delete grants or stop admitted work.
3. Have each affected user sign in to Warpdrive, open Settings > Connected apps > AI clients,
   identify the affected listed client and confirm Revoke. Check the resulting page and
   record which user/client pair was handled. This action remains available with MCP disabled.
4. Replace an exposed signing key as above. Repair the identified cause and review the
   affected client's identity, callback and broad access before allowing new consent.
5. Keep unresolved users, unlisted pending authorizations and unknown exposure explicit.
   There is no tested workspace-wide all-user revoke UI/CLI in this MCP procedure.
   If the required grant set cannot be accounted for through supported controls, leave MCP
   disabled pending qualified administrative recovery. This guide supplies no bulk SQL or
   substitute admin command and cannot establish whole-incident recovery.

For a native account/factor incident, follow the separate [authentication operator runbook](auth-operations.md)
under its own ownership-review requirements. It is not a general MCP bulk-revocation command.

## Re-enable and obtain fresh consent

Re-enable only after the cause is addressed, the intended source is qualified and the
necessary revocations are evidenced. Retain the same reviewed issuer/resource identity.
Set `MCP_ENABLED=true`; keep registration disabled unless an approved client actually needs
new registration, then close registration again after that finite onboarding.
Each affected user should revoke the old listed grant before a new authorization flow.
Discard old client-side credentials, use fresh PKCE/state, review the callback and consent,
and verify one authorized nonmutating CRM read. New consent is broad under the ceiling above.
A page showing no listed connection alone does not prove all pending codes were revoked.
Record disabled/reenabled times, confirmed per-user revocations, fresh-consent outcomes and
remaining gaps separately. Source tests, a configuration change or one successful read do
not establish deployment-wide incident closure, browser/provider acceptance or full RFC conformance.
