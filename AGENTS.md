<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Shared Warpdrive work

Each feature chat owns its module, private helpers, UI and tests. Continue scoped implementation in existing workspaces. Inspect current shared contracts and preserve overlapping work; routine implementation, validation and integration do not require another chat's permission.

The one-off branch consolidation from the frozen base `68e9e55890dd1ceedfbfe0853019673bf79105e4` is complete. The existing integration branch was merged through PR952 at `86201a96522f22607df3710d809a1391f562b940` and closed. That freeze and integration branch are historical, not the ongoing branch model.

Make implementation and documentation commits on work branches and integrate completed increments through reviewed pull requests. Feature owners may independently validate and merge their completed work when integration is authorized by the user. Do not commit or push directly to main. Review and qualify each increment at its exact revision, then verify the resulting exact-main CI and CodeQL evidence before integration or release is claimed; branch checks cannot substitute for future main results. Follow `docs/delivery/ci-release-controls.md` and `docs/delivery/release-operations.md`.

Every included main commit needs a genuine canonical issue reference or a committed mapping under `docs/delivery/commit-links.json`. Follow `docs/delivery/tracking.md`; a pull-request number alone is not a canonical issue. Preserve unfinished work and existing scope; source qualification does not close acceptance or release gates. Keep the existing completion-order MAIL `1.5.x` policy and full-programme `1.6.0` reservation. The core release and technical acceptance policies remain unchanged; no automatic issue completion, version assignment or publication follows from consolidation. The user explicitly authorized newsletter version `1.6.1` on 11 November 2026 under the bounded source publication policy in `docs/delivery/newsletter-release-policy.json`.

Use existing workspaces and avoid unnecessary branches, clones or registered worktrees. Preserve the user's excluded `codex/deal-workspace-premium` branch and workspace without inspection or changes unless the user's current scope explicitly supersedes that exclusion.

On the shared Mac, run validation independently in the task's existing workspace with isolated, task-owned resources. A queue allocation or coordination chat is not required. Check available memory and disk before resource-intensive work, run one owned heavy job at a time, bound its duration, and verify cleanup of owned processes and services. Preserve unrelated services, databases, dependencies and peer changes. Historical queue and operating-agreement records do not impose an additional coordination prerequisite.

At integration, inspect the latest canonical migration journal and use the next contiguous ordinal, preserve historical SQL, generate the matching snapshot and validate the actual populated upgrade. Private migration reservations are advisory until reconciled against that journal. A journal with skipped ordinals is not a canonical journal.
