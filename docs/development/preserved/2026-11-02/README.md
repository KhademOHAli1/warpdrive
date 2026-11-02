# Branch consolidation — 2 November 2026

This revision integrates reviewed source slices and retains all eight synchronized preservation heads as merge parents. Unfinished source is archived without activating it. GitHub issues and the [restart index](https://github.com/KhademOHAli1/warpdrive/issues/80#restart-index) remain the live work log.

| Module      | Active source                                                                                       | Preserved snapshot                                                                                                                            | Work item                                                  |
| ----------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Agency      | IRR/toman exponent parsing and unique monetary-field accessibility IDs                              | [6b54329](https://github.com/KhademOHAli1/warpdrive/commit/6b54329ce42189d7f901232dce82961e6276b23d) / [811 files](agency/manifest.json)      | [#13](https://github.com/KhademOHAli1/warpdrive/issues/13) |
| Calendar    | No new active backend; canonical calendar source retained                                           | [dce675d](https://github.com/KhademOHAli1/warpdrive/commit/dce675d4dd57e42a07064de25e1d6886ff187eff) / [326 files](calendar/manifest.json)    | [#9](https://github.com/KhademOHAli1/warpdrive/issues/9)   |
| Integration | Provider cancellation identity, Slack failure classification/revocation, refresh-family containment | [80e5318](https://github.com/KhademOHAli1/warpdrive/commit/80e53189f26885a6a02b0c2e9197bd2052478d92) / [137 files](integration/manifest.json) | [#7](https://github.com/KhademOHAli1/warpdrive/issues/7)   |
| Mail        | No new active backend; canonical MAIL source retained                                               | [c950ed7](https://github.com/KhademOHAli1/warpdrive/commit/c950ed70a88d9b69ba6394dfc9a72f7f7218b043) / [118 files](mail/manifest.json)        | [#11](https://github.com/KhademOHAli1/warpdrive/issues/11) |
| Privacy     | UTF-16 disclosure limits and unmounted, non-executable metadata-only retention preview              | [d935f22](https://github.com/KhademOHAli1/warpdrive/commit/d935f22e0d1e82b73264db1e1603066c5d8be3d8) / [470 files](privacy/manifest.json)     | [#12](https://github.com/KhademOHAli1/warpdrive/issues/12) |
| Sales       | No new active backend; canonical Sales source retained                                              | [f4cda0d](https://github.com/KhademOHAli1/warpdrive/commit/f4cda0ddf5d46a2220334b5942a9106d31b92649) / [230 files](sales/manifest.json)       | [#8](https://github.com/KhademOHAli1/warpdrive/issues/8)   |
| Settings    | Navigation order, footer controls, icons and shortcut navigation guards                             | [cd4eda0](https://github.com/KhademOHAli1/warpdrive/commit/cd4eda0cb01db0ab1c5166d00baa229292c6716e) / [79 files](settings/manifest.json)     | [#15](https://github.com/KhademOHAli1/warpdrive/issues/15) |
| Workflow    | Insert steps on connections and maintain coherent display ordering                                  | [9ab13d2](https://github.com/KhademOHAli1/warpdrive/commit/9ab13d225e98c7bbe88042505c03dd0bbec01324) / [111 files](workflow/manifest.json)    | [#10](https://github.com/KhademOHAli1/warpdrive/issues/10) |

The 2,282 archived payloads include 920 handoff/evidence files. Every payload ends in `.source`; manifests retain original paths, modes, Git blob IDs and SHA-256 values. The original commits remain reachable from main after the branch names are deleted. Restore a bounded increment from its original snapshot or archive into the existing workspace, reconcile it with current main, and qualify it against its canonical issue.

## Qualification

The configured app type generation/TSC, changed-source typed lint/Biome and translation checks passed. Focused checks passed 345 unit cases, 30 registry cases and 21 current-source PostgreSQL cases. Two actual source-inventory reports match, with no missing or invalid classifications. Process groups and owned disposable database resources were cleaned up, with foreign resources preserved. The exact final hosted CI receipt is recorded on issue #80 before branch deletion.

An independent audit verified all eight archives against original branch heads, with no omissions, byte/mode mismatches or active test/compiler payloads. `active-adoptions.json` records the selected source paths and qualification scope.

## Remaining work

Calendar, Sales, MAIL and Agency persistence changes need their bounded schema/authority integration; no private migration is admitted here. The canonical 195-file Drizzle tree and contiguous 0000–0098 history remain unchanged. Broader Privacy readers and workflows, targeted Slack reauthorization and future regression proposals remain inactive. The eight governance drafts are also archived without activating new automation.

Ready source does not establish full browser, assistive-technology, provider, installation, release or deployment acceptance. Original roadmap and acceptance clauses remain on their canonical issues. The next usable outcomes are workflow save/reopen execution (#674/#909/#85), the deal stage journey (#906/#82), reliable reminders (#907/#83), and mailbox recovery (#908/#84), one bounded increment at a time.
