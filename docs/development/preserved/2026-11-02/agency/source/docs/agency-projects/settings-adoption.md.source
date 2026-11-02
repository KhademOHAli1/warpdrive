# Settings source adoption into the Agency candidate

31 October 2026. Owner source: `ec9b3f8943e42736edc6713c099fd2ef14068d0a`, clean `codex/settings-ux` checkout and its written implementation-coordination handoff. Agency pre-adoption source: `8e6e2a65349ea6ebd6e652228ffe46c7caac6327`. Common ancestor: `a1a8f6da1ce366c35002900bf33508356dfbb995`.

The Settings owner reports 613 selected tests, full types/lint/build and selected German/Farsi native journeys. Those results belong to that source cut. This adoption is a source integration candidate, not a transferred full pass or accepted combined release.

## Conflict resolution and actual seams

Preserve the Settings navigation source byte-for-byte: searchable mobile Sheet, keyboard/focus recovery, logical RTL side, permission-filtered destinations and the existing desktop directory. Do not restore the earlier compact Select implementation.

Merge each FA/DE/EN Settings catalog structurally against the common ancestor. There were no conflicting leaf values. Preserve the owner’s changed labels and all six workflow permission labels in every locale. This retains 18 workflow-label leaves without reverting the owner’s human-readable permission copy.

Actual shared additions are now present: optional `SecondaryNavLink.onNavigate`, optional `ConfirmDialog.secondaryAction` with pending locking and no automatic close on secondary action, responsive `PageHeading` wrapping with unchanged props, and logical Settings table-header alignment. Managed primitives, package/lockfile and server/provider/migration contracts are unchanged by the owner delta. The global workflow/auth/integration foundations from the Agency branch remain intact.

The inherited compact-selector regression failed after adopting the Sheet: 1 failed and 11 passed. The compatibility patch updates only that test and its navigation mock to assert the same permission gates and destination link plus Sheet dismissal. No production UI was changed to satisfy the stale test.

## Scoped local evidence

- Navigation suites: 18 passed in 2 files.
- Dialog secondary action/focus, heading, Settings messages and import-state selection: 30 passed in 5 files.
- `bun run i18n:check`: exit 0, zero catalog issues or new source findings.
- Biome on the adapted navigation test: exit 0 after formatting.
- Conflict-marker check and staged whitespace check: exit 0.
- The Settings owner reviewed the supplied compatibility snapshot and found no blocking presentation issue. Its exact review is retained in `evidence/settings-owner-compatibility-review.md`. It confirmed the unchanged owner navigation, 18 retained workflow labels and appropriate Sheet regression test.

The merge is committed as `980833d0d74795c8f8fda77d962de017d96b6f03`. The owner's review leaves three concrete persistence gates: an explicit lifecycle-command/grant table; native administrator, grantor and high-risk behavior for `project.create`; and revocation-through-commit coordination with identity, flag, membership and team writers. Those gates remain proposed in `project-core-delta.md`; this presentation review does not approve them or enable Agency persistence.

Logs are retained under `evidence/settings-adoption-*.log`. Type-aware validation of the compatibility test, a complete combined type/lint/unit/build run and new native browser evidence remain open. A scoped typecheck was held before launch when the 3 GiB resource guard failed. No failure is counted as a pass, and no build/database campaign or Agency service was started.

No dirty peer source, fixture, credential, browser session or service was adopted. Source was fetched into the Agency checkout’s independent object store; fork/upstream remotes were retained. Resource pressure does not authorize deleting peer caches or borrowing their test databases.
