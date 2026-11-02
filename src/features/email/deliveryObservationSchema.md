# Delivery observation schema qualification

Migration92 is generated and source-inspected. It has not been applied or qualified by PostgreSQL in this task. Ingest, read and review APIs remain unregistered fail-closed scaffolds pending their behavioral RED runs.

The forward migration must retain these SQL-only details alongside the generated snapshot:

- Source/account deletion cascades the report and its review history. Target-attempt deletion preserves every review row and revision.
- `email_delivery_review_attempt_same_account_fk` is the composite `(attempt_id, account_id)` reference to `email_send_attempts(id, account_id)`, with `ON DELETE SET NULL (attempt_id)` only. PostgreSQL16 documents this [column-subset action](https://www.postgresql.org/docs/16/ddl-constraints.html#DDL-CONSTRAINTS-FK). The Drizzle source/snapshot records coarse `set null`; clearing both columns would violate the non-null account identity.
- The new `email_send_attempts_id_account_uq` parent constraint must exist before that composite foreign key is installed. The existing `email_messages_id_account_uq` must not be duplicated.
- Report evidence cannot be updated. Review verdict, revision, recipient and snapshot hash cannot be updated. The sole review pointer cleanup permitted after target deletion clears `attempt_id` while retaining all other audit fields. New associations still require a live submitted target.
- Review projection selects the latest revision before filtering an attempt. A missing target becomes `unavailable`; it never reveals the saved recipient/hash or resurrects an older association.

The generator initially emitted unbound parameter placeholders for interpolated numeric CHECK bounds. Schema source now renders those compile-time constants as SQL literals. The final92 SQL/snapshot contains numeric limits, no `$n` placeholders, and installs the parent unique before its referencing FK. All180 earlier SQL/snapshot files and the historical journal prefix were byte-identical at the source checkpoint.

## SQL-only guard expectations

`public.email_delivery_report_guard()` and trigger `email_delivery_reports_immutable` reject every UPDATE and every direct DELETE. Nested source/account deletion may cascade only once its corresponding parent is absent.

`public.email_delivery_review_guard()` and trigger `email_delivery_reviews_immutable` reject direct DELETE and arbitrary UPDATE, including manual pointer clearing. Its sole update exception requires nested trigger execution, an existing non-null pointer becoming null, absence of that target, and equality of every other column. Its DELETE exception permits only a nested report/account cascade after the parent disappears. Both functions use a fixed `pg_catalog, public` search path and schema-qualified parent lookups. PostgreSQL documents [trigger nesting depth](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-SESSION-TABLE); native tests must still prove the actual FK/cascade interaction.

Migration/restore qualification must retain both functions and enabled BEFORE ROW UPDATE/DELETE triggers. Check `pg_get_functiondef`, `pg_get_triggerdef`, function search-path configuration and trigger enabled state. A generated snapshot does not contain these guards.

The target FK catalog check must return `confdeltype = 'n'`, `convalidated = true`, and exactly `['attempt_id']` for `cleared_columns`:

```sql
SELECT c.confdeltype, c.convalidated,
  ARRAY(
    SELECT a.attname::text
    FROM unnest(c.confdelsetcols) WITH ORDINALITY AS selected(attnum, ordinal)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = selected.attnum
    ORDER BY selected.ordinal
  ) AS cleared_columns
FROM pg_constraint c
WHERE c.conrelid = 'public.email_delivery_reviews'::regclass
  AND c.conname = 'email_delivery_review_attempt_same_account_fk';
```

The prepared target-purge regression associates A, replaces it with B, deletes B, and checks that revision2 survives with its snapshots unchanged and no association to A reappears. A stale revision1 write must still conflict, while a confirmed revision2 write may append revision3. The regression has not run.

Required native outcomes remain open: direct report/review mutation fails, source/account privacy cascades complete, and target deletion changes only the nullable pointer. The target-purge regression and subsequent storage/review/read suites have not run. Generated metadata and source inspection cannot establish these runtime contracts.
