#!/usr/bin/env python3
"""Restore synthetic CRM receipts, the engine database and media into passive isolation."""

import argparse
import base64
from contextlib import ExitStack
from hashlib import sha256
import json
from pathlib import Path
import runpy
import shutil
import struct
import tempfile
import tomllib
from urllib.request import Request
from uuid import uuid4
import zlib

smoke = runpy.run_path(str(Path(__file__).with_name("engine-smoke.py")))
ROOT = Path(__file__).resolve().parents[2]
def png_chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


PNG = (
    b"\x89PNG\r\n\x1a\n"
    + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    + png_chunk(b"IDAT", zlib.compress(b"\x00\x30\x70\x90"))
    + png_chunk(b"IEND", b"")
)


def upload(origin, token):
    boundary = "fixture-" + uuid4().hex
    data = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"fixture.png\"\r\n"
        "Content-Type: image/png\r\n\r\n"
    ).encode() + PNG + f"\r\n--{boundary}--\r\n".encode()
    request = Request(
        origin + "/api/media", method="POST", data=data,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": "Basic " + base64.b64encode(f"fixture_api:{token}".encode()).decode(),
        },
    )
    with smoke["LOCAL_HTTP"].open(request, timeout=5) as response:
        return json.load(response)["data"]


def exercise(args, directory, stack):
    (directory / "uploads").mkdir()
    sql, origin, token, pit = smoke["smtp_fixture"](
        args.engine.resolve(), args.mailpit.resolve(), args.postgres_bin.resolve(), directory, stack
    )
    list_id, _ = smoke["create_list"](sql, "Restore qualification")
    blocked, _, _ = smoke["subscriber"](sql, "restore-blocked", "blocklisted", [(list_id, "unsubscribed")])
    media = upload(origin, token)
    _, original_image = smoke["http"](origin, f"/uploads/{media['filename']}")
    assert original_image == PNG

    config = tomllib.loads((directory / "config.toml").read_text())
    port = str(config["db"]["port"])
    pg = args.postgres_bin.resolve()
    environment = smoke["clean_env"]()
    admin = {**environment, "PGHOST": "127.0.0.1", "PGPORT": port, "PGUSER": "fixture_admin", "PGDATABASE": "postgres"}
    def run(program, *arguments, env=admin, timeout=45, input=None):
        return smoke["command"]([pg / program, *arguments], env, directory, timeout=timeout, input=input).stdout.strip()

    source_crm = "restore_crm_source"
    target_crm = "restore_crm_target"
    target_engine = "restore_engine_target"
    for db in (source_crm, target_crm, target_engine):
        run("createdb", db)
    for extension in ("pgcrypto", "citext"):
        run("psql", "-Xq", "-v", "ON_ERROR_STOP=1", "-d", source_crm, "-c", f"CREATE EXTENSION {extension}")
    smoke["command"](
        [
            args.bun.resolve(), "--no-env-file", "-e",
            """
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
const pool = new Pool({connectionString: process.argv[1]});
try { await migrate(drizzle(pool), {migrationsFolder:"drizzle"}); }
finally { await pool.end(); }
""",
            f"postgres://fixture_admin@127.0.0.1:{port}/{source_crm}",
        ],
        {**environment, "BUN_OPTIONS": "--no-env-file"}, ROOT, timeout=90,
    )
    operation = str(uuid4())
    run("psql", "-Xq", "-v", "ON_ERROR_STOP=1", "-d", source_crm, "-c",
        f"""INSERT INTO newsletter_operation_receipts
             (actor_id,operation_id,operation,intent_fingerprint,state,finished_at)
             VALUES ('{uuid4()}','{operation}','campaigns.test',decode(repeat('a1',32),'hex'),'unknown',now())""")
    backups = directory / "backups"
    backups.mkdir()
    files = []
    for source, target in ((source_crm, target_crm), (config["db"]["database"], target_engine)):
        dump = backups / f"{source}.dump"
        run("pg_dump", "-Fc", "-d", source, "-f", dump)
        files.append(dump)
        run("pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "-d", target, dump)
    media_archive = Path(shutil.make_archive(str(backups / "media"), "gztar", directory, "uploads"))
    files.append(media_archive)
    digests = {file.name: sha256(file.read_bytes()).hexdigest() for file in files}
    (backups / "sha256.json").write_text(json.dumps(digests))
    for file in files:
        assert sha256(file.read_bytes()).hexdigest() == digests[file.name]

    restored = directory / "restored"
    restored.mkdir()
    shutil.unpack_archive(media_archive, restored, filter="data")
    app_port = smoke["available_ports"](1)[0]
    restored_origin = f"http://127.0.0.1:{app_port}"
    restore_config = restored / "config.toml"
    restore_config.write_text(
        f'[app]\naddress="127.0.0.1:{app_port}"\n[db]\n'
        f'host="127.0.0.1"\nport={port}\nuser="fixture_admin"\n'
        f'database="{target_engine}"\nssl_mode="disable"\nmax_open=6\nmax_idle=3\n'
    )
    smoke["start"](stack, [args.engine.resolve(), "--config", restore_config, "--passive"], environment, restored, "engine")
    smoke["wait_for"]("passive restored engine", lambda: smoke["http"](restored_origin, "/health")[0] == 200)

    record = smoke["engine_api"](restored_origin, token, f"/api/subscribers/{blocked}")
    assert record["status"] == "blocklisted"
    assert run("psql", "-XAtq", "-d", target_engine, "-c",
               f"SELECT status FROM subscriber_lists WHERE subscriber_id={blocked} AND list_id={list_id}") == "unsubscribed"
    _, restored_image = smoke["http"](restored_origin, f"/uploads/{media['filename']}")
    assert restored_image == PNG
    assert run("psql", "-XAtq", "-d", target_crm, "-c",
               f"SELECT state FROM newsletter_operation_receipts WHERE operation_id='{operation}'") == "unknown"
    _, inbox = smoke["http"](pit, "/api/v1/messages")
    assert json.loads(inbox)["messages"] == []
    print("Restored both databases and exact media bytes. Suppression and unknown receipt survived passive startup.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("engine", "mailpit", "postgres-bin", "bun"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="warpdrive-newsletter-restore-") as temporary, ExitStack() as stack:
        exercise(args, Path(temporary), stack)


if __name__ == "__main__":
    main()
