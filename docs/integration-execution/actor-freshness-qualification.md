# Deal update authority checkpoint

1 November 2026. Evidence class: one reproduced domain bug, a focused real PostgreSQL
16 red/green and independent source review. This is a bounded shared-domain correction,
not completion of QA-005, AISEC, current-actor serialization or the 446-task programme.

## Reproduction and correction

At source `994cecd20a6e56afe4866022c6d2d765ac23af0a`, the new
`src/features/deals/updateDeal.actorFreshness.integration.test.ts` first authenticates a
synthetic native session and captures a real hydrated regular editor. Its positive
control retains authority and verifies title, audit and durable realtime version updates.
The negative changes only the database permission-set flag `deal.edit_own` to false.
It confirms a newly hydrated actor has lost the flag while the captured actor retains
it, and keeps the target deal's actual valid `expectedUpdatedAt` CAS value.

The initial run passed the positive control and failed the negative. Four soft assertions
showed an actual unauthorized title write, audit entry and realtime channel-version bump,
as well as a successful Result where `PERM_DENIED` was required. A stale CAS, invalid
fixture, missing role or unrelated startup failure did not produce this red.

`updateDeal` now starts its existing transaction before authority and target reads. It
hydrates one current actor from the trusted caller's actor ID and fails closed if absent
or inactive. That same actor supplies group-membership, edit, referenced-contact visibility,
audit and event checks. Custom-field validation and the authorized before-row read use the
same transaction. SQL CAS is unchanged; the write, audit, label synchronization and durable
version plus `pg_notify` remain atomic. This expands the transaction's read scope, while
preserving its atomic mutation semantics.

Old test helpers supplied administrative/regular flags only in objects while persisting
unprivileged users. The changed fixtures now persist their declared authority. The regular
own-editor positive, foreign-owner denial and hidden-person denial remain regular, with
real permission sets. The hidden-person case additionally requires `CONTACT_NOT_FOUND`,
so rejection at an earlier edit gate cannot masquerade as a successful reference check.
No global seed default, shared actor API or `moveDeal` behavior was changed.

## Exact focused evidence

Both commands used pinned Bun 1.4.4, the existing `integration` project, one worker and
its unchanged disposable `postgres:16-alpine` setup. The private native PostgreSQL 18
profile and the peer workflow database were not used. An owned process-group wrapper
required two start observations above 5 GiB and enforced disk/deadline stops.

| Evidence                                       | Observed result                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `actor-freshness-red-20261101.log` / `.json`   | Parent/group 80824, terminal exit 1, 3.460 s; one pass, one failure, two tests |
| `actor-freshness-green-20261101.log` / `.json` | Parent/group 82612, terminal exit 0, 2.663 s; two passes, two tests            |

The selected command in both runs was:

```sh
bun run test:integration --maxWorkers=1 src/features/deals/updateDeal.actorFreshness.integration.test.ts
```

Docker returned to the three previously inventoried containers after teardown. Both owned
process groups were terminal. Root source review and a separate independent reviewer
accepted the consistent actor checkpoint and the meaningful fixture negatives. The reviewer
read the actual red/green logs and ran no duplicate campaign.

## Affected regression and practical limits

The following affected real-PG files passed in the later coordinated window:

- `src/features/deals/dealUpdate.test.ts`
- `src/features/deals/dealUpdatePerms.test.ts`
- `src/features/deals/dealUpdate.changeLog.test.ts`
- `src/features/deals/dealUpdate.sourceChannelId.test.ts`
- `src/features/deals/dealUpdate.customFieldsChangeLog.test.ts`
- `src/features/deals/dealHiddenMutation.test.ts`
- `src/features/deals/updateActionScrub.test.ts`
- `src/features/deals/notifyWiring.test.ts`
- `src/features/labels/labelWiring.test.ts`
- `src/features/labels/labelsRepo.entities.test.ts`
- `src/features/saved-filters/filterAst.test.ts`

Together with the new actor file this passed **59 cases in 12 files**, process group
2298, exit 0, in 7.599 seconds. Only formatting of this domain file followed that run.
Final standalone types and scoped lint also passed; see
[the later qualification](qualification-20261101.md). Full-PG, runtime and provider gates remain
open; the later checkpoint below records full-unit and build results. `notifyDeferral.test.ts` can verify wiring, but its mocked domain cannot
replace the real-PG audit and version assertions. Existing MCP tool-list tests do not
invoke `update_deal`; a direct-registry invocation needs separate evidence before making
that caller-specific claim.

This refresh is one authority checkpoint. Default READ COMMITTED and separate unlocked
actor queries do not serialize permission changes through commit. A nested caller using
an older repeatable-read snapshot has its own isolation limits. CAS protects the deal
version, not authority writers. The domain accepts an already authenticated trusted actor
ID; it cannot revalidate a native cookie/session, MCP grant, application scope or recipient
fanout from that ID alone. Those boundaries, concurrent revocation tests, all other mutation
paths and the planned shared authority fence remain open.

## Later qualification checkpoint

The [1 November D225 checkpoint](qualification-20261101.md) subsequently completed the
full 6,024-case unit lane, production/worker compilation and independent frozen dependency
install. Whole-source lint stopped at Biome before ESLint. Its exact receipts and remaining
full-PG, browser/runtime, authority and provider gates are separate from this focused record.
This later evidence does not rewrite earlier red/interruption results or close broader tasks.
