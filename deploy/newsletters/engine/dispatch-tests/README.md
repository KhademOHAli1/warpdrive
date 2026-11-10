# Dispatch consent regression checks

Apply the numbered engine patches to the pinned Listmonk source before running these checks.

- Run `go test ./cmd ./internal/manager ./internal/messenger/email` from the patched source. The manager tests use a fake messenger and exercise live consent denial, lookup failure, exact test addresses, and envelope recipient preservation.
- Run `python3 verify-sql.py /path/to/patched/listmonk` and `python3 verify-races.py /path/to/patched/listmonk` with the PostgreSQL connection configured through standard `PG*` variables. Use a local disposable test database where the test role can create schemas. The first script rolls back its schema. The second drops its unique schema and terminates its own connections in cleanup.

These checks exercise the actual patched SQL on the pinned schema. They cover due campaign selection after a list is archived, enabled and confirmed eligibility, revocation or address change after batching, stale campaign control, and the row locks that retain original unsubscribe context during concurrent edits.

The worker checks current consent immediately before handing a message to the configured transport. A provider can accept or retry a handed-off message after that check. The worker pauses on a failed consent lookup and emits no message for that lookup. Delivery already handed off remains subject to the engine's existing checkpoint and transport behavior.
