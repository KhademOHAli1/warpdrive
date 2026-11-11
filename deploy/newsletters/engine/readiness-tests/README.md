# Newsletter readiness regression

Run the packed derived engine with disposable PostgreSQL, a temporary media directory, and a loopback relay that rejects message transactions.

```sh
python3 -B deploy/newsletters/engine/readiness-tests/verify.py \
  --engine /path/to/listmonk --pg-bin /path/to/postgresql/bin
```

The fixture checks passive and active scheduler status, the real database schema, filesystem access, a no-send SMTP probe, relay outage, the effective delivery budget, and the 15-minute SMTP acceptance history.
