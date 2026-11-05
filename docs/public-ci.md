# Public Bun CI

This fork owns [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Pushes to `main`,
ordinary pull requests and manual runs perform the light setup and static checks needed for
fast feedback. These contexts are merge/setup evidence; they are not full unit, PostgreSQL,
browser, build, release, deployment or customer acceptance.

| Job            | Checks                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CRM            | Frozen install, route/message type generation and typecheck, translation audit/lint, focused workflow/preference contract tests |
| Marketing site | Frozen install, route type generation and typecheck                                                                             |
| Documentation  | Frozen install, dependency contract check and typecheck                                                                         |

The full commands remain in [`full-ci.yml`](../.github/workflows/full-ci.yml). That workflow
has no ordinary push trigger; it runs for an explicit dispatch or when its own definition is
changed in a pull request. Its jobs are `CRM full checks`, `Marketing site full checks` and
`Documentation site full checks`, and retain the full unit, PostgreSQL, build and worker/site
coverage.

The CRM `typecheck` script runs Next type generation before TypeScript. It precedes lint so a
clean checkout has the route and message declarations needed by type-aware rules. Independent
packages use their own directories, lockfiles and actual package scripts; the documentation
package does not currently provide a test script.

The full CRM integration suite starts disposable PostgreSQL through Testcontainers on the
hosted runner's Docker daemon. The light workflow does not start PostgreSQL. Fixture databases
are reclaimed after closing without forcing live external listeners off their connections.
Production databases and credentials are not used.

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

`ciWorkflow.test.ts` parses the real YAML with Bun's built-in parser and validates the light
and full workflow command, environment and permission contracts. `Dockerfile.test.ts` independently retains
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

Local workflow contracts do not prove a GitHub Actions run succeeded. Inspect the actual light
run after pushing, and dispatch the full workflows for the selected `main` revision before a
release gate. Real PostgreSQL integration tests, Docker runtime, service health, external
OAuth/Gmail and complete English/Farsi browser acceptance remain separate checks; a light
result does not establish those outcomes.
