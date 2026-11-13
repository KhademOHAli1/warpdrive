"""Bind installed Web slots to the same observed PostgreSQL schema and queue catalog."""
from __future__ import annotations

import json
import os
import subprocess

from installed_web_runtime import ID, require
from web_switch import content_hash
from web_switch_smoke import SCHEMA_SQL


PREFIX = ("docker", "--host", "unix:///run/docker.sock", "exec", "--user", "0", "-i")
SYSTEM = {"PATH": "/usr/bin:/bin", "HOME": "/root"}
PSQL = ('PGPASSWORD="$(cat /run/secrets/postgres_admin_password)" '
        'PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=4000 -c lock_timeout=2000" '
        'exec timeout -s TERM -k 1 8 psql -X -qAt -h /var/run/postgresql -U "$POSTGRES_USER" '
        '-d warpdrive -v ON_ERROR_STOP=1')
QUEUES = """SELECT json_build_object('version',(SELECT min(version) FROM pgboss.version),
 'queues',(SELECT coalesce(json_agg(name ORDER BY name),'[]'::json) FROM pgboss.queue),
 'readOnly',current_setting('transaction_read_only')='on');"""


def read_schema(postgres_id):
    require(os.geteuid() == 0 and ID.fullmatch(postgres_id), "Exact installed database identity required")
    command = [*PREFIX, postgres_id, "sh", "-ec", PSQL]
    result = subprocess.run(command, input=(SCHEMA_SQL + "\n" + QUEUES).encode(), stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, env=SYSTEM, timeout=12, check=False)
    require(result.returncode == 0 and 0 < len(result.stdout) <= 2 * 1024**2, "Bounded installed schema readback failed")
    rows = result.stdout.splitlines()
    require(len(rows) == 2, "Unexpected installed schema result")
    schema, queues = map(json.loads, rows)
    require(set(schema) == {"ledger", "columns", "constraints"} and len(schema["ledger"]) == 119
            and queues["readOnly"] is True and queues["version"] == 46 and len(queues["queues"]) == 23
            and len(set(queues["queues"])) == 23, "Installed ledger, catalog or queue differs from the qualified baseline")
    return content_hash({"schema": schema, "queueCatalog": queues})
