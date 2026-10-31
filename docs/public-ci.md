# Public Bun CI

This fork owns [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Branch pushes,
ordinary pull requests and manual runs check all three packages on hosted Ubuntu runners.

| Job            | Checks                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRM            | Frozen install, route/message type generation and typecheck, translation audit/lint, unit tests, real PostgreSQL integration tests, Next production build, server-entrypoint build |
| Marketing site | Frozen install, route type generation, typecheck, tests, static build                                                                                                              |
| Documentation  | Frozen install, typecheck, Docusaurus build                                                                                                                                        |

The CRM `typecheck` script runs Next type generation before TypeScript. It precedes lint so a
clean checkout has the route and message declarations needed by type-aware rules. Independent
packages use their own directories, lockfiles and actual package scripts; the documentation
package does not currently provide a test script.

The CRM integration suite starts disposable PostgreSQL through Testcontainers on the hosted
runner's Docker daemon. Fixture databases are reclaimed after closing without forcing live
external listeners off their connections. Production databases and credentials are not used.

## Bun and action versions

Each setup step reads its package's `packageManager` through `bun-version-file`. Bun's version
therefore stays tied to the checked-in package configuration rather than a floating `latest`.

The official action tags and metadata were reviewed on 2026-10-29, then pinned to full commits:

- [actions/checkout v7](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1),
  `3d3c42e5aac5ba805825da76410c181273ba90b1`.
- [oven-sh/setup-bun v2](https://github.com/oven-sh/setup-bun/tree/0c5077e51419868618aeaa5fe8019c62421857d6),
  `0c5077e51419868618aeaa5fe8019c62421857d6`. Its
  [version-file documentation](https://github.com/oven-sh/setup-bun/blob/0c5077e51419868618aeaa5fe8019c62421857d6/README.md)
  describes package-based version selection.

The workflow grants only `contents: read` and disables persisted checkout credentials. Its
jobs compile and test source; they do not publish packages/images, deploy services, create
releases or receive production credentials.

## Build configuration and metadata

The CRM build validates server configuration while importing modules. That step alone receives
schema-valid CI placeholders: loopback service URLs, `.invalid` identity domains and public dummy
keys. They do not configure a running service. `APP_COMMIT` receives the checked-out event's
`github.sha`; application/runtime deployment configuration remains an operator responsibility.
Build outputs with these verification URLs are not production release artifacts.

`ciWorkflow.test.ts` parses the real YAML with Bun's built-in parser and validates the public
job, command, environment and permission contracts. `Dockerfile.test.ts` independently retains
the build-stage stamp, runtime-stage stamp and cache-order checks. A missing public workflow
fails its tests. No workflow test is silently skipped.

## Upstream private deployment boundary

The original public release (`624f623`) already omitted `.github/workflows/deploy.yml`. Its
remaining `deployWorkflow.test.ts` referred to private deployment infrastructure and PNPM
commands that this public checkout could not execute. That file is replaced by the public CI
contract tests, and the Dockerfile tests no longer import an absent private workflow.

The following private assertions are retired from this public gate and remain unverified
requirements for any future deployment pipeline:

- Build/publish a commit-addressed image on main; gate tag/manual deployment and promote the
  previously checked artifact rather than rebuilding it.
- Verify an image manifest before deployment, serialize production deployments and supply each
  remote Compose session with its required image reference.
- Fail on unhealthy deployed containers and remove old unused images according to an explicit
  retention policy.
- Run the upstream OSS export/publish guard. Its `test:oss` script and policy are absent here;
  the translation audit is not a replacement for that publication policy.

There is no invented private deployment workflow or replacement production host. A future
release/deployment feature needs its own reviewed workflow and acceptance evidence.

## Verification boundary

Local workflow contracts do not prove a GitHub Actions run succeeded. Inspect the actual run
after pushing, including all three jobs. Real PostgreSQL integration tests, Docker runtime,
service health, external OAuth/Gmail and complete English/Farsi browser acceptance remain
separate checks; this compilation/unit-test gate does not establish those outcomes.
