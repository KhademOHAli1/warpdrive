# Production build memory qualification — 2 November 2026

The local candidate `e0eba73266ce7a15bba2f3893a720710fee4ca17` completed the production webpack build with normal TypeScript checking and a maximum sampled aggregate process-group RSS of 6,923,714,560 bytes (6.45 GiB). The qualification invocation took 87.817 seconds, including its final audit and cleanup. Existing configuration regressions also passed. **Required hosted CI for the exact integrated candidate is pending; this is not full acceptance or closure of [#916](https://github.com/KhademOHAli1/warpdrive/issues/916).**

The bounded canonical item is `ops/build-memory-2026-11-02`, under `ops/maintenance-intake` (#81). Its unchanged three-criterion acceptance scope has SHA-256 `0c800bed30186d743ec3925ccdd4b880f4a0909fdb3528fe651cad666cdf67eb`. The accompanying [compact evidence record](build-memory-qualification-2026-11-02.json) retains the exact criteria, source pins, method, original receipt hashes and pending gates. It is a summary of retained operator evidence, not a replacement for the raw reports.

## Change and preserved checks

The product change is one explicit setting, `experimental.webpackBuildWorker: true`, plus two explanatory comments in [next.config.ts](../../next.config.ts). The candidate's other two committed files register the genuine maintenance issue in the delivery roadmap and issue map. No dependency or lockfile change is included.

The installed Next.js 16.4.3 implementation disables the default webpack worker when a custom webpack hook exists. Explicitly enabling it runs compilation in a worker that is ended before the later normal TypeScript-checking phase. This gives compilation memory a separate lifetime. The actual complete build qualifies this configuration with the installed plugins; the mechanism alone would not establish compatibility.

Pinned `bun@1.4.4`, the webpack build command, the existing development cache hook, next-intl configuration, server-action privacy and body limits, response security headers, and normal TypeScript checking are preserved. `useTypeScriptCli: false` retains the normal TypeScript API checker; `ignoreBuildErrors` is not enabled. The pre-existing comment describing checking as “in process” is imprecise: installed Next uses its normal API checker in a separate worker. No check was skipped to obtain success.

## Actual attempts

| Frozen source                              | Invocation                                                | Measured elapsed | Maximum sampled group RSS | Actual outcome                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------- | ---------------: | ------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `13f7a20464118ab45a0a3bfbabebd0e99f19eeea` | Normal webpack build                                      |         60.055 s |       8,612,446,208 bytes | Resource stop after compilation entered normal TypeScript; build incomplete.                                                                              |
| Same baseline                              | Direct and inherited Bun `--smol`, same normal checks     |         34.325 s |       8,814,018,560 bytes | Resource stop after compilation entered normal TypeScript; build incomplete.                                                                              |
| `e0eba73266ce7a15bba2f3893a720710fee4ca17` | Same `--smol` mode with the explicit webpack build worker |         87.817 s |       6,923,714,560 bytes | Build process exit 0; all build phases completed. Original strict tracing audit failed, followed by a separate narrow metadata admission described below. |

The successful invocation was allocation `ROOT-GOAL-WF909-PRODUCTION-BUILD-20261102-3`, started at `2026-11-02T15:59:54.518303+00:00`. Its retained log contains compilation success (47 seconds), normal TypeScript checking, page-data collection, all 67 static pages, page optimization and build-trace collection. Its actual build ID is `7MA33MOvK-_-pbN6jjC-v`. Neither earlier failure is recast as a source/type failure or a successful build.

The existing `next.config.test.ts` (15 cases) and `src/config/developmentCache.test.ts` (3 cases) passed together at the same frozen candidate. The guarded test invocation took 2.093 seconds, sampled 390,021,120 bytes and returned its process group. These 18 configuration cases do not substitute for exact integrated hosted CI.

## Resource method and cleanup

The build was launched in a new owned process session from a Git archive, using the exact pinned Bun binary (SHA-256 `0a2237cdcfa0d16ef501d9acca9f0026309ef348bea7393a64e8d1e3609565cc`). Both the direct command and inherited `BUN_OPTIONS` disabled dotenv autoload and enabled `--smol`. The environment contained explicit inert validation placeholders; no application, PostgreSQL, job worker or browser services were started. Existing dependencies were borrowed without installation.

The controller summed `ps` RSS for every process in the owned process group, including compiler/checker descendants that inherit that group. It sampled after synchronous memory-pressure/disk/process probes, then slept 0.5 seconds. This is a nominal 0.5-second sleep plus probe overhead, **not a fixed 500 ms interval or continuous peak measurement**. Raw per-sample timestamps/RSS were not retained; the receipt retains the maximum observed sum. The method does not measure an escaped process group or prove that memory never exceeded the cap between observations.

Entry required memory-pressure level 1 or 2, available-memory indicator at least 40%, and at least 8 GiB free disk. The build loop stopped on a sampled group RSS at or above 8 GiB, indicator below 30%, an unknown/critical pressure level, disk below 8 GiB, or 240 seconds elapsed. Each pressure/process probe had a 3-second timeout. Post-build tracing had a separate 20-second timeout. The configuration-test loop used a 2 GiB RSS cap and 30-second time limit.

Cleanup checked the recorded PID, birth time and process-group identity before stopping a live owned root; it allowed 10 seconds after TERM and 5 after KILL, plus a separate 3-second descendant-group retirement check. The final successful-build receipt records PID/PGID `96991`, birth `Mon Nov 2 16:59:54 2026`, `groupGone: true`, and all frozen input bytes unchanged. The configuration invocation and both stopped baselines also record their owned groups gone and pinned inputs unchanged. No service or container cleanup is inferred from a nonexistent runtime campaign.

## Source and trace provenance

The candidate archive was verified against all 7,596 tracked Git blobs, with manifest SHA-256 `893065cc9809f40b612f5e864cefdf2c45b463ba42a3f12521c9692e3352fdf4`. Its archive SHA-256 is `ddcb51e897bed945a91db720468d0f4d569c054897e5355ebf7b3cf02e4a98a8`. Post-build input checks conserved those bytes. The build working directory and required-server manifest identify the frozen export, rather than the checkout containing other unfinished work.

NFT manifests omit bundled source, so an absence of outside paths is not sufficient provenance. Positive compiler trace evidence includes 9,711 export resource events and 2,122 distinct frozen source paths, including workflow execution and worker modules. Ninety-six client-reference manifests contain 223 positive frozen source paths, including the workflow editor. All 103 raw NFT files were independently rehashed and each file entry resolved relative to its own manifest directory and then through realpath.

The initial strict rule admitted only the frozen export and borrowed dependencies. It correctly failed on 96 NFT references to one additional file: `/Users/ali/Developer/warpdrive-settings-ux/package.json`. That file is regular and not a symlink; its SHA-256 is `33e0ea11342a92b351845f2f5760f67d3463a6ce359bc6747df6a30bc1c14f04`, equal to both the frozen export and exact candidate Git blob. No outside application source, Next configuration, TypeScript configuration or client/compiler resource was admitted.

Root subsequently admitted that **one exact file and digest** as additional dependency-resolution metadata through a separate, independently reviewed addendum. The original `build-worker.public.json` and `tracing.public.json` remain `FAIL`; neither was rewritten. The later addendum and admitted-build pointer are separate `PASS` records. This is a declared metadata input for one retained build, not hermetic export-only proof or a directory-wide exception. No NFT reasons graph or syscall read trace was retained, so the exact dependency edge responsible for each metadata reference remains unproved.

## Evidence and remaining acceptance

Raw operator reports remain under `outputs/goal-core-journeys-20261102/workflow-follow-up/` in the coordinating workspace. The compact record lists their relative paths and SHA-256 values, including both stopped baseline reports, the configuration result/log, full build result/log, source manifest, original tracing failure, separate metadata addendum, admitted pointer, and independent source/metadata reviews. These are retained local artifacts; no unpublished GitHub artifact URL is invented.

| Criterion                                                                                     | Current evidence                                                                                                                      | Remaining gate                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| AC1 — Preserve pinned tools, package/lockfiles, configuration/security and normal type checks | Exact source pins and independent configuration review; full normal build completed.                                                  | Preserve the reviewed source in the integrated candidate.                 |
| AC2 — Actual complete build with declared 8 GiB sampled guard, inputs, method and cleanup     | Actual exit 0, complete phases, sampled RSS, frozen input conservation, process-group cleanup and separately admitted exact metadata. | Retain all measurement and provenance limitations.                        |
| AC3 — Configuration regressions and required exact integrated CI; preserve failed attempts    | All 18 existing regression cases passed; both resource failures and the strict tracing failure remain immutable.                      | **Required hosted CI for the exact integrated main revision is pending.** |

The output-only technical review is a pending draft. This document does not grant policy eligibility, attest acceptance, close #916, authorize release, or establish application runtime, full user journeys, packaging/installability, provider compatibility or deployment.
