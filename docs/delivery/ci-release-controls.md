# CI and controlled releases

These controls reconcile PR952 with the current release policies and the user's single-consolidation instruction. They describe required evidence and operator actions; a committed document or proposed workflow is not evidence that a check passed or that GitHub protection settings exist.

## One consolidation, one final main merge

Main is frozen at `68e9e55890dd1ceedfbfe0853019673bf79105e4`. Combine all remaining branch work covered by the user's instruction into the existing `codex/ci-release-controls-20261103` branch and PR952. Create no new branches and make no further individual feature merges to main. Preserve source ownership, canonical issue identity, unresolved acceptance scope and failed/cancelled evidence while resolving the aggregate. This branch is the target of this consolidation, not a permanent integration branch.

The existing integration coordinator owns review, the shared heavy-job allocation and the one final reviewed main merge. Qualify the complete aggregate at its exact commit and against the frozen main base before that merge. After the merge, verify the actual resulting main revision independently; branch or merge-candidate results do not establish exact-main CI. If any required gate fails, retain that result and hold integration/release claims and publication until the failure is resolved within the user's authorized scope. No direct-main commit or push is permitted by this process.

Every included commit keeps canonical issue traceability through its genuine message reference or committed `docs/delivery/commit-links.json` mapping. A PR number alone is insufficient. Combining branches does not complete broad issues, accept unfinished scope, assign a version or publish a release.

## Existing release tracks

Retain `mail-release-policy.json`, `release-policy.json` and `technical-acceptance-policy.json` with their existing scopes and rules. MAIL deliverables receive the next unreserved `1.5.x` patch in completion order, starting at `1.5.1`; their task numbers do not determine patch numbers. `1.6.0` remains reserved for the entire unchanged `programme/mail` scope. Use actual live reservations and the matching committed per-version plan when selecting a version. `next.json` may mirror that plan only under the existing equality requirement; it is not proof that the planned release has been accepted or published.

The core-CRM release remains independent. Its first stable publication still requires actual human acceptance of `ops/journey-deal-stages`, `ops/journey-calendar-reminders`, `ops/journey-mailbox-recovery` and `ops/journey-durable-follow-up`, plus its complete selected scope. MAIL patches do not satisfy or close that core milestone. Do not restore PR952's superseded fixed `1.5.0` core-release plan or move traceability, PR-integration or unreleased-context baselines to hide scope.

All source-history commits remain accounted for. Selected release scope needs its own acceptance; unrelated retained source remains explicitly unreleased context under the existing track rules. Fresh application/schema delivery cannot be hidden as historical context. See [release operations](release-operations.md) for the authoritative plan schema and publication procedure.

## Single check contexts and exact-revision evidence

Retain one authored source for each of these eight PR check contexts; do not revive a parallel `browser.yml` or `security.yml` job with a duplicate context:

| Workflow               | Check context               |
| ---------------------- | --------------------------- |
| `ci.yml`               | `CRM checks`                |
| `ci.yml`               | `Marketing site checks`     |
| `ci.yml`               | `Documentation site checks` |
| `delivery.yml`         | `Delivery tooling`          |
| `required-quality.yml` | `Dependency audit`          |
| `required-quality.yml` | `Workflow validation`       |
| `required-quality.yml` | `Browser smoke checks`      |
| `required-quality.yml` | `Release PR validation`     |

The complete aggregate must satisfy the actual applicable checks at its exact revision before the final merge. `Delivery traceability` is additionally a main-only job in the frozen baseline; its future successful main result cannot be claimed before the merge. Review the aggregate's committed issue mapping before merging and verify this job at the resulting main revision afterward. An authored check list is not a claim that branch protection or rulesets have been configured; verify actual settings when relying on their enforcement.

For integration and publication, retain latest successful required runs on the exact selected main SHA. Running, failed, cancelled, skipped, stale, wrong-revision and non-main runs do not substitute for required successful main evidence. Preserve the current track-specific policy requirements rather than widening the historical core or technical policy by documentation alone.

Retain the managed CodeQL workflow `403980173` and all three required analyses: `Analyze (javascript-typescript)`, `Analyze (actions)` and `Analyze (python)`. Read their actual selected-main results and applicable blocking findings. A successful analysis job does not establish that its findings are acceptable. Delegated technical acceptance and MAIL publication retain their existing exact-main CodeQL gates.

## Dependency findings

`Dependency audit` audits the actual Bun lockfiles for the root application, marketing site, documentation site and `tools/browser-smoke`, including production and development dependencies. It performs no install, exclusion, advisory ignore or automatic fix, and every reported severity fails. Keep this all-severity gate; do not restore PR952's high/critical-only or base-difference maintenance mode. An audit failure remains visible until actually resolved and rechecked; workflow changes and release-plan versions do not convert it into success.

Retain each of the four audits' raw stdout and stderr, exit result, and a summary of the audited package/lockfile hashes even when an audit fails. The Monday 06:23 UTC schedule (`23 6 * * 1`) runs this same audit only. The other three `required-quality.yml` jobs—`Workflow validation`, `Browser smoke checks` and `Release PR validation`—skip only the schedule event; their push, pull-request and manual behavior remains. Keep the same single check contexts and dependency roots.

## Browser and acceptance boundaries

Keep the single `required-quality.yml` browser job, ordinary production build/start, canonical migrations, disposable loopback PostgreSQL/HTTPS, and the existing pinned `tools/browser-smoke` dependency and lockfile. Preserve external HTTP/WebSocket blocking, service-worker blocking and browser-error checks. Fixture admission must validate the connection actually used before database imports; a `DATABASE_URL_FILE` override must not redirect a seeded known-password actor beyond the admitted disposable database. Native password login must remain real; add no production authentication bypass or application test route.

The frozen main browser harness covers EN/DE/FA login hydration and protected unauthenticated redirects. PR952's useful deal/calendar persistence, mailbox setup/cancel emptiness, workflow draft persistence and DE/FA mobile/password-visibility cases are a source adaptation for the consolidated harness. Record their actual aggregate run results before claiming that coverage passes. Preserve useful failure traces and screenshots without creating another job or dependency root. Bounded smoke success does not establish reminder delivery, provider/SMTP outcomes, durable workflow execution, installation behavior or any complete protected human journey.

Human acceptance remains the default. Only exact canonical IDs and scope digests already opted in by `technical-acceptance-policy.json` may use delegated-agent technical acceptance, with genuinely separate accepting/reviewing agent identities, retained independent review, pinned source and exact-main CI. A shared GitHub posting principal does not authenticate independent human reviewers. Parents, protected human-only IDs, provider/installation scope and all core-CRM release issues retain their actual human gates. Consolidation, source review, a green subset or one completed child creates no automatic acceptance.

## Explicit publication and actual protection settings

Use the existing serialized manual `Warpdrive release` workflow from trusted main code after the selected main revision and complete release scope satisfy the actual gates. `prepare` produces review artifacts without tags or releases; `draft` explicitly creates or updates a verified draft/tag; `publish` rechecks the immutable revision, scope, acceptance, exact-main CI and artifact identity before actual publication and verified receipts. Published versions remain immutable in the release flow. Deployment and real provider/installation acceptance remain separate.

The fresh-draft/publication CodeQL guard queries the named `refs/heads/main` ref and binds main's SHA to the selected release revision both before and after the reads. It requires all three analysis categories at that exact commit and examines every alert page, blocking high/critical security findings and error-severity findings. API errors, malformed responses, missing categories or commit mismatches fail closed; HTTP 200 or an empty raw-SHA query alone is not proof. Re-read this live guard immediately before publication. Its snapshots go to run stdout and do not change the deterministic artifact schema or checksums. This additional guard applies only to fresh `draft`/`publish` actions; generic `verify_ci`, historical technical-acceptance closure behavior and already-published receipt repair remain unchanged.

At the frozen main revision, `release.yml` has no named environment binding. PR952 proposes `release-preparation` and `release-approval` references. Those names alone prove neither environment existence nor configured reviewers, protection or approval requirements. This proposal does not establish live protection or impose a new approval request. Honor actual configured requirements and the user's existing publication authorization once all actual gates pass; implementation authorization or an environment name cannot fabricate acceptance or publication evidence.
