# Ship the next Warpdrive release

GitHub issues and the central Project own live execution. Source implementation, integration with green CI, user-journey acceptance, release publication, deployment, and real provider/installation acceptance are separate statements. A source snapshot, generated packet, diagnostic, synthetic suite, or successful subset does not complete the original acceptance scope.

Only the existing integration coordinator stages, commits, and pushes canonical main. This tooling adds no branch or pull-request requirement and grants no deployment authorization.

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

Every original canonical message reference and added `commit_issues` reference must be accounted for by those two disjoint lists. Every shipped commit needs at least one bounded `delivery_issues` issue accepted in the selected release milestone. All identities must be registered canonical issues. `contributes_to` references are retained in notes/artifacts, stay unfinished, and receive no completion or publication update. This mapping must be reviewed on main and is not an acceptance bypass. Without an explicit scope mapping, all canonical references are treated as shipped delivery scope.

Keep issues open while their original scope remains unfinished. Add evidence of implemented source and exact-revision CI to the issue, then have a human with repository write authority review the entire canonical acceptance scope. Calculate its acceptance identity:

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

## Select scope and version

The first milestone is `Next usable release: Core CRM journeys`. The first stable publication always requires these four canonical journey issues, even if the milestone is renamed:

- `ops/journey-deal-stages`: manage a persisted deal through stages with authority and feedback.
- `ops/journey-calendar-reminders`: schedule an event with reliable reminders and failure/retry behavior.
- `ops/journey-mailbox-recovery`: connect/manage a mailbox with recoverable failures and preserved state.
- `ops/journey-durable-follow-up`: run a useful durable follow-up automation with truthful status.

The initial milestone also includes four bounded technical support issues, delivery tooling and the bounded MCP resource-policy increment. Original broad roadmap issues retain their complete scope and remain open; milestone source units contribute to those originals without claiming their full completion.

Later feature and improvement releases use a new milestone containing exactly the bounded issues being shipped. Their accepted scope, supporting changes, and all included commits must be traceable to that milestone. Keep unrelated unfinished work outside it.

Run `python3 scripts/delivery/release.py next-version` for a patch suggestion, or use `--bump minor`/`--bump major`. The suggestion exceeds the current package version and stable tags/releases. The integration coordinator prepares the chosen package version before committing the release plan. The dry run lists only changed files, and the explicit apply mode writes only the package version plus a Bun root-workspace version field if the lockfile declares one. Current Bun lockfiles omit that field, so the lock stays unchanged. No install or dependency regeneration runs.

```sh
python3 scripts/delivery/release.py bump-version --version 1.4.1
python3 scripts/delivery/release.py bump-version --version 1.4.1 --apply
```

Have the coordinator integrate that ordinary version change with its canonical issue. The selected release must exactly match its committed package version and exceed every other stable tag/release. `VERSION`, source package metadata, and release tag therefore agree.

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
3. `publish`: repeats the gates, checks the draft/tag/artifact identity, rechecks live evidence immediately before publishing, and explicitly publishes that version. Only after independently rereading the published release and exact tag, it adds idempotent publication receipts and a `release:published` label to accepted delivery issues, then closes the unchanged fully completed milestone. It never updates broad contribution issues, acceptance, or deployment. The release workflow therefore declares `issues: write` for these post-publication receipts; native Project Released status remains an explicit manual update.

The equivalent local read-only check uses trusted release tooling in the existing main checkout and reads the selected committed revision without switching branches or disturbing unrelated WIP:

```sh
python3 scripts/delivery/release.py check --plan docs/delivery/releases/1.4.1.json --revision FULL_MAIN_SHA
python3 scripts/delivery/release.py prepare --plan docs/delivery/releases/1.4.1.json --revision FULL_MAIN_SHA --output work/release-1.4.1
```

Use `draft` or `publish` in the same command only when that explicit external action is intended. A rerun reuses an existing draft at the same tag/revision, reuploads deterministic files, and verifies uploaded names, sizes, and SHA256 digests. It refuses another commit under that version, attempts to edit published artifacts, stale unrelated output files, missing scope, unaccepted issues, missing CI, and incomplete blockers. A tag created before a failed draft upload is safe to resume at the same revision. Published versions are immutable in this flow; ship a new version for improvements. The included commit range starts at the latest actually published stable release. Drafts, prereleases and abandoned tags reserve their versions but never remove unpublished commits from traceability or acceptance gates. If publication succeeded but receipt tracking was interrupted, rerun `publish` with the identical plan/revision. It verifies the published artifact digests and repairs only missing receipt labels/comments/milestone closure without editing the published release.

Artifacts are explicitly a pre-publication evidence snapshot (so their released/deployed fields remain false); the live GitHub Release and receipt represent publication. Artifacts preserve source revision, milestone, every canonical delivery, acceptance reviewer/comment and evidence URLs, included commits, exact CI run IDs and job names, and explicit stage boundaries. The source archive is the selected committed source, not local uncommitted work. It is reproducible for the same release evidence. Deployment and real provider/installation acceptance continue through their existing authorization and validation process.

## Bounded verification

```sh
python3 -m unittest discover -s scripts/delivery -p '*test*.py' -v
python3 scripts/delivery/tracking.py validate
actionlint .github/workflows/delivery.yml .github/workflows/delivery-acceptance.yml .github/workflows/release.yml
```

These standard-library tests do not install dependencies, build the app, start services, or access a database/provider. They exercise importer reconciliation and release gating with isolated API fixtures. The exact-main CI run and actual user acceptance remain required before any release.
