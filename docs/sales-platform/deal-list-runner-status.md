# Deals sort/paging runner status

1 November 2026. This handoff records the terminal native attempt at
08:56:05 UTC and the preceding client attempts. Deals global sorting/paging
remains unadopted. All 16 projects and 128 parent tasks remain in scope, with
zero completed parents.

## Source and implemented candidate boundary

The native test-only branch was clean at
`8ec5aab88c009743f7a148f62df1ca0256986774`. It adds six PostgreSQL cases to
03100336, with the selected 85-entry Sales history and unchanged dependency lock.
No server sort/paging implementation is present.

Client reports name the same committed base plus recorded owned working-file and
diff hashes. They are not clean-checkout passes. The separate client candidate
contains paging and seven fixes for witnessed create/unarchive/realtime failures;
its final GREEN, type/lint and combined native evidence remain open.

The inline-edit fixture now sets a 60-second cache lifetime, while its original
assertions stay intact. That case and the new identical-later-page rebuild case still require a
behavioral RED. Two additional, unexecuted owner-metadata cases cover off-page
owners, unchanged OR scope/server totals and German recovery when a selected
owner disappears. Their preparation is not evidence of working metadata support.

## Actual attempts

| Attempt                  | Observed result                                                                  | Classification                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Client core/membership 1 | 14 cases/three files, five passed and nine failed; 12.693 seconds, exit 1        | Seven genuine create/unarchive/realtime failures; one fixture returned undefined cache data; one five-second paging timeout |
| Targeted client 2        | 45.111 seconds; reported child exit -15                                          | Before RUN; zero cases, infrastructure only                                                                                 |
| Targeted client 3        | 48.118 seconds including cleanup; reported child exit -9                         | Before RUN; zero cases, infrastructure only                                                                                 |
| Targeted client 4        | 48.094 seconds including cleanup; reported child exit -9                         | Before RUN; zero cases, infrastructure only                                                                                 |
| Targeted client 5        | 45.111 seconds; reported exit 143                                                | RUN reached; zero cases, infrastructure only                                                                                |
| Targeted client 6        | Separate 90-second window; 90.239 seconds, exit 143                              | RUN reached; zero cases, infrastructure only                                                                                |
| Native six-case 1        | TERM at 180 seconds, 185.261 seconds including kill grace; wrapper 137, child -9 | RUN reached; database setup and all assertions unexecuted, infrastructure only                                              |

Native attempt 1 retained a minimum 12,948,320,256 free bytes above its 5 GiB
floor. Its exact original three-container Docker baseline remained/restored.
All recorded groups are terminal and the reservations were released. The five-second
cleanup overrun beyond the requested native total was acknowledged. The future
native wrapper 2 is prepared but unexecuted, stopping work at 170 seconds and
reserving ten seconds for cleanup within a 180-second total. It carries no grant.

Unchanged lock SHA-256:
`529a9b6a87d9fc836c45a8e68f0da012ed8a111b0fc60b09a0e5c3c8bfbef0e4`.
Unchanged migration-journal SHA-256:
`4d89be8c2d18d22a088ae592ae0345373b6067e5cefc7bb9da9a3fbb4feaa867`.
This selected synthetic history does not qualify a current-main or retained upgrade.

## Preserved private receipts

Raw reports and logs remain private under each worktree's ignored
`.runtime/sales-evidence/`. These SHA-256 values identify the recorded bytes:

| Receipt basename                                      | Receipt SHA-256                                                    | Log SHA-256                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `deal-list-client-core-and-membership-1-process.json` | `4b624758291f83a83ea92ea690da3575a03d003234018eeb9fbe4382a8f59542` | `1eb55f6e20518393527f599758317ee009d45bdeb7f47c33d8318ff2a9bc0e47` |
| `deal-list-client-membership-red-6-process.json`      | `38dd15940c0107ec98aedc02b867ccc5738a032ed103f2529410202c9008ed30` | `22313a52cde9f08a997d79b3990cdcfb0b073444cf00d54a47a026485917cc99` |
| `deal-sort-native-red-1-process.json`                 | `bf49c0c81da2592bf1730ecf22ae1563f2852419949172df600a8c8631dd4959` | `565d66174c3e4452824f51625b1fb3220052476bbff1d1e04e77309f6a1af752` |

The targeted client attempts retained identical tracked-diff and six typed-file
hashes before owner-test preparation. Infrastructure timeouts do not justify
changing the assertions or implementing the held inline/server behavior.

## Dependency observations and next action

A bounded read-only metadata inventory found 78,428 regular dependency files,
913,931,631 logical bytes, 60 contained symlinks and 35,879 files marked
`SF_DATALESS`. The exact files observed during stalls were currently allocated
and not dataless. The placeholder population therefore does not establish the
cause of those stalls. A direct Python read returned immediately while the
native process was live, after which its open descriptor moved to another small
dependency file; the exact JavaScript/filesystem cause remains unproven.

An isolated ordinary byte copy of the existing install is proposed for a later
loading comparison. Preserve the current install, dependency versions, source,
assertions and every existing symlink. The copy script is preparation only at
this checkpoint; copy/import/test execution needs its own fresh, named resource
grant. Verify copied bytes and ownership before admitting the result, and keep
incomplete copies unusable. Follow the live disk floor and reserve shutdown
inside the total deadline. Avoid an automatic retry or a wider campaign.

After runner readiness is established, obtain the exact next finite grant and
execute the held behavioral cases. Server implementation still begins with an
actual native RED. The future owner catalog must come from the complete visible
AST-filtered base before the separate selected-owner restriction and paging;
the global active-user directory omits visible former owners and has a different
scope. Assignment permissions remain unchanged.

The adopted saved-view checkpoint remains 03100336, locally merged at 7c1076
with an identical application tree: 425 affected units/33 files, 18 actual
PostgreSQL cases/three files, full types and full lint passed on that source.
Its source-bound JSON and frozen packs are preserved. These later infrastructure
attempts provide no newer production build, native browser, provider or release
acceptance. The latest production build-checked source remains f006b5a.
