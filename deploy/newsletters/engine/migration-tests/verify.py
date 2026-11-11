#!/usr/bin/env python3
"""Qualify explicit engine migration and admission against owned native PostgreSQL."""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import select
import secrets
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from consent import Fixture, assert_equal, wait_until


UPSTREAM_SCHEMA_SHA256 = "8ac314ff9512ee97621ede34ecb005e3a8b3f9562928b35f8265548327368475"
FENCE_KEY = (900731613, 90)
DELIVERY_KEY = (900731613, 50)
RECEIPT = "public.warpdrive_engine_schema"
REQUIRED_INDEX = "warpdrive_delivery_smtp_recent"


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def checksum(raw):
    return hashlib.sha256(raw).hexdigest()


def write_report(path, results):
    """Publish a complete private report without replacing any existing path."""
    encoded = (json.dumps(results, indent=2, sort_keys=True) + "\n").encode("utf8")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".migration-report-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(encoded)
            destination.flush()
            os.fsync(destination.fileno())
        # Both paths are in one directory. link() is atomic and fails if any file
        # or symlink already occupies the destination; replace() could overwrite it.
        os.link(temporary, path)
    finally:
        temporary.unlink()


class MigrationFixture(Fixture):
    def __init__(self, root, engine, pg_bin):
        super().__init__(root, engine, pg_bin)
        # The normal process reserves one connection for its lifecycle fence.
        self.env.update({
            "LISTMONK_db__max_open": "4",
            "LISTMONK_db__max_idle": "2",
            "NEWSLETTER_DELIVERY_ENABLED": "false",
            "NEWSLETTER_PUBLIC_SIGNUP_ENABLED": "false",
            "NEWSLETTER_SES_FEEDBACK_ENABLED": "false",
        })

    def command(self, flags, database="consent", timeout=25):
        env = {**self.env, "LISTMONK_db__database": database}
        return subprocess.run(
            [str(self.engine), "--config", "", *flags], cwd=self.root, env=env,
            capture_output=True, text=True, timeout=timeout, check=False,
        )

    def migrate(self, database="consent", success=True):
        result = self.command(["--migrate", "--yes"], database)
        if success:
            assert_equal(result.returncode, 0, "explicit migration exit")
        elif result.returncode == 0:
            raise AssertionError("Explicit migration accepted an invalid schema")
        return result

    def stop_engine(self):
        if self.serve is not None and self.serve.poll() is None:
            self.serve.terminate()
            try:
                self.serve.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.serve.kill()
                self.serve.wait(timeout=5)

    def launch(self, env=None):
        self.stop_engine()
        self.serve = subprocess.Popen(
            [str(self.engine), "--config", "", "--passive"], cwd=self.root,
            env=self.env if env is None else env, stdout=self.log, stderr=subprocess.STDOUT,
        )
        return self.serve

    def ready(self, env=None):
        self.launch(env)
        wait_until(self.healthy, "admitted passive engine", seconds=10)
        # Survive multiple monitor ticks rather than trusting a startup log line.
        deadline = time.monotonic() + 2.5
        while time.monotonic() < deadline:
            assert_equal(self.healthy(), True, "sustained passive health")
            time.sleep(0.2)

    def rejected_start(self, label):
        before = self.snapshot()
        process = self.launch()
        try:
            code = process.wait(timeout=9)
        except subprocess.TimeoutExpired as error:
            self.stop_engine()
            raise AssertionError(f"{label}: ordinary startup did not reject") from error
        assert_equal(code, 1, f"{label}: startup exit")
        assert_equal(self.snapshot(), before, f"{label}: rejected startup writes nothing")

    def snapshot(self, database="consent"):
        """Digest schema, table tuples and sequences; retain no fixture credentials."""
        dumped = self.run([
            str(self.pg_bin / "pg_dump"), "-h", str(self.socket), "-p", "5432",
            "-U", "consentproof", "-d", database, "--schema-only", "--no-owner",
            "--no-privileges", "--no-comments", "--no-security-labels",
        ]).stdout
        # Newer PostgreSQL clients randomize only these dump guard tokens.
        schema = "\n".join(line for line in dumped.splitlines()
                           if not line.startswith(("\\restrict ", "\\unrestrict ")))
        result = {"schema": checksum(schema.encode())}
        tables = json.loads(self.sql(
            "SELECT COALESCE(json_agg(tablename ORDER BY tablename),'[]'::json) "
            "FROM pg_tables WHERE schemaname='public'", database,
        ))
        for table in tables:
            # xmin also detects a same-value UPDATE, not just changed row values.
            rows = self.sql(
                "SELECT COALESCE(jsonb_agg(jsonb_build_array(to_jsonb(t),t.xmin::text) "
                "ORDER BY to_jsonb(t)::text,t.xmin::text),'[]'::jsonb)::text "
                f"FROM public.{identifier(table)} t", database,
            )
            result["table:" + table] = checksum(rows.encode())
        sequences = json.loads(self.sql(
            "SELECT COALESCE(json_agg(sequencename ORDER BY sequencename),'[]'::json) "
            "FROM pg_sequences WHERE schemaname='public'", database,
        ))
        for sequence in sequences:
            result["sequence:" + sequence] = self.sql(
                f"SELECT last_value||':'||is_called FROM public.{identifier(sequence)}", database,
            )
        return result

    def receipt(self, database="consent"):
        raw = self.sql(f"SELECT to_jsonb(r)::text FROM {RECEIPT} r", database)
        if not raw:
            raise AssertionError("Explicit migration receipt is absent")
        receipt = json.loads(raw)
        assert_equal(receipt["singleton"], True, "receipt singleton")
        assert_equal(receipt["version"], 1, "receipt format")
        assert_equal(receipt["upstream_version"], "v6.2.0", "receipt upstream version")
        for field in ("installer_sha256", "catalog_sha256"):
            value = receipt[field]
            if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
                raise AssertionError(f"Invalid {field} in explicit receipt")
        if not receipt.get("installed_at"):
            raise AssertionError("Explicit receipt has no installation time")
        return receipt


@contextmanager
def held_lock(fixture, key):
    """Hold a session lock only inside this runner's disposable cluster."""
    holder = subprocess.Popen(
        fixture.psql_args(), cwd=fixture.root, env=fixture.env, text=True,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    try:
        holder.stdin.write(
            f"DO $$ BEGIN PERFORM pg_advisory_lock({key[0]},{key[1]}); END $$;\n"
            "\\echo migration_fixture_locked\n"
        )
        holder.stdin.flush()
        readable, _, _ = select.select([holder.stdout], [], [], 5)
        if not readable or holder.stdout.readline().strip() != "migration_fixture_locked":
            raise AssertionError("Could not acquire the disposable migration fixture lock")
        yield holder
    finally:
        try:
            if holder.poll() is not None:
                raise AssertionError("Fixture advisory-lock session exited before release")
            try:
                holder.stdin.write(f"SELECT pg_advisory_unlock({key[0]},{key[1]});\n\\q\n")
                holder.stdin.flush()
                assert_equal(holder.wait(timeout=5), 0, "fixture advisory-lock session exit")
            except (BrokenPipeError, subprocess.TimeoutExpired) as error:
                try:
                    holder.kill()
                except ProcessLookupError:
                    pass
                try:
                    holder.wait(timeout=5)
                except subprocess.TimeoutExpired as timeout:
                    raise AssertionError("Could not verify fixture lock-session cleanup") from timeout
                raise AssertionError("Fixture lock-session release required forced termination") from error
        finally:
            holder.stdin.close()
            holder.stdout.close()


def prove_fresh_migration(fixture):
    database = "migration_fresh"
    fixture.sql(f"CREATE DATABASE {database}", "postgres")
    fixture.migrate(database)
    fixture.receipt(database)
    before = fixture.snapshot(database)
    fixture.migrate(database)
    assert_equal(fixture.snapshot(database), before, "fresh repeated migration is no-write")


def prove_legacy_fence(fixture, schema):
    database = "migration_legacy"
    fixture.sql(f"CREATE DATABASE {database}", "postgres")
    # This is the exact verified upstream schema, not a fabricated extension ledger.
    fixture.run(fixture.psql_args(database), input=schema)
    fixture.sql("""
        INSERT INTO settings(key,value) VALUES('migrations','["v6.2.0"]'::jsonb)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
        INSERT INTO campaigns(id,uuid,name,subject,from_email,body,status,messenger,
                              sent,started_at,last_subscriber_id,send_at)
        VALUES
          (999,gen_random_uuid(),'Prior running','Legacy','sender@example.test','Prior',
           'running','email',1,NOW(),0,NULL),
          (1000,gen_random_uuid(),'Prior cursor','Legacy','sender@example.test','Prior',
           'scheduled','email',0,NULL,7,NOW()+interval '1 hour'),
          (1001,gen_random_uuid(),'Fresh scheduled','Fresh','sender@example.test','Fresh',
           'scheduled','email',0,NULL,0,NOW()+interval '1 hour');
    """, database)
    fixture.migrate(database)
    fixture.receipt(database)
    assert_equal(fixture.sql(
        "SELECT string_agg(id||':'||status||':'||sent||':'||last_subscriber_id,',' ORDER BY id) "
        "FROM campaigns WHERE id IN(999,1000,1001)", database,
    ), "999:paused:1:0,1000:paused:0:7,1001:scheduled:0:0", "legacy campaign fence")
    assert_equal(fixture.sql(
        "SELECT string_agg(campaign_id||':'||hold,',' ORDER BY campaign_id) "
        "FROM warpdrive_delivery_runs WHERE campaign_id IN(999,1000,1001)", database,
    ), "999:legacy,1000:legacy", "only started legacy campaigns are held")
    before = fixture.snapshot(database)
    fixture.migrate(database)
    assert_equal(fixture.snapshot(database), before, "legacy repeated migration is no-write")


def prove_noop_and_upgrade(fixture):
    fixture.stop_engine()
    fixture.receipt()
    before = fixture.snapshot()
    fixture.migrate()
    assert_equal(fixture.snapshot(), before, "same-source migration preserves all tuples and schema")
    result = fixture.command(["--upgrade", "--yes"])
    assert_equal(result.returncode, 0, "explicit upstream upgrade exit")
    fixture.receipt()
    fixture.ready()
    fixture.stop_engine()


def prove_admission_failures(fixture):
    fixture.sql(f"DROP TABLE {RECEIPT}")
    fixture.rejected_start("missing receipt table")
    fixture.migrate()
    fixture.receipt()
    fixture.ready()
    fixture.stop_engine()

    receipt = fixture.sql(f"SELECT to_jsonb(r)::text FROM {RECEIPT} r")
    fixture.sql(f"DELETE FROM {RECEIPT}")
    fixture.rejected_start("missing receipt row")
    before = fixture.snapshot()
    fixture.migrate(success=False)
    assert_equal(fixture.snapshot(), before, "invalid empty receipt is not silently repaired")
    fixture.sql(f"INSERT INTO {RECEIPT} SELECT * FROM json_populate_record("
                f"NULL::{RECEIPT},{literal(receipt)}::json)")

    fixture.sql(f"UPDATE {RECEIPT} SET version=2")
    fixture.rejected_start("future receipt")
    before = fixture.snapshot()
    fixture.migrate(success=False)
    assert_equal(fixture.snapshot(), before, "future receipt is not overwritten")
    fixture.sql(f"UPDATE {RECEIPT} SET version=1")

    index_sql = fixture.sql(
        f"SELECT pg_get_indexdef({literal('public.' + REQUIRED_INDEX)}::regclass)"
    )
    fixture.sql(f"DROP INDEX public.{identifier(REQUIRED_INDEX)}")
    fixture.rejected_start("required index catalog drift")
    before = fixture.snapshot()
    fixture.migrate(success=False)
    assert_equal(fixture.snapshot(), before, "same-source catalog drift cannot be blessed")
    fixture.sql(f"DROP TABLE {RECEIPT}")
    fixture.migrate(success=False)
    assert_equal(fixture.sql(f"SELECT to_regclass({literal(RECEIPT)}) IS NULL"), "t",
                 "invalid catalog cannot acquire a fresh receipt table")
    assert_equal(fixture.sql(
        f"SELECT to_regclass({literal('public.' + REQUIRED_INDEX)}) IS NULL"
    ), "t", "versioned migration does not silently recreate missing index")
    fixture.sql(index_sql)
    fixture.migrate()
    fixture.receipt()
    fixture.ready()
    fixture.stop_engine()


def prove_restricted_no_ddl_start(fixture):
    runtime = "migration_runtime"
    fixture.sql(f"""
        CREATE ROLE {runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
        REVOKE CREATE ON DATABASE consent FROM PUBLIC;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        GRANT CONNECT ON DATABASE consent TO {runtime};
        GRANT USAGE ON SCHEMA public TO {runtime};
        GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {runtime};
        GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO {runtime};
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {runtime};
        CREATE SCHEMA migration_fixture;
        CREATE FUNCTION migration_fixture.deny_ddl() RETURNS event_trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF session_user='{runtime}' THEN
            RAISE EXCEPTION 'runtime attempted forbidden DDL';
          END IF;
        END $$;
        CREATE EVENT TRIGGER migration_fixture_deny_ddl ON ddl_command_start
        EXECUTE FUNCTION migration_fixture.deny_ddl();
    """)
    # Keep the test-only function outside the engine's public catalog fingerprint.
    # The event trigger rejects attempted DDL even when IF NOT EXISTS would be inert.
    before = fixture.receipt()
    env = {**fixture.env, "LISTMONK_db__user": runtime}
    try:
        for _ in range(2):
            fixture.ready(env)
            status, raw = fixture.request("/api/warpdrive/readiness", fixture.auth)
            assert_equal(status, 200, "restricted runtime readiness status")
            assert_equal(json.loads(raw)["data"]["database"]["status"], "ready",
                         "restricted runtime schema readiness")
            fixture.stop_engine()
        assert_equal(fixture.receipt(), before, "restricted startup preserves schema admission receipt")
    finally:
        fixture.stop_engine()
        fixture.sql("DROP EVENT TRIGGER migration_fixture_deny_ddl; "
                    "DROP FUNCTION migration_fixture.deny_ddl(); "
                    "DROP SCHEMA migration_fixture")


def prove_policy_and_sequence_drift(fixture):
    fixture.stop_engine()
    receipt = fixture.receipt()
    for label, change, restore in (
        ("RLS flag", "ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY",
         "ALTER TABLE public.subscribers DISABLE ROW LEVEL SECURITY"),
        ("RLS policy", "CREATE POLICY migration_fixture_policy ON public.subscribers USING (true)",
         "DROP POLICY migration_fixture_policy ON public.subscribers"),
        ("sequence configuration", "ALTER SEQUENCE public.subscribers_id_seq INCREMENT BY 2",
         "ALTER SEQUENCE public.subscribers_id_seq INCREMENT BY 1"),
    ):
        fixture.sql(change)
        try:
            fixture.rejected_start(label + " catalog drift")
            before = fixture.snapshot()
            fixture.migrate(success=False)
            assert_equal(fixture.snapshot(), before, label + " drift is not requalified")
        finally:
            fixture.sql(restore)
        assert_equal(fixture.receipt(), receipt, label + " drift preserves original receipt")
    fixture.ready()
    fixture.stop_engine()


def prove_runtime_excludes_migration(fixture):
    fixture.ready()
    try:
        before = fixture.snapshot()
        started = time.monotonic()
        result = fixture.command(["--migrate", "--yes"], timeout=12)
        if result.returncode == 0:
            raise AssertionError("Migration entered while a normal runtime held the fence")
        if time.monotonic() - started >= 12:
            raise AssertionError("Migration lock rejection was not bounded")
        assert_equal(fixture.snapshot(), before, "rejected migration preserves runtime state")
        assert_equal(fixture.healthy(), True, "rejected migration leaves runtime healthy")
    finally:
        fixture.stop_engine()


def wait_for_runtime_lock(fixture, process, runtime_name, migration_name):
    """Observe an actual runtime backend blocked by this owned migration."""
    def waiting():
        if process.poll() is not None:
            raise AssertionError("Runtime exited before an actual shared schema-lock wait was observed")
        # The random application names are supplied only to these owned processes.
        # Joining lock holders to their backend and pg_blocking_pids prevents an
        # unrelated lock, or receipt rejection without locking, proving admission.
        return fixture.sql(
            "SELECT EXISTS(SELECT 1 FROM pg_locks r JOIN pg_stat_activity a ON a.pid=r.pid "
            "WHERE r.locktype='advisory' AND a.datname=current_database() "
            "AND r.database=(SELECT oid FROM pg_database WHERE datname=current_database()) "
            f"AND r.classid={FENCE_KEY[0]} AND r.objid={FENCE_KEY[1]} AND r.objsubid=2 "
            "AND r.mode='ShareLock' AND NOT r.granted AND a.wait_event_type='Lock' "
            f"AND a.application_name={literal(runtime_name)} AND EXISTS("
            "SELECT 1 FROM pg_locks m JOIN pg_stat_activity b ON b.pid=m.pid "
            "WHERE m.locktype='advisory' AND m.database=r.database "
            "AND m.classid=r.classid AND m.objid=r.objid AND m.objsubid=r.objsubid "
            "AND m.mode='ExclusiveLock' AND m.granted AND b.datname=current_database() "
            f"AND b.application_name={literal(migration_name)} "
            "AND m.pid=ANY(pg_blocking_pids(r.pid))))"
        ) == "t"
    # The production lock deadline is five seconds; observe before it expires.
    wait_until(waiting, "owned runtime shared schema-lock wait", seconds=4)


def stop_owned_migration(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired as error:
            raise AssertionError("Could not verify owned migration process cleanup") from error


def prove_migration_excludes_startup(fixture):
    # Force the real explicit migration to wait in a versioned installer after it
    # acquires its lifecycle fence. Its prior receipt is absent by design here.
    fixture.sql(f"DROP TABLE {RECEIPT}")
    migration = None
    suffix = secrets.token_hex(8)
    migration_name, runtime_name = "migration_owner_" + suffix, "migration_waiter_" + suffix
    migration_env = {**fixture.env, "LISTMONK_db__params": "application_name=" + migration_name}
    runtime_env = {**fixture.env, "LISTMONK_db__params": "application_name=" + runtime_name}
    try:
        # This outer finally covers the context manager's __exit__ as well as its
        # body: a holder-release error must never skip reaping the migration.
        with held_lock(fixture, DELIVERY_KEY):
            migration = subprocess.Popen(
                [str(fixture.engine), "--config", "", "--migrate", "--yes"],
                cwd=fixture.root, env=migration_env, stdout=fixture.log, stderr=subprocess.STDOUT,
            )
            def migration_fenced():
                if migration.poll() is not None:
                    raise AssertionError("Migration exited before acquiring its exclusive fence")
                return fixture.sql(
                    "SELECT EXISTS(SELECT 1 FROM pg_locks JOIN pg_stat_activity a USING(pid) WHERE locktype='advisory' "
                    "AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) "
                    f"AND classid={FENCE_KEY[0]} AND objid={FENCE_KEY[1]} "
                    f"AND objsubid=2 AND mode='ExclusiveLock' AND granted AND a.application_name={literal(migration_name)}) "
                    "AND EXISTS(SELECT 1 FROM pg_locks JOIN pg_stat_activity a USING(pid) WHERE locktype='advisory' "
                    "AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) "
                    f"AND classid={DELIVERY_KEY[0]} AND objid={DELIVERY_KEY[1]} "
                    f"AND objsubid=2 AND NOT granted AND a.application_name={literal(migration_name)})"
                ) == "t"
            wait_until(migration_fenced, "real migration exclusive lifecycle fence", seconds=8)
            before = fixture.snapshot()
            runtime = fixture.launch(runtime_env)
            wait_for_runtime_lock(fixture, runtime, runtime_name, migration_name)
            try:
                assert_equal(runtime.wait(timeout=7), 1, "shared-lock deadline rejects startup")
            except subprocess.TimeoutExpired as error:
                raise AssertionError("Runtime did not stop after shared-lock deadline") from error
            assert_equal(fixture.snapshot(), before, "blocked ordinary startup writes nothing")
            if migration.poll() is not None:
                raise AssertionError("Migration lost its fence before contention proof completed")
        assert_equal(migration.wait(timeout=25), 0, "migration finishes after installer lock released")
        fixture.receipt()
    finally:
        try:
            fixture.stop_engine()
        finally:
            stop_owned_migration(migration)
    fixture.ready()
    fixture.stop_engine()


def prove_runtime_fence_loss(fixture):
    fixture.ready()
    pids = json.loads(fixture.sql(
        "SELECT COALESCE(json_agg(pid),'[]'::json) FROM pg_locks "
        "WHERE locktype='advisory' "
        "AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) "
        f"AND classid={FENCE_KEY[0]} AND objid={FENCE_KEY[1]} "
        "AND objsubid=2 AND mode='ShareLock' AND granted"
    ))
    assert_equal(len(pids), 1, "one retained runtime fence session")
    before = fixture.snapshot()
    assert_equal(fixture.sql(f"SELECT pg_terminate_backend({int(pids[0])})"), "t",
                 "terminate only this disposable runtime fence backend")
    try:
        code = fixture.serve.wait(timeout=7)
    except subprocess.TimeoutExpired as error:
        fixture.stop_engine()
        raise AssertionError("Runtime stayed alive after losing its lifecycle fence") from error
    assert_equal(code, 1, "runtime fence loss exits nonzero")
    assert_equal(fixture.snapshot(), before, "fence loss preserves durable schema and data")
    fixture.ready()
    fixture.stop_engine()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path,
                        help="Exact patched source used for the packed engine")
    parser.add_argument("--output", type=Path, help="Optional new sanitized JSON evidence file")
    args = parser.parse_args()
    engine = args.engine.resolve(strict=True)
    pg_bin = args.pg_bin.resolve(strict=True)
    source = args.source.resolve(strict=True)
    if not engine.is_file() or not os.access(engine, os.X_OK):
        parser.error("--engine must identify an executable packed binary")
    for tool in ("initdb", "pg_ctl", "psql", "pg_dump"):
        if not (pg_bin / tool).is_file() or not os.access(pg_bin / tool, os.X_OK):
            parser.error(f"--pg-bin is missing executable {tool}")
    raw_schema = (source / "schema.sql").read_bytes()
    if checksum(raw_schema) != UPSTREAM_SCHEMA_SHA256:
        parser.error("--source schema.sql does not match the pinned v6.2.0 baseline")
    if args.output is not None and (args.output.exists() or args.output.is_symlink()):
        parser.error("--output must be a new evidence file")

    results = {
        "scope": "native synthetic packed-engine migration and lifecycle admission",
        "engine_sha256": checksum(engine.read_bytes()),
        "upstream_schema_sha256": checksum(raw_schema),
        "passed": False,
        "checks": [],
        "not_qualified": [
            "production installation, backup restore or provider delivery",
            "old packed-binary installed upgrade (legacy test starts from pinned schema)",
            "container image packaging, ingress or orchestrator behavior",
        ],
    }
    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix="lm-migration-", dir="/tmp") as folder:
            fixture = MigrationFixture(Path(folder), engine, pg_bin)
            try:
                fixture.start()
                fixture.stop_engine()
                cases = [
                    ("fresh-explicit-migrate-noop", lambda: prove_fresh_migration(fixture)),
                    ("pinned-schema-legacy-campaign-fence", lambda: prove_legacy_fence(
                        fixture, raw_schema.decode("utf8"))),
                    ("explicit-upgrade-and-no-write-migrate", lambda: prove_noop_and_upgrade(fixture)),
                    ("missing-future-receipt-and-catalog-rejection", lambda: prove_admission_failures(fixture)),
                    ("restricted-runtime-no-ddl", lambda: prove_restricted_no_ddl_start(fixture)),
                    ("rls-policy-sequence-config-drift-rejected", lambda: prove_policy_and_sequence_drift(fixture)),
                    ("runtime-excludes-migration", lambda: prove_runtime_excludes_migration(fixture)),
                    ("real-migration-excludes-startup", lambda: prove_migration_excludes_startup(fixture)),
                    ("runtime-exits-on-fence-session-loss", lambda: prove_runtime_fence_loss(fixture)),
                ]
                for name, prove in cases:
                    results["active_check"] = name
                    case_started = time.monotonic()
                    prove()
                    results["checks"].append({
                        "name": name, "passed": True,
                        "seconds": round(time.monotonic() - case_started, 3),
                    })
                    del results["active_check"]
                    print(f"Passed: {name}", flush=True)
            finally:
                fixture.stop()
        results["passed"] = True
    finally:
        results["seconds"] = round(time.monotonic() - started, 3)
        if args.output is not None:
            write_report(args.output, results)
    print("Explicit migration, no-DDL admission, lifecycle exclusion and fence-loss checks passed.")


if __name__ == "__main__":
    main()
