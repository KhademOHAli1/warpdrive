# Repository security maintenance

## Reporting and ownership

The maintainer is [@KhademOHAli1](https://github.com/KhademOHAli1). Suspected vulnerabilities
go through [private vulnerability reporting](https://github.com/KhademOHAli1/warpdrive/security/advisories/new).
Follow [SECURITY.md](../SECURITY.md); keep exploit details and sensitive evidence private.
The repository has no promised response SLA or blanket support commitment for old versions.

## Configured controls

- **CodeQL default setup:** extended queries for JavaScript/TypeScript and GitHub Actions,
  using standard GitHub-hosted runners. GitHub manages the workflow. Keep one CodeQL
  configuration; adding an advanced workflow requires an intentional setup change.
- **Dependabot:** dependency alerts and security updates are enabled. The configuration
  groups security fixes for each Bun package and limits routine Actions updates to one
  grouped monthly request. Bun version-update requests are disabled; security requests
  continue independently of that limit.
- **Secret scanning and push protection:** enabled for supported provider patterns.
- **Actions access:** the default token is read-only, workflows cannot approve pull
  requests, and first-time external contributors require approval before their runs.
- **Main history:** deletion and force pushes are blocked. The existing integration
  workflow continues to control normal publication and its CI checks.

The dependency-review workflow checks incoming pull requests for newly introduced high
or critical known vulnerabilities. It uses pinned actions, read-only permissions and no
pull-request comments or package-install scripts. It becomes active when its file lands
on the default branch; a local file alone does not activate a workflow or Dependabot config.

The separate Bun audit workflow reads each app's committed lockfile, covering dependency
versions that GitHub's manifest graph may miss. It checks dependency changes, runs weekly
and supports manual dispatch. It uses each package's pinned Bun without installing
dependencies or running lifecycle scripts. Registry failures fail the check; an incomplete
audit is not a clean result. Inspect the full lockfile report before dismissing a finding.

Default CodeQL setup starts a validation scan when enabled. Pushes and pull requests
subsequently trigger scans, and scheduled scans apply according to GitHub's activity rules.
Check the analysis result and language coverage before treating setup as operational.

## Routine triage

Review [Code scanning](https://github.com/KhademOHAli1/warpdrive/security/code-scanning),
[Dependabot](https://github.com/KhademOHAli1/warpdrive/security/dependabot) and
[Secret scanning](https://github.com/KhademOHAli1/warpdrive/security/secret-scanning)
after notifications and before a release. Check periodically for failed or missing analyses.

1. Establish affected revisions, reachable behavior and impact with sanitized evidence.
2. For a leaked credential, revoke or rotate it promptly. Removing text from Git does
   not invalidate a credential already exposed.
3. Patch on the declared package manager and keep its lockfile coherent. Review bot
   requests and run the relevant checks before merging; never auto-merge solely because
   a tool calls an update safe.
4. Record the reason and evidence for a false positive or accepted risk in the alert.
   Give temporary exceptions a review date and responsible maintainer.
5. Use private advisories for coordinated disclosure. Release notes should identify
   the fixed version and useful remediation without publishing active exploit details.

CodeQL covers the configured languages and modeled patterns. Database authorization,
provider behavior, deployment configuration and recovery still need their own reviews
and tests. Generic-secret detection and token-validity checks have separate GitHub
availability requirements and were not enabled by this setup.

## References

- [GitHub default CodeQL setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning)
- [Dependabot security updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates)
- [Bun support in Dependabot](https://docs.github.com/en/enterprise-cloud@latest/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories#bun)
- [Bun lockfile audit](https://bun.sh/docs/pm/cli/audit)
