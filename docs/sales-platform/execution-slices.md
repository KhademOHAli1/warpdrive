# Bounded execution slices

These are implementation subdivisions, not replacements for the 128 approved
parent tasks. Each retains its parent's acceptance criteria and dependencies.
An increment may provide partial evidence while its parent remains open.

| Slice         | Parent IDs             | Concrete reviewable result                                                                      | Must precede enablement                                                   |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| R0-A          | SP-00.1/.3, SP-15.1/.5 | Exact committed candidate, ownership inventory, read-only lineage comparison, evidence registry | Retained ledger identity, supported-path upgrade and recovery proof       |
| R0-B          | SP-00.2/.4, SP-01.1/.3 | Current-shell source/state inventory, protected journeys, inspected reference decisions         | Rendered FA/DE/EN state matrix and actual reviewer evidence               |
| R0-C          | SP-00.5/.6/.7/.8       | Existing command/event seam map, exact candidate tests, dependency provenance                   | Combined MAIL handoff and allocator-reviewed migration metadata           |
| R1-A          | SP-02.1/.2/.3          | Metadata/access truth table and atomic current-service creation                                 | R0 and design gates, CSRF/session/record ceiling tests                    |
| R1-B          | SP-02.4/.5/.7/.8       | Existing-scope sharing, archive/restore and audit in current settings shell                     | Revocation, concurrency, recovery and language journeys                   |
| R1-C          | SP-03.1/.2/.3/.7/.8    | Versioned legacy view adapter, personal/shared definitions, scoped export                       | Query/field authority and execution/download rechecks                     |
| R1-D          | SP-04.1/.2/.3/.4/.8    | Immutable basic template preview/install/diff with stable mapping                               | Idempotent DB transactions, local override and interruption proof         |
| R2-CMD        | SP-07.1/.2/.3          | Consume existing versioned WF event/outbox admission and shared CRM command boundary            | Existing owner exports actually exist; rollback emits no event            |
| R2-SCHEDULE   | SP-07.4/.5             | Current-builder preview, explicit activation and qualified durable scheduling                   | Date intent, restart, cancellation and current authority checks           |
| R2-EFFECT     | SP-07.6/.7/.8          | One qualified effect at a time with domain attempt/outcome history                              | Actual IG capability and provider evidence; unknown never blindly retries |
| R3-HISTORY    | SP-08.1/.2/.3          | Metric dictionary and exact stage-event capture with legacy labels                              | Event provenance, stage evolution and permission-aware record query       |
| R3-METRICS    | SP-08.4/.5             | Funnel/aging and reconciled opening-to-closing movement                                         | Hand-calculated PostgreSQL fixtures and drill-down parity                 |
| R3-FORECAST   | SP-08.6/.7/.8          | Immutable scenario snapshot, assumptions and accessible report/export                           | Currency separation, revocation and measured workload bounds              |
| R4-SOURCE     | SP-12.1/.2             | Named permitted product source and explicit identity/event/deletion contract                    | Actual data owner and permitted source; synthetic data cannot substitute  |
| R4-INGEST     | SP-12.3/.4             | Bounded replay-safe ingestion and versioned explainable qualification                           | Quarantine, suppression/deletion replay and rate-limit tests              |
| R4-PQL        | SP-12.5/.6/.7/.8       | Evidence queue and explicitly activated qualified follow-up                                     | Source outage, flapping, opt-out and non-causal measurement disclosure    |
| R5-DECISION   | SP-14.1/.2/.3          | Deployment/DB tenancy comparison, threat model and complete surface registry                    | Real operator requirements and explicit architecture acceptance           |
| R5-MIGRATION  | SP-14.4                | Additive default-workspace ownership backfill and scoped references                             | Every legacy row attributable, checkpoint/interruption/restore proof      |
| R5-BOUNDARIES | SP-14.5                | Server membership scope for requests, jobs, files, search/cache, WS, exports, tokens and MCP    | Adversarial deny tests for every surface, no unknown-scope work           |
| R5-EXPERIENCE | SP-14.6/.7/.8          | Current-shell invite/switch/leave/recover with context reset                                    | Concurrent switch/revoke, old client, last owner and recovery proof       |
| QA-AUTHORITY  | SP-15.1/.2/.3          | Evidence/deny-test registry, regional and accessible state acceptance                           | Real reviewer and working-browser evidence remains distinct               |
| QA-OPERATIONS | SP-15.4/.5/.6          | Bounded benchmarks, recovery rehearsal and redacted disablement diagnostics                     | Declared hardware, measured recovery, operator ownership                  |
| QA-RELEASE    | SP-15.7/.8             | Versioned release manifest, docs, notices and capability handoff                                | Applicable G0-G5 gates pass for the exact candidate                       |

SP-09, SP-10, SP-11 and SP-13 retain their eight domain increments and full
approved scope. Real-source, participant, portal isolation or provider gates
may wait while independent increments progress. No whole project is dropped
because it was originally described as a later option.
