# Connections and client packages

Settings > Connected apps now brings together discovery, existing Gmail controls,
authorized AI clients and the Slack workspace connection flow. Farsi, German and English
catalogs cover setup, states, dialogs and failures. Planned providers are explicitly marked.

## Slack server setup

1. Create an app in [Slack app settings](https://api.slack.com/apps).
2. Under OAuth & Permissions, allow `<BASE_URL>/api/integrations/slack/callback`, using
   the actual configured public HTTPS base URL.
3. Add bot scopes `chat:write` and `channels:read`. This release requests public channel
   names and posting to channels the bot has joined. It requests no message history.
4. Set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` in the server configuration.
   `SLACK_CLIENT_SECRET_FILE` supports Docker secret files. Restart the application.
5. Keep Slack token rotation disabled for this initial connector. Rotation/refresh support
   is a separate task; this connector must not be published as supporting rotating tokens.
6. As an administrator with a fresh authenticated session, open Slack in the directory,
   connect, choose a public channel the app has joined, save it, and test the connection.

The current connector installs a workspace connection, stores its bot token encrypted,
validates channel selection server-side and tests access using Slack `auth.test`.
Choosing a channel does not automatically enable deal alerts. Signed Slack message actions,
record alerts, scheduling, rules and broader workflow delivery remain in the backlog.

Disconnect blocks ordinary local token use before remote revocation. If Slack is unavailable,
the connection displays a pending-revocation state with a retry control. The encrypted token
is retained solely to finish revocation; normal credential consumers reject that state.

OAuth attempts store a random state's hash, expire after ten minutes, bind to the initiating
CRM user and session, and can be consumed once. Replayed/wrong-session attempts never exchange
credentials. Administrative authority is checked again after the provider response.

This preview has not installed an app into a real Slack workspace. Local qualification uses
real PostgreSQL plus synthetic upstream HTTP responses. The live provider gate remains open.

## Generate client packages

For a real deployment, generate independent client packages with a public HTTPS origin:

```sh
bun scripts/build-client-plugins.mjs \
  --base-url=https://crm.example.com \
  --output=/new/output/directory
```

The command refuses an existing output directory. It creates:

- `chatgpt/`: portable Agent Plugins manifest, Streamable HTTP MCP configuration with OAuth,
  and a CRM workflow skill.
- `claude/`: Claude manifest, HTTP MCP configuration and the same workflow skill.

Skills cover meeting preparation, pipeline review and unsent follow-up drafts, with natural
Farsi/German guidance and explicit date/timezone handling. They never embed credentials.
Directory publication, rich MCP UI, platform review and installation verification are separate
tasks. Do not label a generated package as publicly listed or provider-approved.

For local preview, use the application's setup explanations and tests. No public endpoint,
network tunnel, live provider grant or plugin publication is created automatically.

Primary references:

- [OpenAI packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI authentication](https://developers.openai.com/plugins/build/auth)
- [Claude manifests](https://code.claude.com/docs/en/plugins-reference)
- [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Slack OAuth](https://api.slack.com/authentication/oauth-v2)
