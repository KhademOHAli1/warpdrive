# Mailbox recovery qualification, 2 November 2026

This bounded MAIL slice makes connection failures visible and gives users an explicit recovery path after an uncertain settings save. It contributes to #908 and #280. The full mailbox journey and those issues remain open.

A failed initial IMAP LIST now records one fixed, safe health classification against the captured current account, owner and connection generation. The existing active-owner, connected and unpaused guards prevent an older worker from changing a reconfigured account. Successful LIST retires only this helper's fixed codes; it does not advance synchronization or erase current or historical folder errors. Health uses only currently selected folders, while historical rows remain available.

After a save loses its acknowledgement, the mounted form blocks resubmitting its consumed proof. **Reload saved settings** performs the existing authorized list read and displays current credential-free settings. The notice explicitly says those settings do not prove that the previous save completed. **Return to mailbox list** is a separate action with a distinct notice. Retry reports that synchronization was requested, before a worker has completed it. No credential readback, new receipt schema, provider permission or privacy lifecycle capability is introduced.

## Actual evidence

The companion [qualification record](mailbox-recovery-20261102.qualification.json) preserves full source and receipt SHA256 values, exact local paths, caps and cleanup results. Raw receipts remain local evidence rather than invented hosted links.

| Cut              | Actual result                                                                                                                                   | Time                                         | Bound                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| UI focused1      | 7/7 component cases passed; original UI bytes remain unchanged                                                                                  | 1.551 s component, 2.589 s inclusive         | 20 s, 2 GiB                                         |
| Static1          | Normal Next type generation, full configured TSC and 14-file typed lint passed; **overall FAIL** from two Biome formatting differences          | 0.791 / 19.130 / 7.418 s; 29.456 s inclusive | 45 s work, 60 s inclusive, 8 GiB                    |
| Format delta     | Only health helper and native test formatted; both semantic TypeScript ASTs equal; other 15 MAIL inputs unchanged                               | ASTv2 0.227 s                                | Read-only comparison after the one requested format |
| Static2          | Two affected typed-lint files and all 17 owned Biome files passed; no typegen or full-TSC repeat                                                | 6.180 s inclusive                            | 45 s work, 60 s inclusive, 8 GiB                    |
| Native2          | 10/10 native cases passed                                                                                                                       | 4.251 s native, 9.012 s inclusive            | 45 s work, 60 s inclusive, 3 GiB                    |
| Privacy phase 1  | Inventory clean, 31/31 registry cases and one-file typed lint passed; **overall FAIL** from stdin CHECK protocol; final owned Biome phase unrun | 0.775 / 1.661 / 4.459 s; 8.709 s inclusive   | 45 s work, 60 s inclusive, 4 GiB                    |
| Privacy addendum | Separate format copy and filesystem Biome 4 passed; parsed JSON and report bytes exactly unchanged; no inventory/unit/lint repetition           | 1.151 s inclusive                            | 15 s, 1 GiB                                         |

The initial AST comparator accidentally included the SourceFile raw text and reported a false whitespace mismatch. Its failure remains preserved. ASTv2 compares node kinds, child order and semantic tokens/literals/templates, including SQL and assertions. The formatter was not rerun.

Native2 uses cached PostgreSQL 16, the exact 102-migration canonical prefix, ordinary test-database clones, and owned loopback TLS. It covers real authentication/LIST failure and recovery with retained imported history; five current-binding changes; selected versus historical folder errors; safe unknown classification; successful LIST followed by a fresh typed folder TLS error; and no-page recovery that preserves last-sync, historical folder evidence and unrelated legacy codes. All owned groups and database resources were removed, foreign resources/listeners and pinned inputs were retained, and private credentials were deleted.

These are separate evidence cuts. They do not form a combined 17-case run or a new full-TSC run after formatting. Sampled aggregate usage was approximately 0.601 GB for focused1, 6.337 GB for Static1, 2.395 GB for Static2 and 0.646 GB for Native2; sampling does not prove a continuous peak. The native post-LIST TLS case injects a typed folder failure rather than breaking a physical TLS connection. Five state mutations do not prove a held transaction race or ordering between concurrent results in one generation.

## Privacy report scope

The isolated inventory CLI found no missing or invalid classifications. Its four registry files passed all 31 cases, and the reviewed registry file passed configured typed lint. The original overall FAIL remains: the stdin CHECK invocation returned exit 1 before the final owned-file Biome phase. A separate supported stdin format copy produced **byte-identical** report bytes, followed by a passing filesystem check of the report, registry and two notes. This establishes a stdin-check protocol failure, rather than unformatted JSON. The addendum reran no inventory, tests or lint.

Root reviewed and adopted `docs/privacy-inventory-report.json` in the working tree, SHA256 `582ac423ed20ae157b74c4ec2f54d34b0f91b8b315934b50d3c3c3de370c28e9`, source fingerprint `d72ba6e707b1dedd046b0e79f537bb34395f570c221012c83bb33df4a18aa9e4`. The actual isolated Git099 baseline has **2378 eligible source files**; exactly `MailboxSaveRecovery.tsx` and `imapSyncHealth.ts` add two production files, yielding 2380 with no removed eligible committed source. The old 2406-file report came from the shared working tree and cannot establish a one-file delta or source deletions. Source-review and writer counts each increase by one, declarations by three; discovered derived count and other metadata stay unchanged. Root's initial adoption guard rejected the incorrect count assumption before any write, then adopted only after this path-set reconciliation.

## Remaining gates

The native/static cut is based on `7d13fc714dee96db1b5920a4661377f801c3b61e`. The next isolated candidate starts from `099c5dc998ed51a0133629fe3648ab5800e5e66e`, whose product blobs are identical. The intervening changes format one Markdown file and update two qualified CI test fixtures. There is no assigned MAIL candidate commit yet.

The reviewed privacy companion classifies the fixed health helper in the existing mail-sync group and updates two reviewed source pins. Its isolated source qualification and report adoption are complete as the separate cuts above. Root still must freeze the actual candidate and final report/documentation. The build foundation must preserve the original failed receipt and separate passing addendum, and prove that its final `src/` and `scripts/` path/hash sets equal the qualified phase 1 cut.

A normal production webpack/full-TypeScript build with artifact provenance, the real HTTP/UI mailbox browser recovery journey, new exact-candidate CI and publication remain pending. Live providers, installed upgrades, deployment, release and human acceptance are separate. This document closes none of #908, #280, #276, #272 or the parent mailbox journey #84.
