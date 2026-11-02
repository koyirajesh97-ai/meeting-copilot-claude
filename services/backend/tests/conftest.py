"""Shared fixtures. `pg_dsn` gives a Postgres with the Supabase stand-ins and all migrations.

Uses DATABASE_URL if set (CI provides a Postgres service). Otherwise starts a throwaway local
cluster if Postgres binaries are installed, and skips database tests if they aren't.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

from app.auth import backend_secret

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "supabase" / "migrations"
STUBS = Path(__file__).parent / "sql" / "supabase_stubs.sql"

os.environ.setdefault("BACKEND_SECRET", "test-secret-test-secret-test-secret-0123")
# Only the Postgres fixtures use DATABASE_URL. Take it out of the environment so services built in
# other tests don't silently connect to a database that has no migrations applied.
DATABASE_URL = os.environ.pop("DATABASE_URL", None)
backend_secret.cache_clear()


def _pg_bin() -> Path | None:
    for base in sorted(Path("/usr/lib/postgresql").glob("*/bin"), reverse=True):
        if (base / "initdb").exists():
            return base
    found = shutil.which("initdb")
    return Path(found).parent if found else None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def apply_schema(dsn: str) -> None:
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(STUBS.read_text())
        for f in sorted(MIGRATIONS.glob("*.sql")):
            conn.execute(f.read_text())


@pytest.fixture(scope="session")
def pg_server() -> Iterator[str]:
    """A server-level DSN (database 'postgres')."""
    if DATABASE_URL:
        yield DATABASE_URL
        return
    bin_dir = _pg_bin()
    if bin_dir is None:
        pytest.skip("No Postgres available: set DATABASE_URL or install postgresql")
    as_root = os.geteuid() == 0
    run_as = ["runuser", "-u", "postgres", "--"] if as_root else []
    data = Path(tempfile.mkdtemp(prefix="copilot-pg-"))
    if as_root:
        shutil.chown(data, "postgres", "postgres")
    port = _free_port()
    subprocess.run(
        [
            *run_as,
            str(bin_dir / "initdb"),
            "-D",
            str(data),
            "-U",
            "postgres",
            "--auth=trust",
            "-E",
            "UTF8",
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            *run_as,
            str(bin_dir / "pg_ctl"),
            "-D",
            str(data),
            "-l",
            str(data / "log"),
            "-w",
            "-o",
            f"-p {port} -k {data} -c listen_addresses=127.0.0.1 -c fsync=off",
            "start",
        ],
        check=True,
        capture_output=True,
    )
    try:
        yield f"postgresql://postgres@127.0.0.1:{port}/postgres"
    finally:
        subprocess.run(
            [*run_as, str(bin_dir / "pg_ctl"), "-D", str(data), "-m", "immediate", "stop"],
            capture_output=True,
        )
        shutil.rmtree(data, ignore_errors=True)


@pytest.fixture
def pg_dsn(pg_server: str) -> Iterator[str]:
    """A fresh database per test, with stubs and migrations applied."""
    name = f"t_{os.urandom(6).hex()}"
    with psycopg.connect(pg_server, autocommit=True) as conn:
        conn.execute(f'create database "{name}"')
    dsn = pg_server.rsplit("/", 1)[0] + f"/{name}"
    try:
        apply_schema(dsn)
        yield dsn
    finally:
        with psycopg.connect(pg_server, autocommit=True) as conn:
            conn.execute(f'drop database if exists "{name}" with (force)')
