# Ship the next Warpdrive release

GitHub issues and the central Project own live execution. Source implementation, integration with green CI, user-journey acceptance, release publication, deployment, and real provider/installation acceptance are separate statements. A source snapshot, generated packet, diagnostic, synthetic suite, or successful subset does not complete the original acceptance scope.

Prepare all implementation, policy, version and release-plan changes on feature branches and integrate them through reviewed pull requests. Do not commit or push directly to main. The existing integration coordinator serializes PR integration and publication; this tooling grants no deployment authorization.

## Delivery and completion

Every new main commit after the recorded bootstrap revision must reference its canonical issue, for example `Fix reminder recovery, refs #123` or a `Delivery-Issues: #123, #456` trailer. A PR reference by itself does not satisfy this rule. Historical commits at or before the bootstrap are preserved without rewriting their messages. An immutable commit-to-issue exception can also be recorded in the committed `docs/delivery/commit-links.json` `commit_issues` object, or a release plan, for a commit that has already landed. Both the push workflow and release generation read the default file. Bootstrap records cover only actual commits reconciled with the integration coordinator; they assert traceability, not acceptance.

A bounded accepted delivery may contribute to an unfinished broad roadmap issue. Record that deliberate scope decision per full SHA in `delivery_scope`, either in the default file or the committed release plan:

```json
{
  "schema_version": 1,
  "commit_issues": { "FULL_40_CHARACTER_COMMIT_SHA": [123, 456] },
  "delivery_scope": {
    "FULL_40_CHARACTER_COMMIT_SHA": { "delivery_issues": [123], "contributes_to": [456] }
  }
}
```

Every original canonical message reference and added `commit_issues` reference must be accounted for by those two disjoint lists. In the core-CRM track every shipped commit needs at least one bounded `delivery_issues` issue accepted in the selected release milestone. The MAIL track retains this entire ledger but separately marks unselected historical scopes as unreleased context; it does not claim they are accepted features. All identities must be registered canonical issues. `contributes_to` references are retained in notes/artifacts, stay unfinished, and receive no completion or publication update. This mapping must be reviewed on main and is not an acceptance bypass. Without an explicit scope mapping, all canonical references remain delivery references in the ledger. The core track requires their acceptance as shipped scope; MAIL separately classifies references outside its selected accepted scope as unreleased context.

Keep issues open while their original scope remains unfinished. Human acceptance remains the default; the narrowly opted-in technical completion path below records agent provenance explicitly. Add evidence of implemented source and exact-revision CI to the issue, then have the applicable reviewer examine its entire canonical acceptance scope. Calculate its acceptance identity:

```sh
python3 scripts/delivery/release.py scope ops/journey-calendar-reminders
```

That human posts a comment on the canonical issue containing this structure, with real checks and evidence URLs. This is an authenticated GitHub maintainer attestation, not a claim of cryptographic signing. Copy the actual full revision and scope digest, and document limitations explicitly. Never include credentials, personal mailbox data, customer records, private local evidence paths, or unpublished security details.

````text
```warpdrive-acceptance
{
  "schema_version": 1,
  "verdict": "accepted",
  "revision": "FULL_40_CHARACTER_MAIN_SHA",
  "canonical_id": "ops/journey-calendar-reminders",
  "acceptance_sha256": "FULL_SCOPE_SHA256_FROM_SCOPE_COMMAND",
  "checks": [
    {
      "name": "Complete event/reminder journey including durable failure and retry",
      "result": "passed",
      "url": "https://github.com/KhademOHAli1/warpdrive/actions/runs/ACTUAL_RUN"
    }
  ],
  "user_journey": "Describe the actual exercised user journey and its complete acceptance coverage",
  "limitations": "State remaining deployment/provider/installation boundaries and any supported-scope limits"
}
```
````

Completion requires the latest successful main run at that exact revision for every required workflow/job in `release-policy.json`, full-scope attestation, and authenticated completed blocking dependencies. The live native blocker set must cover every canonical prerequisite; a deleted/partially imported edge or a manually closed blocker without full-scope evidence fails closed. The completion workflow audits a completed canonical issue and reopens it when those gates are missing. Cancelled/not-planned historical records remain distinct from accepted delivery. Labels alone never provide acceptance. Programme/work-package completion recursively verifies every registered descendant, its full-scope acceptance, and exact native child coverage, plus the parent attestation; release selection uses bounded deliverables.

## Delegated agent acceptance for bounded technical issues

The user's 2 November 2026 decision permits clearly identified agent acceptance after independent agent review and green CI for bounded technical work. `technical-acceptance-policy.json` is an explicit canonical-ID and scope-digest allowlist, not a list of completed work. Each entry explains its technical boundary and lists source paths the independent review must pin. There is no opt-in by label, title, module, historical status or a comment's own assertion. Changing acceptance clauses or original source-task bindings invalidates eligibility until the new scope is reviewed and its policy digest updated. Do not edit the approved scope to obtain eligibility.

Human acceptance remains required for unlisted work, the protected journey/installation IDs and parents themselves, and every issue used in the core-CRM release track. The explicit MAIL track permits the existing independently reviewed, per-ID opted-in technical acceptance for bounded technical leaves only. It does not turn that acceptance into human journey, deployment or real provider/installation evidence.

The current delegated transport is the explicitly listed `KhademOHAli1` GitHub account, numeric User ID `118572997`, with current write/maintain/admin authority. The gate compares the actual issue-comment author with both this policy and the comment's `transport_actor`. GitHub authenticates that posting principal. It does **not** independently authenticate internal Codex runtime identities or prove that separate agents performed the work. The declared session/task identities and separately retained independent report are auditable process evidence under the user's delegation; they are not two GitHub reviewers or cryptographic signatures. Never describe a delegated agent comment as human acceptance.

Use this procedure without inventing evidence:

1. Check the issue's unchanged canonical scope and native prerequisites. The implementation coordinator integrates the reviewed implementation and documentation first.
2. A separate reviewing agent records its actual Codex session ID and task path, reviews every original acceptance clause, and creates `docs/delivery/technical-reviews/ISSUE-DATE.json`. The accepting and reviewing agents must be distinct. Preserve the actual independent findings and limitations; an integrator-written replacement claiming that someone reviewed is not the independent report.
3. The review record uses the schema below. Pin every path required by the policy, plus any additional source needed for the full scope. Use SHA-256 of the exact Git blob bytes. Its `reviewed_revision` is the real reviewed ancestral source commit. All pinned bytes must match both that commit and the later acceptance revision. A source change requires a refreshed review. Evidence-only follow-up commits can retain unchanged source proof.
4. The coordinator commits the review record. It cannot contain its own enclosing commit SHA; the later issue comment names the full resulting main revision and SHA-256 of the committed review-file bytes instead. The release policy must equal the committed policy of the trusted main checkout. A historical technical policy may omit later trusted opt-ins only when every retained item and every global field still match exactly. It cannot borrow an omitted item's authorization, introduce or change eligibility, or alter human-only scopes, actors or required checks. Adding an unrelated technical opt-in therefore preserves earlier valid closure audits without transferring their evidence to a newer acceptance revision.
5. Wait for the latest successful main runs at that exact revision. The agent gate independently reads the required release-policy jobs **and** the technical policy's CodeQL workflow `403980173`, including all three Analyze jobs. A failed, running, cancelled, wrong-revision or non-main run does not pass. Evidence links in the comment do not replace these API checks.
6. Post the explicit schema-2 agent acceptance comment, then complete and audit the issue. Keep dependency order: every canonical blocker must itself have valid scope-specific acceptance, not merely a closed state. Recursive child/dependency checks preserve that capability, but each item independently applies its exact opt-in and human-only rules. A parent remains human-accepted even when its technical children have valid delegated-agent acceptance. The audit uses the agent path only for eligible bounded technical leaves; only the explicit MAIL release track opts in for eligible leaves. The core-CRM release track retains human acceptance.

A review record contains these fields. Replace the illustrative values with the independently produced report and the **complete** source-pin and clause sets. `criteria` must cover `AC1` through `ACn` exactly once, with passed results and real HTTPS evidence; partial or changes-requested review cannot grant acceptance.

```json
{
  "schema_version": 1,
  "review_type": "independent_source_review",
  "result": "accepted",
  "canonical_id": "integration/CONN-001",
  "acceptance_sha256": "ACTUAL_FULL_SCOPE_SHA256",
  "reviewed_revision": "ACTUAL_FULL_REVIEWED_SOURCE_SHA",
  "reviewer_agent": {
    "runtime": "codex",
    "session_id": "ACTUAL_CODEX_SESSION_UUID",
    "task_id": "/root/actual_review_task"
  },
  "summary": "Actual independent whole-scope review and findings",
  "limitations": "Actual remaining user-journey, provider, installation and release boundaries",
  "criteria": [
    {
      "id": "AC1",
      "result": "passed",
      "evidence": ["https://github.com/OWNER/REPO/blob/FULL_SHA/PATH"]
    }
  ],
  "source_pins": [
    { "path": "docs/integration-execution/provider-seams.md", "sha256": "ACTUAL_BLOB_SHA256" }
  ]
}
```

The accepting agent posts the following separate comment. `scope_summary` describes technical acceptance; it must not invent an exercised user journey. The review digest binds the retained independent file, while its source pins and the live CI checks bind the accepted source.

````text
```warpdrive-acceptance
{
  "schema_version": 2,
  "acceptance_mode": "delegated_agent",
  "verdict": "accepted",
  "revision": "ACTUAL_FULL_CI_PASSED_MAIN_SHA",
  "canonical_id": "integration/CONN-001",
  "acceptance_sha256": "ACTUAL_FULL_SCOPE_SHA256",
  "transport_actor": { "id": 118572997, "login": "KhademOHAli1" },
  "accepting_agent": {
    "runtime": "codex",
    "session_id": "ACTUAL_CODEX_SESSION_UUID",
    "task_id": "/root"
  },
  "independent_review": {
    "path": "docs/delivery/technical-reviews/ISSUE-DATE.json",
    "sha256": "ACTUAL_COMMITTED_REVIEW_FILE_SHA256"
  },
  "checks": [
    { "name": "Actual whole-scope technical check", "result": "passed", "url": "https://github.com/OWNER/REPO/actions/runs/ACTUAL_RUN" }
  ],
  "scope_summary": "Actual accepted bounded technical outcome",
  "limitations": "No human journey, release, deployment or provider/installation acceptance inferred"
}
```
````

Schema 2 never falls back to human schema 1. The existing human format remains valid and does not depend on the technical allowlist. Policy opt-in, retained review, source qualification, exact-main CI, issue completion and release approval remain separate records.

## Select scope and version

The first milestone is `Next usable release: Core CRM journeys`. The first stable core-CRM publication always requires these four canonical journey issues, even if the milestone is renamed or MAIL patches have already been published:

- `ops/journey-deal-stages`: manage a persisted deal through stages with authority and feedback.
- `ops/journey-calendar-reminders`: schedule an event with reliable reminders and failure/retry behavior.
- `ops/journey-mailbox-recovery`: connect/manage a mailbox with recoverable failures and preserved state.
- `ops/journey-durable-follow-up`: run a useful durable follow-up automation with truthful status.

The initial milestone also includes four bounded technical support issues, delivery tooling and the bounded MCP resource-policy increment. Original broad roadmap issues retain their complete scope and remain open; milestone source units contribute to those originals without claiming their full completion.

Later core-CRM feature and improvement releases use a new milestone containing exactly the bounded issues being shipped. Their accepted scope, supporting changes, and all included commits must be traceable to that milestone. Keep unrelated unfinished work outside it.

Run `python3 scripts/delivery/release.py next-version` for a patch suggestion, or use `--bump minor`/`--bump major`. The suggestion exceeds the current package version and stable tags/releases. The integration coordinator prepares the chosen package version before committing the release plan. The dry run lists only changed files, and the explicit apply mode writes only the package version plus a Bun root-workspace version field if the lockfile declares one. Current Bun lockfiles omit that field, so the lock stays unchanged. No install or dependency regeneration runs.

```sh
python3 scripts/delivery/release.py bump-version --version 1.4.1
python3 scripts/delivery/release.py bump-version --version 1.4.1 --apply
```

Have the coordinator integrate that ordinary version change with its canonical issue. The selected release must exactly match its committed package version and exceed every other stable tag/release. `VERSION`, source package metadata, and release tag therefore agree.

The historical core-CRM planning plan is retained at `docs/delivery/releases/core-crm.json`. The manual workflow default, `docs/delivery/releases/next.json`, now mirrors the proposed next MAIL per-version plan. These are plans, not publication evidence. The MAIL example has no selected milestone yet and cannot pass until actual scope, version and acceptance are ready.

Commit a plan such as `docs/delivery/releases/1.4.1.json` through the integration coordinator:

```json
{
  "schema_version": 1,
  "version": "1.4.1",
  "milestone": 1,
  "issues": [123, 124, 125, 126],
  "required_journeys": [
    "deal-stages",
    "calendar-reminders",
    "mailbox-recovery",
    "durable-follow-up"
  ],
  "journeys": {
    "deal-stages": [123],
    "calendar-reminders": [124],
    "mailbox-recovery": [125],
    "durable-follow-up": [126]
  },
  "commit_issues": {}
}
```

The numbers above are examples, not imported issue identities. Resolve actual numbers from `issue-map.json`. Include every issue in the milestone exactly once, including accepted maintenance/supporting changes. The chosen revision is supplied separately, because a committed plan cannot contain its own commit SHA. The committed plan, policy, roadmap, commit links and package metadata must be present at the selected revision. The release engine reads those files from Git objects; local uncommitted edits cannot change the released scope or package version. The candidate policy must match the committed policy of the trusted main checkout running the engine.

## Prepare, draft, publish

After the chosen main revision passes CI and has acceptance comments for its entire release scope, run the `Warpdrive release` workflow from main. The workflow checks out only its trusted dispatch-main revision, validates the candidate full SHA and main ancestry before exposing release credentials, and never executes candidate code. Candidate source is read as data and archived from its immutable SHA. Supply the immutable full revision, committed plan path, and one explicit mode:

1. `prepare`: reads GitHub and generates downloadable notes, traceability, source archive, `VERSION`, and `SHA256SUMS`. No tags or releases are created.
2. `draft`: repeats every gate, creates a tag pointing directly to that selected revision, and creates/updates the draft release with verified artifacts.
3. `publish`: repeats the gates, checks the draft/tag/artifact identity, rechecks live evidence immediately before publishing, and explicitly publishes that version. Only after independently rereading the published release and exact tag, it adds idempotent publication receipts and a `release:published` label to accepted delivery issues, then closes the unchanged fully completed milestone for core or full-programme releases. MAIL task patches leave milestone closure separate and never update unreleased context. It never updates broad contribution issues, acceptance, or deployment. The release workflow therefore declares `issues: write` for these post-publication receipts; native Project Released status remains an explicit manual update.

The equivalent local read-only check uses trusted release tooling in the existing main checkout and reads the selected committed revision without switching branches or disturbing unrelated WIP:

```sh
python3 scripts/delivery/release.py check --plan docs/delivery/releases/1.4.1.json --revision FULL_MAIN_SHA
python3 scripts/delivery/release.py prepare --plan docs/delivery/releases/1.4.1.json --revision FULL_MAIN_SHA --output work/release-1.4.1
```

Use `draft` or `publish` in the same command only when that explicit external action is intended. A rerun reuses an existing draft at the same tag/revision, reuploads deterministic files, and verifies uploaded names, sizes, and SHA256 digests. It refuses another commit under that version, attempts to edit published artifacts, stale unrelated output files, missing scope, unaccepted issues, missing CI, and incomplete blockers. A tag created before a failed draft upload is safe to resume at the same revision. Published versions are immutable in this flow; ship a new version for improvements. The included commit range starts at the latest actually published stable release. Drafts, prereleases and abandoned tags reserve their versions but never remove commits from the complete source-history ledger. MAIL acceptance gates apply to its selected scope; retained unreleased context is not newly accepted. If publication succeeded but receipt tracking was interrupted, rerun `publish` with the identical plan/revision. It verifies the published artifact digests and repairs only missing receipt labels/comments/milestone closure without editing the published release.

Artifacts are explicitly a pre-publication evidence snapshot (so their released/deployed fields remain false); the live GitHub Release and receipt represent publication. Artifacts preserve source revision, milestone, every canonical delivery, acceptance reviewer/comment and evidence URLs, included commits, exact CI run IDs and job names, and explicit stage boundaries. The source archive is the selected committed source, not local uncommitted work. MAIL manifests and notes distinguish the accepted release scope from unreleased source context; retaining historical source does not release every feature in that snapshot. It is reproducible for the same release evidence. Deployment and real provider/installation acceptance continue through their existing authorization and validation process.

## Bounded verification

```sh
python3 -m unittest discover -s scripts/delivery -p '*test*.py' -v
python3 scripts/delivery/tracking.py validate
actionlint .github/workflows/delivery.yml .github/workflows/delivery-acceptance.yml .github/workflows/release.yml
```

These standard-library tests do not install dependencies, build the app, start services, or access a database/provider. They exercise importer reconciliation and release gating with isolated API fixtures. The exact-main CI run and actual user acceptance remain required before any release.


## MAIL task releases: 1.5.x, then the full programme at 1.6.0

The user authorized completion-order MAIL releases on 3 November 2026. Each release-ready mail deliverable receives the next unreserved `1.5.x` patch, starting at `1.5.1`; its MAIL number does not determine the patch number. Version `1.6.0` is reserved for the entire unchanged `programme/mail` scope. Later versions such as `1.6.1` remain available to the ordinary core track and its own gates. Parent/package tracking items are not accepted merely because one child was released.

`mail-release-policy.json` is a separate trusted policy so earlier technical acceptance audits retain the unchanged core release policy. Use `python3 scripts/delivery/release.py next-version --track mail` to read live reservations. Published tags, draft releases and stable-form prerelease tags all reserve their numbers. Commit the selected package version and `docs/delivery/releases/mail/VERSION.json` through a reviewed PR, then wait for the exact resulting main CI. `next.json` may mirror that same plan; the gate requires exact equality with the per-version committed plan.

A patch plan uses `release_track: "mail"`, `mail_mode: "incremental"`, one `primary_issue` and its exact `canonical_id`. The primary must be one registered mail deliverable. A dedicated nonempty release milestone must contain exactly the selected issues; any supporting non-mail deliveries must also have valid full-scope acceptance. The next example is deliberately unready: its null milestone and unaccepted issue cannot authorize publication. Replace it only with actual qualified scope.

The MAIL gate checks latest exact-main application/delivery CI and all three managed CodeQL analyses. Existing human-only IDs and provider/installation criteria remain in force. Agent acceptance works only through the existing exact-ID/scope opt-in, independent review and source pins; there is no automatic opt-in by mail module or release plan. A technical patch records technical acceptance and leaves whole-programme/user-journey acceptance false. It does not close the broad core-CRM milestone.

All commits remain accounted for from the actual last published stable release, or the original bootstrap when none exists. The separate PR-integration boundary records main `dfa3f3317e186cbb494aee012cb298363e1a89dd`, observed before this workflow change: included commits after that boundary require actual merged-PR association. It does not truncate traceability or fabricate PRs for historical commits. Drafts and tags never truncate that history. MAIL acceptance applies to the selected primary and explicit support scope, not every unrelated pre-existing task in that ledger. All other canonical references and broad contributions remain visible as UNRELEASED context and receive no acceptance claim, release label, comment or milestone update. The fixed adoption snapshot `386e31652da094ddcc7daec7003164b5b9c81882` identifies pre-existing source context; fresh app/schema delivery outside accepted scope is rejected rather than hidden as history. Do not move the traceability bootstrap or invent acceptance. Prior published MAIL tasks are read from their immutable tagged per-version plans, preventing a second patch release for the same canonical task.

For `1.6.0`, use `mail_mode: "programme"` and the canonical `programme/mail` primary. The new release milestone contains the programme and any new release-local scope. Full canonical mail coverage is independently resolved and verified across the repository, without moving previously released tasks out of historical milestones. The existing recursive parent/child and dependency gate must pass: technical leaves retain their explicit delegated acceptance, while parents and protected human/provider scopes require actual human acceptance. Completing twelve MAIL tasks or one technical recovery leaf is insufficient. The original first core-CRM journey gate remains independent of all MAIL publications.

Use the existing serialized main release workflow in prepare, draft and publish modes. Publication produces a verified source archive, notes, traceability and checksums; it neither builds a container nor deploys or upgrades an installation. The user's standing authorization permits publishing once these actual gates pass; it is not an acceptance record.
