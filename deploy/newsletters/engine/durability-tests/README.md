# Durable delivery regression

Run the packed derived engine against a disposable PostgreSQL database and a loopback SMTP fixture.

```sh
python3 -B deploy/newsletters/engine/durability-tests/verify.py \
  --engine /path/to/listmonk --pg-bin /path/to/postgresql/bin
```

The fixture exercises legacy campaign quarantine, atomic recipient admission, pause and resume, SIGKILL after SMTP DATA, a lost SMTP reply, a definite SMTP rejection and retry, and receipt anonymization after subscriber deletion. Only synthetic `example.test` addresses reach the relay fixture.
