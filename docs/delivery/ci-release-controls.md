# CI and controlled releases

The next customer feature release is planned as **1.5.0**. The source package remains at
1.4.0 until a reviewed product release PR supplies its matching version, scope and notes.
Merging CI maintenance does not publish a customer version. Publication and deployment
remain explicit, separate decisions.

## Branches and gates

Product feature PRs target `integration`. A release PR brings the selected, validated
product scope from integration to main. Product changes to main require an increasing
stable package version, the matching `docs/delivery/releases/next.json`, a nonempty
registered issue scope and `docs/delivery/releases/VERSION.md` release notes. Notes state
the customer outcome, actual validation, supported boundaries and known limitations.

An automation-only maintenance PR can update `.github/`, `scripts/delivery/`,
`docs/delivery/`, `tests/browser/`, AGENTS.md, ciWorkflow.test.ts, eslint.config.mjs and
.gitignore without declaring a customer release. Application code, root dependencies,
Docker images and site dependencies cannot use this exception. Every proposed commit
still needs canonical issue traceability. A passing PR gate does not grant acceptance.

Main requires PRs and current-base application, delivery-tooling, dependency, workflow,
browser and release-PR checks. Code scanning blocks errors and high/critical security
findings. The current repository has one collaborator: GitHub PR approvals are set to
zero to avoid an impossible self-approval requirement. Independent source review remains
an engineering responsibility; automated agents using the same account do not count as
independent GitHub reviewers. Final publication requires approval in `release-approval`.
Version tags are protected against updates and deletion.

## Dependency findings

`security.yml` audits the root app, marketing site, docs site and independent browser
package using their actual Bun lockfiles. No install scripts run during the audit.
PRs and maintenance pushes compare high/critical advisory identities with a fresh audit
of the base revision. All findings, including pre-existing and lower-severity findings,
are retained as artifacts and summarized. This mode prevents new high/critical findings;
it does not certify existing dependencies as clean.

When package and release-plan versions match, or on scheduled/manual security runs, the
audit is strict: every high/critical finding fails. The existing app/site/docs lockfiles
have known findings; the first customer release remains blocked until those findings are
resolved and its exact CI passes. No advisory is ignored to obtain a green release.

Every selected publication plan must match the next-release version committed at its
selected revision, so an alternate plan filename cannot reuse maintenance-mode audit
success as strict release proof.

The publication gate requires security and browser CI as well as the existing application
and delivery jobs. It verifies the three managed CodeQL analyses and reads blocking
code-scanning results at the selected immutable revision. An analysis job succeeding
does not by itself mean its findings are acceptable.

## Browser evidence

`browser.yml` runs Chromium against an ordinary production Next build over loopback HTTPS
and a disposable PostgreSQL 16 database. Fixture creation refuses non-GitHub execution
or any database except `127.0.0.1/warpdrive_ci`. The fixture user signs in through native
password authentication; no production auth bypass or application test route is added.
The browser package has an independent pinned dependency and frozen Bun lockfile.

The bounded smoke cases exercise persisted deal and Calendar creation, opening and
dismissing mailbox setup without creating a connection, and persisted follow-up draft
creation. They do not accept actual reminder delivery, supported mailbox providers/SMTP
outcomes or durable workflow execution. Full four-journey human acceptance remains a
separate mandatory release gate. There are no retries or silently skipped smoke cases.
Failure screenshots, traces, video and JUnit/HTML reports are retained for 14 days;
all fixture identities and data are synthetic.

## Publication

Use the existing manual `Warpdrive release` workflow. `prepare` validates and creates
review artifacts; `draft` creates the versioned GitHub draft; `publish` rechecks the exact
revision, full scope, CI, human acceptance and artifact identity, and waits for the
`release-approval` environment. Preparation uses a separate environment without approval.
Published versions are immutable. This flow performs no deployment.

Release-candidate suffixes are not currently accepted by the stable publication engine.
Validate candidates on integration/release branches and identify their exact commit SHA.
The eventual customer release uses stable MAJOR.MINOR.PATCH versioning.
