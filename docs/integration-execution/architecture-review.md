# R0 architecture acceptance review

Reviewed 31 October 2026 by the execution owner and independent peer agents. The source
baseline was `3d653a7`; registry extraction is `90ad0f4`. Architecture files were reviewed
as working design records, with findings corrected before status closure. This is the
recorded design/scenario review required by ARCH, not a user approval, runtime security
qualification or implementation completion for CONN/EVT/AISEC/SDK.

## Reviewed contracts

- [Identities, ownership, capabilities, evaluator and lifecycle](architecture-identities-authority.md), ARCH-001 through ARCH-005.
- [Transactional events and delivery semantics](architecture-events-delivery.md), ARCH-006/007.
- [Client trust, runtime isolation, versioning and release gates](architecture-clients-runtime-release.md), ARCH-008 through ARCH-012.

The execution owner checked the original 446-row acceptance contract, the BASE source
maps, each design's current-versus-future boundary, the scenario matrices, single-tenant
and independent FA/DE/EN display requirements. Two independent reviews cross-checked
identity/authority against event and broker behavior. These reviews produced concrete
corrections, recorded below. The pinned MCP primary sources and installed SDK/adapter
paths were compared in the client contract; modern and legacy profiles remain distinct.

## Findings resolved before acceptance

| Finding                                                                             | Corrected decision                                                                                                                                                                | Verification                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| New connection after removal conflicts with old globally unique Slack row           | Stable unique upstream account, at most one nonremoved relationship, retained tombstone/new connection lineage; explicit partial-uniqueness migration before new lifecycle claims | Independent targeted re-review passed                                                       |
| Channel authority could be borrowed for proposed SMS expansion                      | Explicit proposed send/receipt/inbound names and resource boundaries, outside current v1 grants until scope and vocabulary revision are reviewed                                  | Independent re-review passed; 586-row amendment remains unimported                          |
| Sandbox invocation actor could mean event originator instead of execution principal | Bind invocation to executionActorId and its grant; retain originator only for audit; reject swapped bindings                                                                      | Independent re-review passed                                                                |
| Stable provider key could be retried with changed CRM/template body                 | Prepare immutable bounded business payload/hash/destination/provenance once; current authority still gates retry; changed body needs a new reviewed effect                        | Independent re-review passed                                                                |
| Frozen request could accidentally include changing credentials/signatures           | Canonical business content explicitly excludes credentials wherever encoded and broker/transport authentication; current permitted credentials are injected at execution          | Execution-owner clarification accepted, aligned with secret-free intent and broker contract |
| Authority could change between a DB authorization read and effect commit            | Shared/exclusive transaction advisory gate, all relevant authority writers, bounded waits and consistent ordering; authority-changing effects take exclusive gate initially       | Independent re-review passed; writer adoption/concurrency tests remain implementation work  |
| Restore could rewrite event origin context and duplicate old effects                | Immutable origin IDs, distinct active execution context, sends disabled and mismatched old work blocked pending finite recovery review                                            | Independent re-review passed                                                                |
| First observed timestamp could mutate an immutable event or imply exact COMMIT time | Keep recordedAt distinct from separate durable dispatch observation; neither is mislabeled exact physical commit time                                                             | Independent re-review passed; EVT acceptance must retain semantic distinction               |
| Peer amendment could be mistaken for active programme scope/priority                | Contract explicitly keeps 446-row live register; 586-row planning input and overrides remain separate                                                                             | Independent re-review passed                                                                |

## Acceptance trace

| Task     | Concrete criterion reviewed                                                                                                            | Result                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| ARCH-001 | Installation/account/connection/grant/credential identities, reconnect and I1-I8 duplicate/race scenarios                              | Complete design review                                       |
| ARCH-002 | Personal/shared connect, use, configure, transfer, remove; O1-O10 authority cases and custodian offboarding                            | Complete authorization-scenario review                       |
| ARCH-003 | Finite versioned domain/outbound/resource/admin vocabulary, exact operation intersection, C1-C5 and future-extension rules             | Complete policy-example review                               |
| ARCH-004 | Existing domain evaluators plus shared server seam, no ambient authority, N1-N14 negative cases and DB/external serialization boundary | Complete negative-case review                                |
| ARCH-005 | All nine lifecycle states, guarded transitions, reconnect overlay, precedence and L1-L10 reconciliation cases                          | Complete state-transition review                             |
| ARCH-006 | Canonical mutation transaction owns immutable outbox; persisted workflow/pg-boss admission reuse; rollback/lost-nudge/fan-out cases    | Complete failure-scenario review                             |
| ARCH-007 | At-least-once, fact/admission/effect/attempt uniqueness, frozen requests, unknown outcomes, bounded ordering/retry/cancel/restore      | Complete failure-scenario review                             |
| ARCH-008 | Pinned MCP client metadata/DCR/admin policies, exact identity and audience/resource/profile gaps, modern/legacy source paths           | Complete protocol review; no host-conformance claim          |
| ARCH-009 | Bun-compatible real OS/container target, broker/egress/quotas/UI boundaries and adversarial threat matrix                              | Complete threat-model review; no operational sandbox claim   |
| ARCH-010 | Independent version domains, compatibility/deprecation window, exact-data and immutable-workflow/migration examples                    | Complete compatibility-example review                        |
| ARCH-011 | Independent finite real-provider/client gates with supplied resources, scopes, bounded actions, evidence and cleanup                   | Complete operator-contract review; no actual external action |
| ARCH-012 | Dated capability comparison and distinct source/local/provider/release/publication wording                                             | Complete scope review; no whole-product parity claim         |

All 12 ARCH rows may close as design tasks under their stated verification methods.
Implementation still requires test-first code, real PostgreSQL for data/authority/concurrency,
locale/browser/operator gates and appropriate actual-provider evidence. Architecture closure
never turns the proposed grant evaluator, lifecycle, outbox, sandbox or client policy into
implemented behavior. It also does not close a broader package's runtime exit criterion.

## Adjacent foundation review

CONN-001 source inventory in [provider seams](provider-seams.md) maps the Slack-specific
catalog, schema, actions, callback, credentials, resource paging, errors, health and revocation
paths, with an incremental extraction order and peer migration ownership. CONN-003 registry
review independently confirmed all 21 stable IDs/order, current presentation and copy, actual
metadata consumers, truthful local/planned auth metadata, and no private fields. Tests cover
catalog and consumer regressions; they do not claim complete localized provider journeys.

[QA-001 taxonomy](evidence-taxonomy.md) received independent review: source, unit, real DB,
simulated provider, native protocol, browser, actual provider, deployment and publication
claims remain separate. Historical counts retain their source attribution. No peer test
report, uncommitted implementation or incoming planning row is treated as local completion.
