# Failed-step retry: session compatibility and runtime qualification

This increment aligns routine failed-step retry with the credential loader used by `createContext`. A supported legacy session requires an active account, no revocation and an unexpired persisted session. It does not require an `auth_users` mirror or acquire modern MFA, verification, idle or absolute-lifetime policy. Password sessions retain those modern checks. The retry service rehydrates the original actor and checks the PostgreSQL wall clock without refreshing the session.

The earlier implementation compared legacy behavior with the stricter workflow publication resolver. That comparison did not establish parity with the actual application request loader. The new regression suite calls `loadLiveSessionByToken` with a genuine synthetic credential and then exercises retry, preserving completed effects, steps, version, actor, cursor and failure receipt.

## Actual local results

- Public `7c82ba4` plus the new comparison tests: **9 passed, 6 failed** out of 15. The six failures reproduced supported legacy profiles rejected by retry.
- Amended service: **25 selected PostgreSQL cases passed**, with 14 cases unselected. Native execution took 6.083 seconds; the complete job took 9.111 seconds. The selection includes the 15 loader comparisons, four stricter publication-resolver controls and six requester-denial controls.
- Scoped types and typed lint passed in the preceding attempt. That attempt then stopped on one formatting diagnostic before starting native tests. A later formatter-only line join retained identical whitespace-stripped source; the final service and tests passed Biome.
- Owned processes, PostgreSQL and volumes were removed. Fresh foreign resource sets, container states, listeners and source pins were preserved; private credentials were deleted.

The initial unadmitted run, formatting failure and baseline assertion failures remain separate records. They are not relabeled as successful runs.

## Production workflow journey

The separate production build at immutable `89262d516da029a51aee9f9cfa28dd22c47735cb`, build ID `Eq8HuaZflDaUq3VsSAMPc`, passed **23 actual browser checks and 31 independent database readback checks**. Three ordinary users signed in through native HTTP, authored and published workflows, and admitted four real runs. The checks confirmed:

- Natural 60-second waits survived an actual worker stop and restart. A run stayed on version N after N+1 was published.
- Cancellation and revoked run authority produced no tasks for the affected actor.
- An actual failed second task exposed no retry before permission repair. The user then clicked **Retry failed step**, consumed the original failure generation and completed the same run without repeating the earlier task.
- Exactly three intended tasks linked to the selected deal. Two later stale queue jobs completed without changing those tasks or completed steps.

The runtime job completed in 189.668 seconds. All three owned browser contexts and native services were cleaned up. Two earlier partial runtime failures are retained: fixture-copy transport and a positional browser-row observation race. The final callback explicitly waited for each new admission and verified one Cancelled plus one Waiting row.

## Evidence and limits

Operator evidence remains under the existing workspace, rather than invented hosted artifact URLs:

- `.runtime/goal-workflow-retry-session-compat/control/`: baseline, amended attempts, native results and formatting addendum.
- `outputs/goal-core-journeys-20261102/workflow-follow-up/production-89262d516d/runtime-attempt3/`: actual browser results, screenshots, independent readback checks and cleanup receipt.

The production runtime proof uses the stated `89262d5` source cut; it does not pretend to exercise the later legacy-only source change. The loader comparisons qualify that change separately. The fixtures use synthetic accounts and PostgreSQL, with no external provider. Broader workflow scope, human journey acceptance, release, deployment and installed/provider acceptance remain open. Current execution is tracked in GitHub issues #85 and #909.
