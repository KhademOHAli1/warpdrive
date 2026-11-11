# Internal operational event regression

The private outbox adds capability `operationalEvents:1` and delivery schema migration 5. Its GET uses `settings:get`; ACK uses `settings:manage`, both already present in the documented backend role. It never sends an email alarm and exposes no mailbox, campaign/subscriber ID, provider body, credential or raw failure text.

Run against the exact packed engine with isolated PostgreSQL tools:

```sh
python3 -B deploy/newsletters/engine/operational-tests/verify.py \
  --engine /path/to/packed/listmonk --pg-bin /path/to/postgresql/bin
```

The runner owns its temporary PostgreSQL cluster and passive loopback engine. It proves actual RBAC, strict bounded inputs, GET purity, concurrent/idempotent ACK and lost-ACK replay/restart, transaction rollback/source-outbox atomicity, privacy, ordinary-acceptance silence, review-only resolution, receipt-preserving passive expiry observation, acceptance/sweep locking, bounded paging and late lower-sequence commits. Its source fixtures are synthetic and no SMTP transaction is started.

The patch also includes `internal/sesfeedback/operational_events_test.go` for signed hard bounce, semantic duplicates, unmatched complaint attention followed by a distinct exact matched complaint, forged-signature rejection, source/outbox atomic failure and recovery. Use the existing isolated signed-feedback runner with the exact patched source:

```sh
python3 -B deploy/newsletters/engine/feedback-tests/verify.py \
  --engine /path/to/packed/listmonk --pg-bin /path/to/postgresql/bin \
  --source /path/to/exact/patched/source --go /path/to/go
```

The background scan appends at most 100 retained delivery issues for one campaign and 100 retained feedback facts per pass. It acquires the existing campaign lock before reading delivery facts. It modifies only the outbox, including on a passive restore. Delivery retry, unknown submission and consent/erasure behavior remain owned by their existing paths. Operational ACK is transport acknowledgement after the native consumer commits, independent of a user's seen/unseen state. Acknowledged source hashes remain for deduplication.

`provider_accepted` records an actual SMTP acceptance or exact signed provider handoff. It establishes no inbox delivery. Operator outcomes remain separately named. Unmatched feedback supplies attention only and establishes no Person attribution or suppression. Historical source qualification and the published v1.6.1 artifact remain unchanged; this new patch requires its own exact qualification.
