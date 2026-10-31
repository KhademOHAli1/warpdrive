# Resource recovery and next source slice

Continuation after the verified 37-task checkpoint at `67eb151`. The previous goal turn
made concrete source, test-evidence and tracker progress; this continuation preserves the
full 446-task objective. No completion count changes with the work below.

The shared Data volume again reached roughly 100 MiB free. A local reviewer and the MAIL
owner observed failed small documentation writes. All root test/build/type/install campaigns
were already stopped, and reviewers were instructed to stop further writes. Space later
recovered to about 3.5 GiB, still below the agreed 5 GiB campaign-start floor and unstable.

The owner verified that `/tmp/warpdrive-integration-qualification-20261031` was clean at
`bc40519`, with no live qualification process. Its non-symlink `node_modules` directory was
then removed to reclaim only owned, reproducible generated dependencies. Source, Git metadata,
lockfile, private profiles, live preview dependencies, peer files and global caches remain.
The qualification clone now needs a frozen pinned-Bun install after headroom is safe.
Do not assume a particular physical free-space gain from logical dependency size.

## Concrete new source evidence

- Independent static review of exact MAIL `571ba2c` verified historical bytes, mapped SQL,
  cumulative metadata and fresh ID/timestamp chains. No database execution was claimed.
- Separate review merge `bea49e7a0bee3db635d050cab5597c077432f251` combines `67eb151` and
  `571ba2c`. Its tree is `e77fed321f2e080691934e267f38ff88d2236d30`. The merge was conflict-free
  and preserves the current platform source inventories. It remains explicitly unqualified.
- The combined model invalidates the fixture's old single-mailbox uniqueness assertion.
  [The compatibility audit](mail-fixture-compatibility.md) identifies precise test-first
  adaptations without editing the tests to hide the new model.
- An unexecuted native actor-freshness regression is authored in
  `src/features/deals/updateDeal.actorFreshness.integration.test.ts`. It retains valid CAS
  and a positive control, checking target/audit/realtime effects after permission removal.
  Its red result is not observed; no production change or security fix is claimed.

The primary preview's application source is unchanged. The review merge has no installed
dependencies or running services. It does not change either installed migration ledger.
The 0091 through 0093 reservations remain absent from the selected MAIL candidate.

## Resume boundary

Keep broad campaigns held until stable headroom returns. Recheck current processes, source
and disk before each finite window. The immediate security step is the one-file real-PG red
profile, followed by the smallest justified implementation and affected controls. Run the
full unit lane as bounded shards when safe, then the selected PostgreSQL/build/lint/worker/UI
gates. Never count the previously interrupted broad unit run as a pass.

Current completed count stays 37; 409 tasks remain planned. The static reviews, prepared
test and unqualified source merge are progress toward those tasks, not additional closures.
