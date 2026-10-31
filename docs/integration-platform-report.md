# Integration platform local preview

Status: local foundation preview, 2026-10-31. No public deployment, live Slack installation,
ChatGPT/Claude cloud connection, provider approval or marketplace publication was performed.

## Delivered behavior

- Connected apps now has a searchable directory, category filters, My connections,
  AI client setup and an explicitly planned app marketplace. Existing Gmail controls and
  authorized MCP clients remain available.
- English, Farsi and German cover the new screens, setup instructions and connection states.
  Persian search accepts common Arabic letter variants and spacing differences.
- Slack has administrative setup guidance, an OAuth installation flow, public channel
  selection, connection testing and disconnect/revocation retry. Tokens are encrypted;
  single-use state is bound to the initiating user and session. No Slack message history is
  requested. Alerts and inbound Slack actions are not yet implemented.
- MCP responses include structured results and tool hints. OAuth tokens validate the MCP
  resource audience; refreshable grants remain visible for revocation.
- A package builder creates independent ChatGPT and Claude client packages from a real
  HTTPS deployment origin. Workflow skills cover meeting preparation, pipeline review and
  unsent email drafts, including Farsi/German and date/timezone instructions.
- Mobbin research informed directory, provider details and connection flows while preserving
  the application's existing settings shell. References are in
  [the UI research notes](integration-ui-research.md); no Mobbin assets are redistributed.

## Verification

The final worktree is based on auth merge `8539fe8`. Its source tree is identical to tested
auth commit `4a0df8c758d38cdb0333a1bb26d87ea082d88964`; only the merge history changed.
Dependencies and the lockfile remain unchanged. The production build and integration tests
used the declared Bun 1.4.4 runtime.

| Check                                       | Result                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Next.js production build, Webpack           | Passed, including generated page type validation                         |
| Focused unit tests                          | 38 passed in 9 files                                                     |
| PostgreSQL, MCP and OAuth integration tests | 41 passed in 13 files                                                    |
| TypeScript check                            | Passed                                                                   |
| i18n catalog/source audit                   | No catalog issues or new source findings; 6 existing reviewed exceptions |
| ESLint                                      | Passed                                                                   |
| Biome                                       | Passed with existing repository warnings                                 |
| Client package CLI                          | Generated both package layouts with a validation-only `.invalid` host    |

The local MCP endpoint rejects anonymous requests with 401. Discovery names the correct
resource, and the preview listener binds only to `127.0.0.1`.

Database tests used disposable PostgreSQL containers. Slack HTTP responses were synthetic;
they do not establish a successful installation into a real provider workspace. Regression
coverage includes OAuth replay/session binding, encrypted credentials, loss of administrative
authority, upstream revocation failure, resource audience rejection, refresh-token visibility,
Persian search and callback status spoof prevention.

The directory was visually inspected in German. Browser input was paused after the user
changed Chrome state. Final Farsi RTL, narrow-screen and assistive-technology visual review
remain open; automated localized UI tests do not establish those outcomes.

## Run the isolated local preview

The local preview uses an isolated checkout and PostgreSQL database, preserving the parent
auth checkout. Private configuration is outside Git. It binds to loopback only:

- URL: `http://localhost:3150/settings/connections`
- Worktree: `/tmp/warpdrive-integrations-preview-20261031`
- Branch: `codex/integration-platform-preview`
- Preview configuration: `/tmp/warpdrive-integrations-preview.env`
- Preview database: `warpdrive_integrations_preview_v2_20261031`

From that worktree:

```sh
bun x --bun bun@1.4.4 \
  --env-file /tmp/warpdrive-integrations-preview.env \
  --bun node_modules/next/dist/bin/next dev --webpack \
  --hostname 127.0.0.1 --port 3150
```

The private runtime configuration and database are local disposable resources. Do not publish
them or the database dump. Restore the source bundle to a durable checkout before deleting
temporary worktrees; the preview worktree's Git metadata depends on another temporary clone.
WebSocket/background-worker behavior outside the connections feature was not qualified here.

## Remaining delivery gates

The [platform plan](integration-platform-plan.md) records the provider inventory, priority
and explicit implementation status. These are material remaining items:

- Real HTTPS deployment and live ChatGPT, Claude and Slack installation verification, when
  requested. Localhost is not reachable by their cloud services.
- Fine-grained MCP client scopes, broader MCP capability coverage and embedded app UI.
- Slack token rotation, signed inbound actions, workflow alerts and durable revocation jobs.
- Google/Microsoft calendar and mail, conferencing, automation and other planned connectors.
- A common provider SDK, job/retry framework, public API/webhooks and extension isolation.
- Marketplace install/update/uninstall, publisher review, permission changes and public/private
  distribution. The marketplace screen is a roadmap preview, not an operational store.

Twenty CRM parity is the programme target, not the completion status of this preview.
