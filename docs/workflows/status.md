# Visual workflow implementation status

Updated: 31 October 2026. Branch: `codex/visual-workflows`, based on fork main `d37518a`. This checkout is separate from the in-progress authentication checkout.

## Current increment

The approved plan and ten-flow Mobbin research are now in the repository. The first code increment implements graph/configuration validation, typed predecessor references, draft persistence and concurrency, permission boundaries, and immutable/idempotent publication. It includes real PostgreSQL migration tests. These are internal foundations; there is no user-facing workflow builder or enabled execution worker yet.

| Tasks      | State                      | Evidence / remaining work                                                                                                                                                        |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF-001     | Initial inventory complete | Reconciled with current fork main; preserve separate authentication work.                                                                                                        |
| WF-002     | Research complete          | Ten inspected Mobbin flows with observations and task mappings.                                                                                                                  |
| WF-003–004 | Specification drafted      | Release scope, vocabulary, six journeys, and fourteen UI surfaces recorded.                                                                                                      |
| WF-005     | Not started                | Rendered Farsi/German prototypes remain required.                                                                                                                                |
| WF-006     | Initial decisions recorded | Definition/publication/authority contracts recorded in architecture; execution decisions still require implementation proof.                                                     |
| WF-007     | Initial implementation     | Registered graph boundary and typed bindings; dynamic CRM metadata and richer field types remain.                                                                                |
| WF-008–010 | Initial implementation     | Definition/version tables, six permissions, draft revisions, validation, immutable publication. Run/event/effect tables, lifecycle operations, and server/UI integration remain. |
| WF-011–042 | Not started                | Durable events/executor, editor, user journeys, integrations, advanced composition, and release gates.                                                                           |

## Verification

The first foundation increment was verified locally under the declared Bun runtime:

- `bun run test:unit --maxWorkers=2`: **5,654 tests across 890 files passed**.
- `bun --bun vitest run --config vitest.workflows.config.ts` with the isolated test database URL: **five real PostgreSQL integration tests passed**. These cover incomplete draft saving/publication refusal, stale draft conflicts, immutable snapshots, concurrent/idempotent publication, reactivation, invalid version pointers, unauthorized/inactive users, and rejection of non-JSON input.
- Latest focused graph/error-domain unit run: **20 tests across two files passed**, including exact money values remaining distinct from numeric durations.
- `bun run typecheck`: passed after generating Next and message declaration types.
- `bun run lint`: passed with the existing 11 cookie-related warnings; changed workflow files also passed scoped type-aware ESLint.
- Application production build: passed under Bun with an ignored build-only environment of synthetic values.
- Documentation production build: passed, including broken-link validation.
- Frozen-lockfile installs: passed for the application and documentation package; no dependency updates were needed for this increment.

Initial red tests exposed missing persistence, mutable published snapshots, non-idempotent publication, non-JSON serialization, a missed reactivation, and money being accepted as duration. Each was corrected and rerun. The broad unit run also required adding WORKFLOW to the existing error-domain allowlist.

These results qualify the internal foundation and current documentation build. They do not establish an implemented editor, executor, provider integration, or production deployment. No real provider messages or CRM customer records were involved.

## Next milestone

Complete the Farsi/German design prototype and the manual-run vertical slice (read a visible deal and create exactly one activity), including duplicate delivery, competing workers, restart recovery, revocation, and cancellation. Then integrate the library/editor and maintain this status page with every implementation change.
