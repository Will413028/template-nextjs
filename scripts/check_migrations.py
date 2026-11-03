#!/usr/bin/env python3
"""Checks drizzle-kit cannot do for the migrations in migrations/.

Usage: python3 scripts/check_migrations.py [--base <ref>]
Run from the repository root.

- Every migration file is in the journal (migrations/meta/_journal.json) and every journal entry has its file.
- Journal timestamps (`when`) strictly increase. Drizzle's migrator applies only the entries whose timestamp is
  newer than the last applied one, so an entry with an older timestamp (a migration generated on a branch that
  merged later) would be skipped without any error.
- No index sorts DESC NULLS LAST. Drizzle writes `.desc()` as DESC NULLS LAST, which matches neither PostgreSQL's
  default `ORDER BY x DESC` (NULLS FIRST) nor its reverse, so the planner cannot use the index for either; write
  `.desc().nullsFirst()`.
- With --base: migrations that exist on the merge-base with <ref> are unchanged, and the journal there is a prefix
  of the journal here. Drizzle stores a hash of each applied file but never compares it, so an edited migration is
  silently not re-run on a database that already has it.

CONCURRENTLY is caught by squawk (.squawk.toml assumes a transaction: the migrator applies every pending file in one).
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

DIR = pathlib.Path("migrations")
JOURNAL = DIR / "meta" / "_journal.json"
DESC_NULLS_LAST = re.compile(r"\bDESC\s+NULLS\s+LAST\b", re.I)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def journal_entries(text: str) -> list[dict]:
    return json.loads(text)["entries"]


def static_problems(journal: list[dict], files: dict[str, str]) -> list[str]:
    """files: migration tag -> SQL text, for every migrations/*.sql."""
    problems = []
    tags = [e["tag"] for e in journal]
    problems += [f"migrations/{t}.sql is in the journal but missing" for t in tags if t not in files]
    problems += [f"migrations/{t}.sql is not in the journal" for t in sorted(files) if t not in tags]
    for before, after in zip(journal, journal[1:]):
        if after["when"] <= before["when"]:
            problems.append(
                f"journal entry {after['tag']} is not newer than {before['tag']}: the migrator would skip it; "
                "regenerate it after the newer one"
            )
    for tag, sql in sorted(files.items()):
        for n, line in enumerate(sql.splitlines(), 1):
            if DESC_NULLS_LAST.search(line):
                problems.append(f"migrations/{tag}.sql:{n}: DESC NULLS LAST index; use .desc().nullsFirst()")
    return problems


def immutability_problems(base_journal: list[dict], journal: list[dict], base_files: dict[str, str],
                          files: dict[str, str]) -> list[str]:
    problems = []
    if journal[: len(base_journal)] != base_journal:
        problems.append("the journal's existing entries changed; only append new migrations")
    for tag, sql in sorted(base_files.items()):
        if files.get(tag) != sql:
            problems.append(f"migrations/{tag}.sql exists on the base and was modified, deleted or renamed")
    return problems


def read_tree() -> tuple[list[dict], dict[str, str]]:
    journal = journal_entries(JOURNAL.read_text(encoding="utf-8")) if JOURNAL.exists() else []
    files = {p.stem: p.read_text(encoding="utf-8") for p in sorted(DIR.glob("*.sql"))}
    return journal, files


def read_base(ref: str) -> tuple[list[dict], dict[str, str]]:
    merge_base = git("merge-base", "HEAD", ref).strip()
    # the entries directly in migrations/ on the base; empty when the base has no migrations yet
    files = {}
    for name in git("ls-tree", "--name-only", merge_base, "--", f"{DIR}/").split():
        path = pathlib.PurePosixPath(name)
        if path.suffix == ".sql" and path.parent == pathlib.PurePosixPath(DIR):
            files[path.stem] = git("show", f"{merge_base}:{name}")
    listed = git("ls-tree", "--name-only", merge_base, "--", str(JOURNAL)).strip()
    journal = journal_entries(git("show", f"{merge_base}:{JOURNAL}")) if listed else []
    return journal, files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", help="compare with the merge-base of HEAD and this ref")
    args = parser.parse_args()

    journal, files = read_tree()
    problems = static_problems(journal, files)
    if args.base:
        base_journal, base_files = read_base(args.base)
        problems += immutability_problems(base_journal, journal, base_files, files)
    for p in problems:
        print(p, file=sys.stderr)
    if not problems:
        print(f"{len(journal)} migrations checked" + (f" against {args.base}" if args.base else ""))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
