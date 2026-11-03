# Mailbox attachment parent, 3 November 2026

Ordinary inbox composition supplied an account UUID while declaring an `email_message` attachment parent. The existing authorizer correctly expected a real message UUID, so a fresh upload was denied. This bounded fix adds an explicit `email_mailbox` parent and uses the currently selected account for fresh, resumed and reply composition. It contributes to #908 and #84; both remain open.

Read and write access require the **current database owner**, an active actor, and an active, non-invited owner record. Administrator role and shared-message visibility do not bypass ownership. Local draft/file access remains available for paused or disconnected Gmail/IMAP accounts; sending authority is separate. Existing `email_message` and CRM parent behavior is unchanged.

Draft resolution and initial interactive send authorize each file's persisted parent. A sender A-to-B copy may retain its fileIds while the actor continues to own their original parent. The change does not introduce a concurrent revocation fence, revoke an issued presigned URL, or change queued snapshot/replay behavior.

The generated `0104_mailbox_attachment_parent` migration appends one enum value. All **204 historical SQL/snapshot files** and the **104-entry journal prefix** remain unchanged; the new journal has 105 entries. The new populated 104-to105 admission case and historical 103-to104 read-operation case each passed within the later, overall failing native run.

## Actual evidence

The [qualification record](mailbox-attachment-parent-20261103.qualification.json) pins actual source and receipt bytes. Local receipt paths are evidence references, not hosted test results.

| Cut                 | Actual result                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline reproducer | One expected owner-upload failure and four passing controls; original overall FAIL retained.                                                                                                                         |
| Focused UI          | 15/15 cases in two complete component suites passed on the earlier pre-format cut, using mocked server actions.                                                                                                      |
| Formatter           | 13 files passed on the earlier cut, before the two subsequent mock corrections.                                                                                                                                      |
| Privacy             | 2433 eligible source files and 2236 classified declarations; no missing or invalid classifications. No lifecycle capability added.                                                                                   |
| Generation2         | Enum-only DDL, matching snapshot/journal and preserved history; 1.818s inclusive.                                                                                                                                    |
| Independent review  | No concrete source findings in the approved contract, pinned to the preceding source1 cut.                                                                                                                           |
| Static1             | Fresh typegen and full TypeScript passed; typed lint18 found four unused parameters in two test mocks. Overall FAIL retained; later units/native did not run.                                                        |
| Static2             | 70/70 cases in ten complete unit suites, typed lint18 and Biome2 passed; 14.632s inclusive. Typegen/fullTSC were retained from Static1, not repeated.                                                                |
| Native2             | 38/40 passed: two upgrade cases, 22 legacy cases and 14 mailbox-authority cases. Two paused IMAP/Gmail fixtures failed at INSERT before authorization; overall FAIL retained.                                        |
| Native3             | Biome1 passed; the lint step stopped at an incorrectly assigned 2 GiB runtime cap before database execution. Its cleanup error and later Root confirmation that the exact groups had exited remain separate records. |
| Native4             | All 16 mailbox-authority cases and affected typed lint passed; 4.251 s native / 15.523 s inclusive. The same-source Biome1 pass was retained.                                                                        |

The two mocks explicitly discard their unused arguments, retaining typed signatures, return values and assertions. Static2 reused Static1's successful compiler evidence and 33 fresh generated inputs through a pinned source delta; it did not reuse Q's generated types.

Native2 exposed a fixture error: `paused` is a separate boolean, not an account-status enum value. Source3 changes only that seed to `status="connected", paused=true`, retaining all 16 cases and assertions. Its 7,781-file manifest is pinned over local base `57cbbacaf693f75733a15c39b7be48e594f38244`. Native4 passed the corrected complete suite. The original 38-pass/2-fail result remains unchanged.

Together, the unchanged two upgrade cases and 22 legacy regressions from Native2, plus the 16 authorization cases from Native4, give 40 unique cases with passing witnesses across distinct cuts. There is no single all-40-pass run. The independent source3 addendum confirms that all three corrections affect test fixtures only. The final run removed its PostgreSQL resources, process groups and private credentials, and preserved source and foreign-resource pins.

The base's durable-read qualification remains separate: 307 unit/privacy cases and 138 native cases passed on its own exact source cut. Those operator-local receipt paths and hashes are pinned in the companion record and do not validate this attachment fix.

## Remaining work

Canonical adoption, a clean production build, the populated browser/upload/SMTP journey, exact-candidate hosted CI and publication remain pending at this source-qualification cut. Physical storage, real providers, installed operation, human journey acceptance, release and deployment require their corresponding evidence. This document closes neither #908 nor #84.
