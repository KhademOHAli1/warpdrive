# Isolated integration programme runtime

Practical restart guides: [فارسی](local-runtime.fa.md) and [Deutsch](local-runtime.de.md).

Profile selected and exercised on 31 October 2026. This is local qualification only.
No real provider configuration, external messages, public hostname or deployment is present.

## Ownership and addresses

| Service       | Address or resource                                                                   | Isolation                                 |
| ------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| App           | `http://127.0.0.1:3160`                                                               | This checkout only, Bun 1.4.4             |
| PostgreSQL    | `127.0.0.1:55436`, database `integration_program_preview`, role `integration_program` | New native PostgreSQL 18 cluster          |
| Worker        | `dist/worker.mjs`                                                                     | Separate process, this database only      |
| Realtime      | `ws://127.0.0.1:8080`                                                                 | Explicit `WS_HOST=127.0.0.1`              |
| S3 simulator  | `http://127.0.0.1:9160`, bucket `integration-program`                                 | Separate container and named volume       |
| Private state | `/tmp/warpdrive-integration-program-private`                                          | Directory mode 0700, env/config mode 0600 |

Existing ports 3104/3105, 3116, 3150, 5432, 55432, 55435 and 9000 belong to other
previews/services. Do not stop, replace or reconfigure those resources. Port 3150 was
present at initial inventory but absent at later runtime inventory; this programme did
not stop its process. Recheck current listeners before startup. The public listening
ports of disposable Testcontainers databases are test infrastructure, not the app.

The PostgreSQL client on the system PATH points to an obsolete PostgreSQL 14 build
with a missing ICU library. Use the installed PostgreSQL 18 binaries explicitly.
No global runtime or database tools were upgraded. Native PostgreSQL 18 qualification
and the separate PostgreSQL 16 Testcontainers suite are recorded independently.

## Restore dependencies and migrate

Run from `/tmp/warpdrive-integrations-preview-20261031`, or an independently restored
clone. Keep its owning Git metadata at `/tmp/warpdrive-integrations-20261031` until a
verified bundle restore has replaced it. `node_modules` is now an independent install;
the former shared symlink was detached without deleting its target.

```sh
export PATH=/tmp/warpdrive-bun144/bin:$PATH
bun --version # must be 1.4.4
bun install --frozen-lockfile
bun run build:workers
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/migrate.mjs
```

Use the `--env-file=...` spelling and an executable entrypoint. The tested migration
entrypoint ends with `migrations applied`. Merely printing Bun script help is not a
migration. Source migrations are forward-only; reset only the disposable profile.

## Recreate private configuration on a fresh profile

Do this only when recreating empty disposable data, never to replace keys for existing
credentials. No old provider credentials are copied. Keep the following generator in
a local shell or run it from these instructions; its output file must remain outside Git.

```sh
python3 - <<'PYCONFIG'
import base64, json, secrets
from pathlib import Path
p = Path('/tmp/warpdrive-integration-program-private')
p.mkdir(mode=0o700, exist_ok=True)
p.chmod(0o700)
if (p / 'runtime.env').exists():
    raise SystemExit('Existing profile configuration preserved; use it or choose a fresh profile')
key = lambda: base64.b64encode(secrets.token_bytes(32)).decode()
access, secret = secrets.token_hex(12), secrets.token_hex(24)
values = {
    'NODE_ENV': 'development', 'BASE_URL': 'http://127.0.0.1:3160',
    'DATABASE_URL': 'postgresql://integration_program@127.0.0.1:55436/integration_program_preview',
    'WS_HOST': '127.0.0.1', 'WS_PUBLIC_URL': 'ws://127.0.0.1:8080',
    'WS_TICKET_SECRET': secrets.token_hex(32), 'TOKEN_ENCRYPTION_KEY': key(),
    'OAUTH_SIGNING_KEY': key(), 'AUTH_SECRET': secrets.token_hex(32),
    'AUTH_GOOGLE_ENABLED': 'false', 'AUTH_MAIL_TRANSPORT': 'capture',
    'MINIO_ENDPOINT': 'http://127.0.0.1:9160', 'MINIO_ACCESS_KEY': access,
    'MINIO_SECRET_KEY': secret, 'MINIO_BUCKET': 'integration-program',
    'DISABLE_UPDATE_CHECK': 'true', 'DISABLE_TELEMETRY': 'true',
}
(p / 'runtime.env').write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
(p / 's3.json').write_text(json.dumps({'identities': [{
    'name': 'integration-program', 'credentials': [{'accessKey': access, 'secretKey': secret}],
    'actions': ['Admin', 'Read', 'Write', 'List', 'Tagging'],
}]}))
for name in ['runtime.env', 's3.json']:
    (p / name).chmod(0o600)
PYCONFIG
```

Create the fresh database once, after checking 55436 is free:

```sh
/opt/homebrew/opt/postgresql@18/bin/initdb -D /tmp/warpdrive-integration-program-private/postgres -U integration_program --auth=trust
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/warpdrive-integration-program-private/postgres -l /tmp/warpdrive-integration-program-private/postgres.log -o '-h 127.0.0.1 -p 55436 -k /tmp/warpdrive-integration-program-private' start
/opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55436 -U integration_program integration_program_preview
/opt/homebrew/opt/postgresql@18/bin/psql -h 127.0.0.1 -p 55436 -U integration_program -d integration_program_preview -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;'
```

Trust authentication is confined to the new loopback-only disposable cluster. It is
not a supported production authentication configuration.

## Start the S3 simulator

Use the already running `colima-warpdrive` context without switching global Docker
context. The image is pinned by digest and was already available locally. Host `/tmp`
is not shared into this VM, so use `docker cp` rather than an invalid host bind mount.
A temporary copy is readable by the container user but remains inside the private host
directory; the authoritative host configuration stays mode 0600.

```sh
docker --context colima-warpdrive create --name warpdrive-integration-program-s3 --label codex.owner=warpdrive-integration-program -p 127.0.0.1:9160:8333 -v warpdrive-integration-program-s3:/data chrislusf/seaweedfs@sha256:c2658820e763294a9e9de7b36c81e59b879e3459148351aee4e31a126ca64860 mini -dir=/data -s3.config=/tmp/s3.json -s3.allowedOrigins=http://127.0.0.1:3160 -bucket=integration-program
cp /tmp/warpdrive-integration-program-private/s3.json /tmp/warpdrive-integration-program-private/s3-container.json
chmod 644 /tmp/warpdrive-integration-program-private/s3-container.json
docker --context colima-warpdrive cp /tmp/warpdrive-integration-program-private/s3-container.json warpdrive-integration-program-s3:/tmp/s3.json
rm /tmp/warpdrive-integration-program-private/s3-container.json
docker --context colima-warpdrive start warpdrive-integration-program-s3
```

For an existing stopped profile, use `docker start` and `pg_ctl start`, not another
`create`/`initdb`. Remove only resources carrying this profile's exact names after
checking ownership. SeaweedFS is a local S3-compatible simulator; it does not qualify
MinIO production behavior, browser multipart uploads or a hosted storage service.

## Start the application services

Run each command in a separate terminal, from this checkout, with pinned Bun on PATH:

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/worker.mjs
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/ws.mjs
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env --bun node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3160
```

The WS entrypoint still uses internal port 8080. Check it is free before starting.
Stop only the process attached to the terminal or whose command/cwd and listener
match this profile. Do not broadly kill Bun, PostgreSQL, Docker or other previews.
Build before starting the dev app, since both own this checkout's `.next` directory.

## Run finite qualification

The operational smoke refuses every profile except the exact addresses above before
it writes fixtures. It also refuses nonempty users/provider/mail/revocation data. It
uses a synthetic account/session, the real separate worker, authenticated native WS
and a real S3 object, then cleans its fixtures. It never installs a real provider.

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env scripts/integration-profile-smoke.ts
DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock TESTCONTAINERS_RYUK_DISABLED=true bun run test:integration src/db/integrationWorkflowMigration.integration.test.ts src/features/integrations src/features/workflows src/server/ws --maxWorkers=2
```

`TESTCONTAINERS_RYUK_DISABLED=true` avoids unrelated VM lifecycle issues; each suite
stops its own container. Inspect containers after an interrupted run and remove only
containers identified as this programme's tests, never broad Docker cleanup.

For production compilation only, use a separately generated private build env derived
from these synthetic values with `NODE_ENV=production`, `BASE_URL=https://127.0.0.1:3160`,
`AUTH_MAIL_TRANSPORT=smtp`, `AUTH_SMTP_HOST=127.0.0.1` and
`SEED_ADMIN_EMAIL=build@example.invalid`. This satisfies compile-time production guards;
it establishes no running TLS or SMTP service. The preview itself remains development
mode with captured auth mail. Keep build and runtime configuration separate.
