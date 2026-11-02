# Provider SVG repository guard hardening

Source: `d96892afdb954febbc4595fb6066ae5d6dc11745`, 31 October 2026. This changes only
the repository asset test and four test-helper files. It does not change SVG bytes, layout,
provider availability or a runtime upload/rendering API. UX-013 remains open for its other
recorded acceptance, including complete current appearance evidence.

## Observed test-first evidence

The original one-file asset baseline passed. The old literal-pattern checks were extracted
without changing their behavior, then adversarial fixtures reproduced the missing checks:
37 failures and 14 passing controls across 51 cases. All 36 bypass fixtures were accepted
by the old guard; the additional failure checked that entity declarations stop before parsing.
The loop over the 20 retained SVGs and the positive/legacy rejection controls stayed green.

After strict validation, all 51 selected cases passed. This total includes one loop covering
the 20 assets; those assets are not counted again as 20 additional tests. Owner-file Biome
passed after formatting, and independent source review found no actionable issue in this
retained-static-asset profile. All 20 SVG fingerprints match the prior provenance record.

| Run               | Result                                                                                                                               | Private evidence                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Baseline          | One file, one test passed; watchdog duration 0.964s.                                                                                 | `svg-guard-baseline.log`, `.json`                |
| Meaningful red    | 37 failed, 14 passed; completed exit 1, 1.695s.                                                                                      | `provider-svg-guard-red-20261031.log`, `.json`   |
| Owner green       | 51 passed; completed exit 0, 1.296s including runner overhead.                                                                       | `provider-svg-guard-green-20261031.log`, `.json` |
| Independent rerun | Interrupted by resource watchdog before assertions completed; child SIGTERM (-15), wrapper exit 143, 3.155s. No pass/fail inference. | `svg-guard-independent.log`, `.json`             |

The independent run started with 3,548,676,096 available bytes and stopped when availability
fell to 2,292,187,136. Its process group exited; no retry was made. The owner's 51-case green
remains the execution evidence, supported separately by independent source review.

## Selected policy and bounds

The helper uses existing pinned jsdom's DOMParser without enabling resource loading or scripts.
It returns only finite Result codes, with no raw XML/parser/URL failure details. UTF-8 input
size is checked with `Buffer.byteLength` before parsing, capped at 16 KiB. DTD/entity/extra
processing-instruction forms fail before parsing; two exact XML declaration forms are allowed.
Malformed documents, wrong namespaces/prefixes and forbidden node types are rejected.

The 256-node limit counts the root and all descendant DOM nodes in its subtree, including
title text and comments. Document-level prolog/epilog comments are outside that subtree but
remain bounded by the byte limit. Root depth is one; only element descent increments depth.
Element counts include the root and exclude non-elements. Returned gradient IDs identify
referenced gradients, not every declaration.

Exact element/parent/attribute/value rules preserve current static geometry, titles and
local gradients while rejecting script/animation/foreign/image/use/link/style content,
event/unknown/namespaced attributes, hrefs and external paint references. Paint references
must resolve to uniquely declared local linearGradient IDs. Accepted namespace URI strings
are metadata, not network loads.

This is a repository update guard for reviewed provider files, not a general SVG sanitizer,
an untrusted-app sandbox, browser appearance qualification or authority to accept uploads.
New legitimate markup outside this narrow profile requires deliberate review and tests.

## Resource and completion boundary

Only one selected unit file ran per invocation, with existing dependencies and one worker.
The operational runner admitted these small units above 3 GiB, stopped their owned process
group below that floor, and imposed a 60-second cap. Its successful resource interruption
is not a test failure. Database/build/install/broad campaigns still require stable headroom
above the separate 5 GiB threshold.

At the dated `d96892a` cut, no new install, PG, browser, build, full suite, type-aware lint
or standalone types ran for this change, and the register had 37 completed tasks. The
old source's type/full-suite results were not transferred to this helper.

## Later scoped qualification, 1 November 2026

Source `5bf5563` extracts small helpers from the two functions rejected by the first
type-aware complexity check. Root reviewed unchanged allowlists, budgets, validation
order and error precedence. The existing selected file then passed **51/51**, process
group 5094, exit 0, in 1.291 seconds. SVG bytes and fixtures were unchanged. Current
standalone TypeScript and scoped Biome/type-aware ESLint also passed; see
[the current focused record](qualification-20261101.md).

The earlier independent execution remains an interruption, not a retroactive pass.
The later checkpoint below adds full-unit and build results. Full-PG, whole-lint, browser,
appearance and other UX-013 acceptance remain open.
No task was closed for this refactor; the live tracker owns the current overall count.

## Later qualification checkpoint

The [1 November D225 checkpoint](qualification-20261101.md) subsequently completed the
full 6,024-case unit lane, production/worker compilation and independent frozen dependency
install. D225 whole-source lint stopped at Biome before ESLint; the subsequent docs-only
`d238bcb` full-lint recheck passed. Its exact receipts and remaining
full-PG, browser/runtime, authority and provider gates are separate from this focused record.
This later evidence does not rewrite earlier red/interruption results or close broader tasks.
