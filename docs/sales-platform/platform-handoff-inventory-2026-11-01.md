# Committed integration handoff inventory

Read-only observation, 1 November 2026. This inventory is not an adoption,
allocation, runtime rerun or owner acceptance. Peer checkouts may advance.

| Owner source                           | Observed committed HEAD                    | Qualification boundary                                           |
| -------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Platform preview                       | `994cecd20a6e56afe4866022c6d2d765ac23af0a` | Ten dirty paths excluded                                         |
| Clean platform/MAIL adoption candidate | `bea49e7a0bee3db635d050cab5597c077432f251` | Explicitly unqualified combined source candidate                 |
| Combined MAIL                          | `fe4783403010c8b3cba5b744c4a9e483d298baf0` | Later 91-93/notification work remains dirty                      |
| MAIL owner                             | `57f1bae20563fdc3699d40e4e0c2b631be7e67ba` | Five untracked follow-ups excluded                               |
| Builder UX                             | `92a94324601a7335f4a9a42e38e53355909c93c3` | Clean committed source; owner qualification is not a Sales rerun |
| Original WF                            | `d0c83e8ad0ed07097f40bec82727976d022b7742` | Preserved clean base                                             |
| Privacy                                | `65a579eec99755b587f33b97445374093d91e4ff` | Twenty-seven dirty paths excluded                                |

The inspected platform allocation ledger reserves 0085 through 0093 for MAIL.
It explicitly says 0094 is unreserved, not allocated. No Sales receipt/template
reservation exists. The allocator is chat
`01a19217-d257-7813-88e0-cf41cb36d93a`. A concrete request is prepared in
`sales-storage-coordination-request.md`; messaging permission is pending in the
Sales chat. No migration number was claimed or journal changed here.

The immutable `571ba2cfd71361dfa886395bd10adc3b90cb0b8d` MAIL metadata review
preserves platform history through 0084 and maps MAIL 83-88 to integrated 85-90,
with strictly increasing timestamps and existing SQL-only WF guards. It proves
source preservation only. Its review identifies obsolete one-mailbox fixtures
and a one-account/Gmail-oriented connections projection that still need adoption
work. Reserved 91-93 SQL is absent from committed history. Physical dependency
installation, clean/platform84 upgrade and database/object/key recovery remain
unexecuted on the combined MAIL candidate.

Committed platform exports include `invokeProvider` with authorize, exchange,
refresh, listResources, check, disconnect and discoverCapabilities. Existing WF
supports manual publication/admission/execution/cancellation and reconciliation,
visible-deal reads, basic conditions and undated self-assigned activities.

The source inventory did not find a qualified generic credential broker,
grant/lifecycle authority, transactional CRM event outbox, automatic admission,
durable wait or shared MAIL effect binding. Proposed names such as
`projectMailConnection`, `executeMailConnectionOperation`,
`evaluateIntegrationAuthority`, `admitSharedMailEffect` and `readSharedMailEffect`
have no production matches in the inspected committed combined MAIL source.

Actual MAIL internals include `resolveSendConnection`, `readOwnedSendStatus`,
`sendEmail` and `deliverQueuedSend`. Their owner/provider/generation fences remain
effective; these functions are not a public authorization bypass. Sales must
consume actual reviewed capabilities and retain unknown-delivery semantics.

Owning sources inspected:

- Platform `docs/integration-execution/migration-allocation.md` and the committed
  coordination agreement.
- Platform `docs/integration-execution/mail-candidate-metadata-review.md`.
- Combined MAIL `docs/mail-integrated-migration-map.md` and
  `docs/mail-candidate-validation-status.md`.
- Existing committed provider dispatcher and WF/MAIL service implementations.

Sales remains on its own source. Any adoption will reconcile exact commits,
preserve Sales changes and qualify the resulting candidate, with no dirty peer
copying, history renumbering or inferred release completion.

## Builder merge preview in the Sales object database

Exact builder `92a9432` was fetched into the task-owned review ref only. Git
`merge-tree --write-tree` returned exit 0 for Sales `f006b5a` and produced
`2bc75891f7eafe3dae0626a87f975f14eb200873`. The branch and checkout were not
merged. Every Sales-changed file from the original b8 baseline retained its
exact blob, including `docs/sales-platform/README.md`. Root README.md is outside
that Sales-modified set and its builder workflow copy changes in the preview.
The package/lock, migration history, current
Next config, entrypoints/jobs, auth/identity and shared UI surfaces are
byte-identical to Sales in the preview. See
`evidence/builder-merge-preview-2026-11-01.json`.

The reviewed builder behavior adds contextual create/connect, protected
reconnection, graph undo/redo, readable configuration and authorized historical
version/step inspection without stored trigger/output payloads. It adds no
execution engine, automatic trigger, wait, queue, dependency or schema capability.
Its owner reports local qualification and CI at 6dc7730; Sales has not rerun that
candidate. Actual adoption and affected workflow/auth/locale tests wait for the
coordinated validation sequence. Preserve the history-aware merge; replacing the
Sales tree with the builder tree would lose Sales/platform work and misplace WF
migration history.

## Actual source-only adoption

A normal history-aware merge adopted exact builder 92a9432 in Sales commit
`f78c342e2e6f062bd1602c2928d925028bc0d44f`, after documentation checkpoint
fbdef5c was packaged. The actual merge changed 54 builder paths and preserved all
200 Sales-modified blobs from the b8 base through fbdef5c. Protected package/lock,
migrations, Next configuration, entrypoints/jobs, auth/identity and shared UI
remained identical. No dirty peer source, dependency installation or schema was
imported. See `evidence/builder-source-adoption-2026-11-01.json`.

This is source adoption only. The earlier f006 unit/integration/build results do
not qualify the newly combined workflow source. No new heavy run or preview has
started. A bounded selected workflow/auth/locale and workflow PostgreSQL window
was requested after the existing shared queue. Automatic events, waits and shared
MAIL effects remain unavailable; no new parent task is complete.
