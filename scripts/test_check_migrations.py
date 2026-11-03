"""Tests for check_migrations.py against throwaway git repositories. Run: python3 -m unittest discover scripts"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "check_migrations.py"
TABLE = 'CREATE TABLE "t" ("id" uuid PRIMARY KEY NOT NULL);\n'


class CheckMigrationsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.tmp.name)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env |= {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "test")
        self.entries = []
        self.add_migration("0000_init", TABLE, when=1000)
        self.git("add", "-A")
        self.git("commit", "-q", "--no-verify", "-m", "chore: start")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.repo, env=self.env, check=True, capture_output=True, text=True
        ).stdout

    def write_journal(self):
        path = self.repo / "migrations/meta/_journal.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": "7", "dialect": "postgresql", "entries": self.entries}))

    def add_migration(self, tag, sql, when):
        (self.repo / "migrations").mkdir(exist_ok=True)
        (self.repo / f"migrations/{tag}.sql").write_text(sql)
        self.entries.append({"idx": len(self.entries), "version": "7", "when": when, "tag": tag, "breakpoints": True})
        self.write_journal()

    def run_script(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args], cwd=self.repo, env=self.env, capture_output=True, text=True
        )

    def test_clean_tree_passes(self):
        result = self.run_script("--base", "main")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 migrations checked against main", result.stdout)

    def test_no_migrations_yet_passes(self):
        empty = tempfile.TemporaryDirectory()
        self.addCleanup(empty.cleanup)
        result = subprocess.run([sys.executable, str(SCRIPT)], cwd=empty.name, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_appended_migration_passes(self):
        self.add_migration("0001_more", 'ALTER TABLE "t" ADD COLUMN "n" int;\n', when=2000)
        self.assertEqual(self.run_script("--base", "main").returncode, 0)

    def test_edited_existing_migration_fails(self):
        (self.repo / "migrations/0000_init.sql").write_text(TABLE + 'CREATE TABLE "tampered" ("id" int);\n')
        result = self.run_script("--base", "main")
        self.assertEqual(result.returncode, 1)
        self.assertIn("migrations/0000_init.sql exists on the base and was modified", result.stderr)

    def test_edited_migration_without_base_is_not_compared(self):
        (self.repo / "migrations/0000_init.sql").write_text(TABLE + "-- edit\n")
        self.assertEqual(self.run_script().returncode, 0)

    def test_rewritten_journal_entry_fails(self):
        self.entries[0]["when"] = 999
        self.write_journal()
        self.assertIn("the journal's existing entries changed", self.run_script("--base", "main").stderr)

    def test_older_timestamp_fails(self):
        self.add_migration("0001_branch", 'ALTER TABLE "t" ADD COLUMN "n" int;\n', when=500)
        self.assertIn("journal entry 0001_branch is not newer than 0000_init", self.run_script().stderr)

    def test_file_missing_from_journal_fails(self):
        (self.repo / "migrations/0001_stray.sql").write_text("SELECT 1;\n")
        self.assertIn("migrations/0001_stray.sql is not in the journal", self.run_script().stderr)

    def test_journal_entry_without_file_fails(self):
        self.entries.append({"idx": 1, "version": "7", "when": 2000, "tag": "0001_gone", "breakpoints": True})
        self.write_journal()
        self.assertIn("migrations/0001_gone.sql is in the journal but missing", self.run_script().stderr)

    def test_desc_nulls_last_index_fails(self):
        sql = 'CREATE INDEX "t_id_idx" ON "t" USING btree ("id" DESC NULLS LAST);\n'
        self.add_migration("0001_index", sql, when=2000)
        self.assertIn("migrations/0001_index.sql:1: DESC NULLS LAST", self.run_script().stderr)

    def test_desc_nulls_first_index_passes(self):
        sql = 'CREATE INDEX "t_id_idx" ON "t" USING btree ("id" DESC NULLS FIRST);\n'
        self.add_migration("0001_index", sql, when=2000)
        self.assertEqual(self.run_script().returncode, 0)


if __name__ == "__main__":
    unittest.main()
