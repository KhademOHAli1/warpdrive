# Private project list query and read-port contract

2 November 2026. The private implementation and twelve test definitions are prepared and source-reviewed; Biome passed. After the first test-variable inference error was corrected with an explicit type annotation, full type generation/TSC passed on147 inputs. Typed ESLint then reported five nullable-string assertions in one paging test file. Their explicit nonempty-string predicates preserve or strengthen the same assertions and type narrowing; fresh current-source qualification is pending. PostgreSQL execution has not started. This increment adds no authenticated route, enabled module, production read-port binding or completed AP-02.5 journey. Qualification is recorded separately from the already-passing 139-input R3 cut.

## Native binding boundary

`createProjectListRepository(port)` is a feature-owned reader. Its default and explicit null port return `project_unavailable` before any private SELECT. A supplied port must derive the current credential-authenticated accepted staff actor, live session, enabled module and current CRM facts, and retain the participating authority fence through transaction completion. Hydrating a user ID alone is not authentication.

The read callback receives one transaction-bound `db`, `actor`, `crmVisibility` and mandatory trusted `privacyCeiling: SQL`. The ceiling uses the fixed `project` SQL alias and must cover every applicable project and linked-record Privacy restriction. It has no permissive production default. Actor/CRM identity, active/session and administrator facts must be coherent. Browser actor IDs, allow flags, submitted SQL and case-review Discovery are not bindings.

The native port owns bounded, signal-aware connection acquisition/query execution/transaction completion and rollback of failed Results. It must not touch session or CRM/Privacy records to obtain read authority. Backend cancellation and through-commit revocation guarantees require the actual native binding and its own evidence; local abort checks or synthetic test ports do not prove them.

## One permission-filtered page

The query applies local ownership or exact actor/project membership, canonical CRM ceilings for every non-null explicit deal/person/organization link, and the trusted Privacy ceiling before saved filters, keyset order and limit. A native CRM administrator has no local-project bypass. Membership edit and coordinate flags are independent of read eligibility.

Linked records must exist and be undeleted. A linked deal needs an existing unarchived pipeline and the canonical record/pipeline visibility predicate. Won/lost or deal-level archive facts remain compatible with the canonical reference gate; no new CRM archive restriction is introduced. Every explicit link is AND-gated. A visible deal does not rescue a denied explicitly linked person or organization. EXISTS predicates avoid duplicate projects.

Only validated request filters enter this layer. Cursor decoding is a separate encoded-data ingress; changing normalized filters invalidates continuation. The reader performs no capped JavaScript postfilter and exposes no total, hidden count, scan position, financial data, reason or replay payload.

The fixed order is `created_at DESC, id DESC`. The database projection retains all six UTC fractional digits, and the keyset compares the original PostgreSQL timestamp/UUID tuple. A JavaScript Date must not construct the cursor. BC or out-of-range timestamps produce a decode failure instead of an incorrect AD cursor. Raw projected rows are decoded once at database ingress. The page fetches at most pageSize+1 authorized rows and creates continuation from the last emitted row, never from lookahead.

Each request reauthorizes current facts. A cursor is a continuation rather than a credential or cross-request snapshot. Membership, linked-record visibility or Privacy changes can remove rows on a later page. Updated-at changes do not move created-at ordering; newer inserts belong on a fresh first page.

## Real PostgreSQL scope

The two dedicated integration suites define twelve cases using the existing schemaCase fixture, actual transactions, canonical CRM records and raw PostgreSQL timestamp witnesses. Their injected session/module/fence/Privacy admission is explicitly synthetic. No test uses a mocked database or claims native credential or restriction-service acceptance.

The frozen fixture declares 98 SQL files plus the journal through 0097_private_mail_intake. All 99 files, 179975 bytes, match the frozen714eda0 source, requestedfe137bc and observedMaina7df229f exactly. This source equality does not establish an installed migration, canonical Agency model admission or a customer deployment. Private0099 remains the existing exercised overlay, with no new canonical DDL here.

Subsequent Mainbf386af adds0098_workflow_duration_wait, affecting onlyworkflow_runs. The old98SQL remain identical, while the current journal has99 entries. The admitted list-query fixture therefore retains its historical0000..0097/private0099 evidence ceiling. A separate ignored100-file/99-SQL source fixture was prepared at `.runtime/agency-persistence-main-base-0098-bf386af`; it is neither wired nor executed. The legacy setup has no base override, so a later explicit shared setup factory and matching verifier are needed for that fixture. Historical files were not replaced, and no current0098 database qualification is claimed.

The selection covers default closure, local owner/member and administrator isolation, independent CRM-link denials, CRM row preservation, injected Privacy SQL, saved filters, PostgreSQL microseconds/UUID ties, hidden-row starvation, lookahead continuation, current page-two facts, edit/new-insert stability and malformed/unrepresentable cursors. The exact PostgreSQL selection has not run yet. The first consumed allocation is recorded in task-workspace `work/agency-project-list-native-20261102/actual-1/result.json`; corrected `request-r2.json` and `CURRENT.json` retain the new source cut and the one-line type-only diff. A fresh integrator-owned finite static/native allocation is required before execution; the unchanged native17 suite is not part of it.

This is a partial contribution to [agency/AP-02.5, issue #756](https://github.com/KhademOHAli1/warpdrive/issues/756). Deliverable/work-queue reads, safe native label projection, routes, browser recovery, performance qualification and complete task acceptance remain open. All 12 work packages and 96 original tasks retain their full scope.
