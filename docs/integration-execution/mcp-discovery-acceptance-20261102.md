# MCP discovery acceptance, 2 November 2026

AISEC-010 is accepted for its local compatibility criterion at source
[`fc5fae837b4b8e532a8bfd89ff303e941bcf1439`](https://github.com/KhademOHAli1/warpdrive/commit/fc5fae837b4b8e532a8bfd89ff303e941bcf1439).
The unchanged acceptance is: "Pin the targeted specification and test protected-resource
metadata and authorization-server discovery." Verification remains compatibility tests,
stage local, with ARCH as the local-foundation package and AISEC-001 as the task dependency.
This admission changes only AISEC-010: **43 completed / 403 planned / 446 total**, across
23 packages. The [historical task register](tasks.csv) retains this dated closure record. Live execution
continues through the [roadmap index](../../ROADMAP.md) and the
[central Warpdrive Project](https://github.com/users/KhademOHAli1/projects/3); original plan
rows retain the starting snapshot.

## Pinned target and implemented profile

The accepted [ARCH-008 protocol review](architecture-clients-runtime-release.md#arch-008-public-clients-and-identity)
records successful retrieval of the
[MCP authorization revision dated 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
on 31 October 2026. That dated review, rather than a moving `latest` page or package version,
provides this task's specification pin. Its reviewed discovery requirements are implemented
and tested for the single configured public HTTPS MCP profile below. This record performs
no new public-specification retrieval and makes no claim of whole-specification conformance.

The [adopted resource and issuer policy](https://github.com/KhademOHAli1/warpdrive/blob/fc5fae837b4b8e532a8bfd89ff303e941bcf1439/docs/mcp-server.md#resource-and-issuer-profile)
uses issuer `I = BASE_URL` literally, including its configured trailing slash. Its protected
resource `R` removes one trailing slash from `BASE_URL` and appends `/api/mcp`.
Authorization-server metadata retains `I`; protected-resource metadata advertises exactly
`R` and `authorization_servers: [I]`. Endpoint construction removes the final slash before
appending OAuth paths. Keep the configured public identity stable: opaque codes and refresh
grants do not preserve a historical target across configuration changes. Changing that
identity requires a separate migration and fresh consent.

The local profile requires valid HTTPS configuration without query, fragment or user
information. Discovery and registration refuse an invalid profile, and the MCP kill switch
keeps these surfaces unavailable. Registration `open` advertises the registration endpoint;
`disabled` omits it. This tests retained DCR discovery policy, not CIMD, verified publisher
identity or every registration behavior.

## Direct compatibility evidence

The source definitions at the admitted cut are:

- [metadata.test.ts](https://github.com/KhademOHAli1/warpdrive/blob/fc5fae837b4b8e532a8bfd89ff303e941bcf1439/src/features/oauth/metadata.test.ts): **4 builder cases**.
  They check authorization-server issuer/endpoints, S256 and grant declarations,
  protected-resource metadata, and DCR endpoint omission/advertisement.
- [resourceDiscovery.test.ts](https://github.com/KhademOHAli1/warpdrive/blob/fc5fae837b4b8e532a8bfd89ff303e941bcf1439/src/features/oauth/resourceDiscovery.test.ts):
  **16 route/profile cases**. Four valid cases combine two literal issuer slash forms
  with registration open/disabled and compare both discovery responses exactly, including
  response types, grants, S256 and token authentication methods. Nine cases combine three
  invalid profiles (HTTP, query and user information) with the two discovery routes and
  registration, expecting 404 without reflecting the invalid URL. Three cases verify the
  MCP-disabled response at those same boundaries.

These are **20 direct discovery/guard compatibility cases**. They are included in the
supporting **115-case subset** (resource 85, metadata 4, endpoint 10, discovery 16), itself
part of the actual 174-pass composed unit run. Neither 20 nor 115 was a separate invocation;
none of these nested counts is added to the hosted CI totals below. The four relevant
supporting test-file hashes match that composed-run receipt. The earlier source-only
supporting packet did not close this task before Main adoption and exact-source CI.

The implementation seams are
[metadata builders](https://github.com/KhademOHAli1/warpdrive/blob/fc5fae837b4b8e532a8bfd89ff303e941bcf1439/src/features/oauth/metadata.ts),
[authorization-server discovery](https://github.com/KhademOHAli1/warpdrive/blob/fc5fae837b4b8e532a8bfd89ff303e941bcf1439/src/app/.well-known/oauth-authorization-server/route.ts),
[protected-resource discovery](https://github.com/KhademOHAli1/warpdrive/blob/fc5fae837b4b8e532a8bfd89ff303e941bcf1439/src/app/.well-known/oauth-protected-resource/route.ts),
and the shared [MCP resource/profile helper](https://github.com/KhademOHAli1/warpdrive/blob/fc5fae837b4b8e532a8bfd89ff303e941bcf1439/src/features/oauth/resource.ts).
The HTTPS guard remains within MCP surfaces; it does not redefine global login/provider URL
configuration or user language, numbering, calendar and timezone preferences.

## Exact-source qualification and preserved history

Main committed a 39-path increment at the source above: the 38 selected source/documentation
paths plus its reconciled canonical privacy inventory report. The shared constants and
privacy review companions preserve newer Main entries; the landing-only ingress comment/
loop amendment is authoritative over the frozen original packet. The original native
receipt remains bound to its original source and is not rewritten as a replay at the
amended landing source.

[Public Bun CI run 41363129846](https://github.com/KhademOHAli1/warpdrive/actions/runs/41363129846),
at that exact commit, completed **SUCCESS** on attempt 1. Main's read-only exact-head watcher
recorded **8,657 unit passes with 3 skipped cases**, and **3,066 PostgreSQL integration passes
across 641 files**, including the 52 resource cases (HTTP 31, services 21). Configured types
and lint, the application build, all five worker bundles, marketing and docs checks passed.
The application build generated 67 static pages. Skipped cases receive no execution credit.
These whole-run counts include focused cases and are not added to them.

The retained CI receipt was recorded on 2 November 2026; exact public-main success was
verified at `2026-11-01T23:58:44Z`. Its SHA-256 is
`9cc3f5e4b7643bb6338fc322b78206ac8c3e7ae946ac2e16daee379df078e974`. The supporting programme packet retains a byte-exact copy
of that receipt, the composed unit receipt/log, Main's final local compiler/lint/inventory
receipt and the original native result/cleanup receipts. This record relies on Main's
actual CI watcher evidence; its documentation preparer did not independently query GitHub
or execute another test, compiler, lint, scanner or service campaign.

The original native selection passed **52/52** in 8.461 seconds, with actual cleanup at
`2026-11-01T23:28:37.424998Z`, 19.400 seconds total. All three foreign baseline containers
and 37 source hashes were preserved, with no forced removal or retry. Its first process
sample missed the short running group, so it establishes no live or peak aggregate RSS.
Earlier 34-RED/18-pass native evidence and the later private 202-pass/2-registry-RED unit
invocation remain historical. A separate 30-case registry repair passed; no single private
204-pass result is inferred from those two invocations. Main's coalesced focused result
and exact hosted CI are distinct later evidence.

## Closure boundary and remaining work

This closes only the pinned local discovery review and compatibility criterion in
AISEC-010. It establishes no external client, provider, installed deployment, browser
journey, public-client certification or supported release. It does not close CIMD, scopes,
read-only enforcement, migration of broad grants or the full AISEC-016 lifecycle.

AISEC-009 remains planned: accepted ARCH-008 requires issuer identification in authorization
responses and advertisement only after positive/negative conformance tests. That explicit
follow-up is not waived by discovery compatibility or the current green CI. Every other
register row, criterion, dependency and stage is preserved. The programme remains 446 tasks;
the 586-task planning amendment remains unimported.
