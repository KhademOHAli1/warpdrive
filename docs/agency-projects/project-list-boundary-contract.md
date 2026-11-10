# Project list input and cursor boundary

2 November 2026. Private AP-02.5 implementation of input and continuation boundaries. The complete permission-filtered list, deliverable/work-queue reads, native routes and Main acceptance remain open.

## Actual exports

`persistence/projectListInput.ts` exports `projectListFilterSchema`, `projectListRequestSchema`, `projectListFilterKey` and their inferred types. Parse raw requests or saved filters at their ingress; internal consumers use the parsed values. Unknown fields, operators, authority flags and financial selectors fail validation rather than resetting to a broader view.

| Value | Version 1 contract |
| --- | --- |
| Saved filter | Required `schemaVersion: 1`; a nonempty, duplicate-free state selection; nullable owner UUID and nullable tagged CRM anchor. |
| Default states | `planned`, `active`, `on-hold`, matching the existing workspace proposal. Completed, canceled and archived require explicit selection. |
| Owner / anchor | Shared UUID normalization; anchor kind is exactly deal, person or organization. Both anchor kind and identity bind continuation. |
| Page size | Integer 1 through 100; default 25. |
| Cursor request field | Null or a nonempty string of at most 2048 characters. Decoding the encoded payload is its separate raw-data boundary. |

State order normalizes to the declared lifecycle order. Equivalent validated filters produce one fixed-field-order key; changed state, owner or anchor filters require a fresh continuation. These values grant no authority and are not session, module, permission or Privacy proofs.

`persistence/projectListCursor.ts` exports the cursor schema, `decodeProjectListCursor` and `encodeProjectListCursor`. Decode requires canonical unpadded base64url, at most 1024 decoded bytes, valid UTF-8 and a strict versioned JSON object. Invalid input returns the bounded `invalid_project_list_input` Result. The embedded filter key must equal the current normalized filter key.

The cursor carries only version, a canonical UTC instant with all six fractional digits, the UUID tie key and normalized filter key. Years 0001 through 9999 and real calendar instants are accepted. Offset timestamps, invalid dates, leap-second aliases, wrong precision and trailing line terminators are rejected. Shared UUID normalization remains consistent with other Agency boundaries.

Encoding consumes trusted, already decoded database facts and does not reparse them. The future repository must obtain the timestamp from PostgreSQL without a JavaScript `Date` or millisecond conversion. The intended query projection is `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`; continuation compares the original `(created_at, id)` tuple in descending order. Cursor transport unit tests do not prove that database behavior.

Cursor encoding and decoding are server-side helpers. The token is a continuation, not a secret, authorization credential or cross-page snapshot. No request-provided actor or allow flag is an accepted input field. Locale, calendar, digits and displayed timezone do not alter canonical cursor instants.

## Required native list implementation

The page SELECT still needs current accepted staff/session/module admission, local ownership or exact membership, and every explicitly linked CRM and applicable Privacy ceiling before ordering and limit. CRM administrator behavior cannot bypass local project access. A permitted deal cannot rescue a denied person or organization. Null optional links are neutral; missing, deleted or denied linked records suppress the project.

The existing per-project authorization callback cannot be used to postfilter a capped page. The participating native transaction and a trusted Privacy SQL ceiling remain integrator-owned dependencies. Without that binding the repository must fail before querying private projects. No production list repository, SQL adapter or route is supplied by these boundaries.

The eventual minimal page has items and a continuation from the last emitted row. It exposes no total, hidden-row count, scan cursor, reasons, replay payload or financial projection. Real PostgreSQL tests must cover sub-millisecond rows, identical-time UUID ties, hidden-row starvation before limit, all-link denial, current revocation and lookahead handling.

## Evidence and remaining gates

The exact draft bodies passed 101 pure unit cases in two ignored runtime suites before source adoption. The four source files preserve those production semantics; an independent source review found no defect. After a warning2/Q36 gate left the first formatting attempt unstarted, fresh normal-pressure admission allowed Biome4 to pass with formatting, followed by all 101 cases in two actual source files. The declared Next type generation/full TSC and configured typed ESLint of the entire private Agency module then passed on the unchanged139-input/132-TS cut. No database, native authority, route or Main acceptance follows from this private qualification.

The task-workspace receipts are `work/agency-project-list-prep-20261102/unit-1/result.json`, `COPY_MANIFEST.json`, `biome-source-1/admission-result.json`, `biome-source-2/result.json` and `source-unit-1/result.json`. They retain the exact preparation and execution cuts. The source-unit command took 0.88 seconds; its process group was observed empty at 10.866 seconds with all 139 module inputs and prior configurations unchanged. No unchanged database rerun is required for this source increment.

Full private static evidence is `work/agency-static-current-20261102/actual-r3/result.json`, one-use allocation `AGENCY-R3-CURRENT139-20261102-1`: typecheck4.77s, typed ESLint7.75s, both process groups gone/all139 source and configuration pins unchanged/three foreign containers preserved at135.287s. No aggregate peak RSS was measured. No source changes or native reruns occurred during that allocation.

This is a partial contribution to [canonical task agency/AP-02.5, issue #756](https://github.com/KhademOHAli1/warpdrive/issues/756), mapped by committed Main `76e037b` and verified open with its unique registered marker. An ordinary source commit can use `Refs #756`; [AP-02 package #70](https://github.com/KhademOHAli1/warpdrive/issues/70) remains the parent. All original 12 work packages and 96 tasks remain in scope. It does not establish AP-02.5 acceptance, a release, deployment or completed user journey.
