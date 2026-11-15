# Source module versions

Product release `1.7.1` introduces an explicit source version catalog at
[`module-versions.json`](module-versions.json). Its ten units are Web, Core API,
worker, realtime, migrator, newsletter engine, operations collector, deployment
toolkit, marketing site and documentation content. The catalog declares source
paths, shared paths and dependency relationships. Dependencies propagate impact;
they do not prove compatibility.

Every catalog unit starts at source SemVer `1.7.1`. This is a source baseline,
not a claim about historical installation contents. Legacy installed module
SemVer remains **unknown** unless independent evidence supplies it. Older image
digests, source revisions, runtime IDs and custody receipts keep their original
identities; introducing this catalog never relabels an installed image.
The first PR introducing the catalog records this initial baseline without
automatically advancing it to `1.7.2`.

An affected module defaults to PATCH. Explicit MINOR or MAJOR intent overrides
that decision for affected modules only. Renames and deletions count as changes;
declared shared files and dependent modules also count. Product version metadata
alone is normalized when making these decisions. The generated catalog-only PR
does not affect runtime source and therefore does not trigger another bump.

## Local commands

Use full immutable Git commit SHAs. The engine reads committed Git objects;
uncommitted work is not a candidate. It installs nothing and starts no services.

```sh
module_head="$(git rev-parse HEAD)"
module_base="$(git log -1 --format=%H "$module_head" -- docs/delivery/module-versions.json)"

# Inspect impact and proposed source versions without changing files.
python3 -B scripts/delivery/module_versions.py plan --base "$module_base" --head "$module_head" --output /tmp/module-plan.json

# A stricter check holds while affected modules still need a catalog bump.
python3 -B scripts/delivery/module_versions.py check --base "$module_base" --head "$module_head"

# Prepare only the catalog in the worktree; review and commit through a PR.
python3 -B scripts/delivery/module_versions.py apply --base "$module_base" --head "$module_head"

# Generate source inventory metadata for an exact release candidate.
python3 -B scripts/delivery/module_versions.py manifest --revision "$module_head" --release-version 1.7.1 --output /tmp/module-manifest.json

# Produce the same read-only proposal artifact used by CI.
python3 -B scripts/delivery/module_version_pr.py propose --base "$module_base" --head "$module_head" --output /tmp/module-version-proposal
```

For an ordinary feature PR, use its exact base and head SHAs instead of the
catalog-sweep base above. Explicit intent is a bounded JSON document:

```json
{ "schemaVersion": 1, "bumps": { "web": "minor", "core-api": "major" } }
```

Save it outside the worktree, for example `/tmp/module-intent.json`, then add
`--changes /tmp/module-intent.json` to `plan`, `check`, or `apply`. Unknown or
unaffected module IDs hold the proposal. Intent is supplied per operation, so
an old MAJOR decision cannot silently become a standing rule for later changes.

The optional global repository selector precedes the engine subcommand:
`python3 -B scripts/delivery/module_versions.py --repo /path/to/checkout plan --base FULL_BASE_SHA --head FULL_HEAD_SHA`.

## Automation and review

[`module-versions.yml`](../../.github/workflows/module-versions.yml) validates
PR catalog and changed-path data and exercises the PR's own tooling using an
ordinary PR merge checkout. This also validates the first PR introducing the
engine. This job has read-only repository permissions, no write token or additional secrets,
and retains `proposal.json` and `result.json` as a run artifact. A required
PATCH proposal is useful output, not automatic pre-merge version assignment.
The stricter local `check` command remains available when a PR includes its bump.

After a trusted `main` push, the bot recomputes a cumulative proposal from the
latest catalog-changing commit to the exact current main SHA. This includes
unversioned changes across successive main pushes. If no module needs a new
version, it performs no GitHub requests. Otherwise it creates a single ordinary
catalog-only commit on a deterministic `automation/module-versions-*` branch
and opens a normal review PR. The catalog changes only when that PR is reviewed
and merged through the existing branch and CI controls.
The commit preserves the catalog's original formatting and changes only module
version string tokens. A main push containing that reviewed catalog bump becomes
the next sweep baseline and does not create another bump PR by itself. The bot
holds an older run if main has moved; the newer cumulative run includes source
changes since the latest catalog commit.

Before merging, the existing required **Release PR validation** context checks
that an `automation/module-versions-*` PR retains its exact single source parent
and that this parent equals the current PR base. It also verifies the branch's
source/proposal markers and that the diff changes only existing catalog version
tokens. Close a stale bot PR and generate a new cumulative proposal from current
main; merging or rebasing main into the old bot branch is held. Ordinary feature
PRs retain their usual release checks. Main's required up-to-date branch policy
is also necessary: the local guard cannot observe a later main change after its
run, and the workflow declaration alone does not configure that policy.

Manual runs must select `main`. The default mode is `proposal`; `open-pr` opens
the same ordinary PR. The optional `changes` input accepts the explicit intent
JSON above. There is no direct-main push, force update, auto-approval, auto-merge,
release publication, image publication or deployment operation.

Only the trusted-main bot job receives `contents: write`, `pull-requests: write`
and `issues: read`. It uses the repository's `GITHUB_TOKEN`; no new secret is
required. GitHub must allow Actions to create pull requests in repository
settings (the setting also mentions approving pull requests; this bot never
approves one). Settings activation remains an explicit repository operation.
GitHub documents that `opened`, `synchronize`, and `reopened` PR events produced
with `GITHUB_TOKEN` create runs requiring maintainer approval: select
**Approve workflows to run** before those jobs execute. Other token-generated
events generally do not trigger additional workflows. See
[GitHub's workflow triggering rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
Opening the PR therefore does not establish that its required checks ran or
passed. The bot does not approve workflows or bypass checks.

Bot commits reference canonical issue **#529** (`integration/OSS-011`) by default.
The `MODULE_VERSION_ISSUE` repository variable or manual `issue` input may
override it. Before writing, the bot reads that issue and verifies its single
canonical marker against the committed roadmap. It never closes or accepts the
issue. Missing or conflicting canonical identity holds the operation.

Each run pins the source/main head, rereads existing branch and PR state, limits
API time, response size and request count, and independently reads back created
Git objects, the catalog-only diff, branch and PR. An exact existing PR is
returned without another mutation. A changed branch, closed PR, ambiguous
search or existing branch without a PR requires reconciliation; it is never
rewritten or automatically recreated.

A timeout or incomplete mutation/readback leaves `mutation-state.json` pending
in the retained bot artifact. Stop and independently inspect the named endpoint,
branch and PR before any rerun. Restore the receipt into a manual reconciliation
workspace when investigating: a pending local receipt blocks another write.
The bot performs no automatic mutation retry. Artifacts are retained for 14 days
and are observations, not a replacement for current GitHub state.

## Evidence boundaries

The source release manifest records source module versions, source revisions,
version-decision input fingerprints and declared dependencies. Optional
`manifest --identities /path/to/observed-identities.json` can attach separately
supplied module version, source revision, image digest, runtime ID and named
evidence hashes. Without that evidence, `observedIdentity` is null and
`installedModuleVersionKnown` is false.

The production image workflow also writes `module-release-manifest.json` after
its four images complete the producer smoke test, cleanup and original Docker
inspections. [`module_build_manifest.py`](../../scripts/delivery/module_build_manifest.py)
joins the exact source manifest and committed product version to the original
candidate, smoke report and inspections for Web, worker, realtime and migrator.
Each `builtModules` record includes the catalog's `sourceModuleVersion`, exact
`sourceRevision`, `testedNativeImageId`, and hashes and sizes of that original
producer evidence. Other catalog modules are source inventory entries only;
this sidecar does not assert that they were built or installed.

The tested native image ID keeps its original identity type. It is not assumed
to be a config digest or a selected platform manifest digest.
`platformManifestDigest` is supplied only when the original inspection's
descriptor explicitly identifies that manifest type and matches the tested
native ID; otherwise it remains null. `configDigest` remains null because the
producer evidence does not independently establish it. `installedModuleVersion`
and `installedRuntimeId` also remain null, and `installedAcceptance`,
`publicationAuthorized` and `deploymentAuthorized` remain false. Consumers must
authenticate the original workflow and artifact; the sidecar does not
authenticate itself or authorize deployment.

Neither a source fingerprint nor a caller-supplied evidence hash authenticates
an installed runtime. These manifests are not strict native build-input or
image-custody receipts, compatibility qualification, release approval or
deployment authority. Existing protected release and technical acceptance
policies remain in force.
