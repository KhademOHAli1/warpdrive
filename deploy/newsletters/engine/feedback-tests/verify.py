#!/usr/bin/env python3
"""Run offline SNS signatures and SES persistence against a disposable engine database."""

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from consent import Fixture


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--pg-bin", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--go", default="go")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="lm-ses-", dir="/tmp") as folder:
        fixture = Fixture(Path(folder), args.engine.resolve(strict=True), args.pg_bin.resolve(strict=True))
        try:
            fixture.start("""
                UPDATE settings SET value='false'::jsonb WHERE key='app.check_updates';
                UPDATE settings SET value=jsonb_set(jsonb_set(value,'{0,host}','"127.0.0.1"'),'{0,port}','1') WHERE key='smtp';
            """)
            env = {**os.environ, "WARPDRIVE_SES_FIXTURE_DSN":
                   f"host={fixture.socket} port=5432 dbname=consent user=consentproof sslmode=disable"}
            subprocess.run([args.go, "test", "-count=1", "-v", "./internal/sesfeedback"],
                           cwd=args.source.resolve(strict=True), env=env, check=True, timeout=60)
        finally:
            fixture.stop()


if __name__ == "__main__":
    main()
