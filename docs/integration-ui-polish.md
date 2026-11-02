# Connections UI refinement

Completed as an isolated local preview on 2026-10-31. This pass implements the eight UI
improvements requested after the first integration foundation. Public deployment, live provider
installation, Slack alerts and a functioning marketplace remain outside this UI pass.

## Delivery and tests

| Step | Delivered behavior                                                                                                                                                                   | Verification                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Local provider SVGs replace colored initials. Generic MCP retains a neutral plug symbol.                                                                                             | Rendering tests, complete asset inventory, self-contained SVG checks and local HTTP loading.                                                                                          |
| 2    | 21 separate catalog entries, including individual storage, automation, delivery and booking providers.                                                                               | Individual provider search tests and localized descriptions.                                                                                                                          |
| 3    | Card actions derive from real configuration, mailbox and Slack connection state. AI onboarding does not infer verified client identity from a self-reported client name.             | State tests cover available, disabled, setup, channel setup, connected, disconnected and pending revocation.                                                                          |
| 4    | Existing connections open first when present. Recovery is prominent. Available apps lead discovery; roadmap entries expand separately or appear when specifically searched/filtered. | Hub tests cover defaults, recovery, empty workspaces, planned providers and intentional disconnection.                                                                                |
| 5    | Provider details separate capabilities, permissions and next actions. Gmail exposes real controls. Operator setup stays collapsed.                                                   | Dialog tests cover setup disclosure, callbacks, actual Gmail controls, Escape and focus restoration.                                                                                  |
| 6    | Slack management shows the actual authorizer, connection date, last successful check, scopes and saved channel name. Reconnect and retry removal are distinct actions.               | Real PostgreSQL verifies safe DTOs without credentials and clearing stale health after reauthorization. UI tests cover channels, confirmation, upstream failure and reauthentication. |
| 7    | Meeting, pipeline and draft prompts have localized previews and copy controls. Grant breadth is explained accurately.                                                                | EN/FA/DE workflow tests and actual browser keyboard activation of prompt copying.                                                                                                     |
| 8    | Compact mobile settings/category selectors, container-aware cards and tabs, Persian count formatting, light/dark identity plates and corrected SVG titles.                           | Existing settings permission/navigation tests plus regression tests and browser layout checks.                                                                                        |

New behavior and regressions were exercised with failing tests before their implementation.
Browser review additionally found and reproduced clipped tab controls before the height fix.
The existing desktop shell and settings navigation treatment are preserved; the compact
settings selector is shared by settings pages below the desktop navigation breakpoint.

## Browser qualification

An isolated browser test session was used after Chrome's tab automation timed out while
another preview was active. No native input was sent to that other preview.

- English directory and Slack details were inspected at desktop width.
- Farsi was inspected with `lang=fa`, `dir=rtl`, the Iranian calendar and Persian digits.
- German was inspected at desktop width and at 320 pixels. Farsi phone checks used 390 pixels;
  tablet layout was checked at 768 pixels and desktop at 1440 pixels.
- DOM checks confirmed no document-level horizontal overflow, containment of tab controls,
  local logo loading and LTR direction for the MCP URL inside RTL content.
- RTL arrow navigation selected the next tab correctly. Escape closed provider details and
  restored focus to the original action. Tab and Enter activated prompt copying successfully.
- Empty search and a specifically searched planned provider were exercised. The planned
  provider's dialog offered no account connection action.
- A clearly named disconnected QA fixture, with no credential or grant, demonstrated
  authorizer and Iranian date rendering. It was removed after review. Intentionally
  disconnected records no longer trigger an active warning.
- Dark mode and reduced-motion media preferences were exercised and the temporary browser
  overrides were reset. The isolated test browser was closed.

Screenshots are in the portable local handoff folder, not distributed in the source repository.
Earlier `*-before.png` captures document issues found during review and are not final screens.
No Mobbin screenshots or assets were copied into the project. The original
[Mobbin research references](integration-ui-research.md) remain the basis for the interaction patterns.

The local browser reported a refused WebSocket connection to the separate realtime service on
port 8080. That worker was not started or qualified during this connections UI pass. Live
Slack, Google, ChatGPT and Claude grants were not created. Screen-reader application testing
and a formal accessibility conformance assessment were not performed.

## Final checks

| Check                                       | Result                                         |
| ------------------------------------------- | ---------------------------------------------- |
| Production build, Bun 1.4.4 / Webpack       | Passed, including Next.js page type validation |
| Focused unit suite                          | 89 passed in 16 files                          |
| PostgreSQL, MCP and OAuth integration suite | 43 passed in 13 files                          |
| TypeScript check                            | Passed                                         |
| i18n audit                                  | No catalog issues or new source findings       |
| Full Biome and ESLint                       | Passed, with 11 existing Biome warnings        |
| shadcn registry audit                       | 23 generated files verified unchanged          |

See the portable handoff's `evidence/` directory for the production build, focused unit suite,
PostgreSQL/MCP/OAuth suite, i18n audit, lint and generated-component audit logs. The existing
repository Biome warnings are retained; no warning suppression was added.

Local preview: `http://localhost:3150/settings/connections`.
Branch: `codex/integration-platform-preview`.
The [platform plan](integration-platform-plan.md) tracks the remaining provider and marketplace work.
