"""Tests for check_commit_policy.py against throwaway git repositories. Run: python3 -m unittest discover scripts"""

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "check_commit_policy.py"
LOCKS = {"suppressions": {"typescript": 2}, "tests": {"app": 10}}


class CommitPolicyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.tmp.name)
        # Hooks export GIT_DIR; the script must still find the repository it runs in.
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env |= {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "test")
        self.write("scripts/quality-locks.json", json.dumps(LOCKS))
        self.write("src/main.ts", "export {};\n")
        self.commit("chore: start")
        self.base = self.git("rev-parse", "HEAD").strip()

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.repo, env=self.env, check=True, capture_output=True, text=True
        ).stdout

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        self.git("add", path)

    def commit(self, message):
        self.git("commit", "-q", "--no-verify", "-m", message)

    def run_script(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args], cwd=self.repo, env=self.env, capture_output=True, text=True
        )

    def check_range(self):
        return self.run_script("--range", f"{self.base}..HEAD")

    def check_staged(self, message):
        msg = self.repo / ".git" / "COMMIT_EDITMSG"
        msg.write_text(message, encoding="utf-8")
        return self.run_script("--commit-msg", str(msg))

    def test_gate_file_edit_needs_trailer(self):
        self.write(".squawk.toml", "excluded_rules = []\n")
        self.commit("ci: loosen lint")
        result = self.check_range()
        self.assertEqual(result.returncode, 1)
        self.assertIn("edits .squawk.toml", result.stderr)

    def test_gate_file_edit_with_trailer_passes(self):
        self.write("biome.json", "{}\n")
        self.commit("ci: tighten lint\n\nQuality-Gate: turn on noSkippedTests")
        self.assertEqual(self.check_range().returncode, 0, self.check_range().stderr)

    def test_nested_osv_exceptions_need_trailer(self):
        self.write("tools/osv-scanner.toml", "[[IgnoredVulns]]\n")
        self.commit("chore: ignore a vuln")
        self.assertIn("edits tools/osv-scanner.toml", self.check_range().stderr)

    def test_lock_moved_bad_way_needs_trailer(self):
        locks = json.loads(json.dumps(LOCKS))
        locks["suppressions"]["typescript"] = 3
        locks["tests"]["app"] = 9
        self.write("scripts/quality-locks.json", json.dumps(locks))
        self.commit("chore: more biome-ignore")
        stderr = self.check_range().stderr
        self.assertIn("moves the lock suppressions.typescript 2 -> 3", stderr)
        self.assertIn("moves the lock tests.app 10 -> 9", stderr)

    def test_lock_moved_good_way_passes(self):
        locks = json.loads(json.dumps(LOCKS))
        locks["suppressions"]["typescript"] = 1
        locks["tests"]["app"] = 11
        self.write("scripts/quality-locks.json", json.dumps(locks))
        self.commit("test: one more test")
        self.assertEqual(self.check_range().returncode, 0)

    def test_ordinary_change_passes(self):
        self.write("src/main.ts", "export const main = 1;\n")
        self.commit("feat: main")
        self.assertEqual(self.check_range().returncode, 0)

    def test_large_change_needs_trailer(self):
        self.write("src/big.ts", "export {};\n" + "// line\n" * 1000)
        self.commit("feat: big")
        result = self.check_range()
        self.assertEqual(result.returncode, 1)
        self.assertIn("changes 1001 lines, over 1000", result.stderr)

    def test_large_change_with_trailer_passes(self):
        self.write("src/big.ts", "export {};\n" + "// line\n" * 1000)
        self.commit("feat: big\n\nLarge-Change: one generated table, reviewed as a whole")
        self.assertEqual(self.check_range().returncode, 0)

    def test_generated_files_do_not_count(self):
        self.write(".gitattributes", "*.yaml linguist-generated=true\n")
        self.commit("chore: mark lockfiles generated\n\nQuality-Gate: lockfiles are generated")
        self.write("pnpm-lock.yaml", "x: 1\n" * 5000)
        self.commit("build: bump deps")
        self.assertEqual(self.check_range().returncode, 0, self.check_range().stderr)

    def test_commit_msg_mode_counts_staged_lines(self):
        self.write("src/big.ts", "export {};\n" + "// line\n" * 1000)
        self.assertIn("changes 1001 lines", self.check_staged("feat: big\n").stderr)

    def test_commit_msg_mode_checks_staged_changes(self):
        self.write("tsconfig.json", "{}\n")
        result = self.check_staged("chore: relax ts\n")
        self.assertEqual(result.returncode, 1)
        self.assertIn("edits tsconfig.json", result.stderr)
        # a commented-out trailer does not count
        self.assertEqual(self.check_staged("chore: relax ts\n\n# Quality-Gate: no\n").returncode, 1)
        self.assertEqual(self.check_staged("chore: relax ts\n\nQuality-Gate: needed for X\n").returncode, 0)

    def test_gitattributes_edit_needs_trailer(self):
        # marking files generated takes them out of the size count, so it is a gate change itself
        self.write(".gitattributes", "** linguist-generated=true\n")
        self.commit("chore: attrs")
        self.assertIn("edits .gitattributes", self.check_range().stderr)

    def test_package_scripts_change_needs_trailer(self):
        self.write("package.json", json.dumps({"scripts": {"check": "pnpm lint && pnpm test"}}))
        self.commit("chore: scripts")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.write("package.json", json.dumps({"scripts": {"check": "pnpm lint"}}))
        self.commit("chore: drop tests from check")
        self.assertIn("changes the scripts in package.json", self.check_range().stderr)

    def test_package_dependency_change_needs_no_trailer(self):
        self.write("package.json", json.dumps({"scripts": {"check": "x"}, "dependencies": {}}))
        self.commit("chore: scripts")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.write("package.json", json.dumps({"scripts": {"check": "x"}, "dependencies": {"zod": "4"}}))
        self.commit("build: add zod")
        self.assertEqual(self.check_range().returncode, 0, self.check_range().stderr)

    def test_trailer_above_the_scissors_line_counts(self):
        self.write("biome.json", "{}\n")
        scissors = "# ------------------------ >8 ------------------------\n"
        message = f"ci: lint\n\nQuality-Gate: why\n{scissors}diff --git a b\n"
        self.assertEqual(self.check_staged(message).returncode, 0)

    def test_head_only_range_checks_the_root_commit(self):
        # a new branch's first push has no base: every reachable commit is checked, the root commit included
        self.write("src/big.ts", "export {};\n" + "// line\n" * 1000)
        self.commit("feat: big")
        result = self.run_script("--range", "HEAD")
        self.assertEqual(result.returncode, 1)
        self.assertIn("changes 1001 lines", result.stderr)
        self.assertEqual(result.stderr.count("\n"), 1, result.stderr)

    def test_root_commit_alone_can_be_the_range(self):
        root = self.git("rev-list", "--max-parents=0", "HEAD").strip()
        self.assertEqual(self.run_script("--range", root).returncode, 0)


if __name__ == "__main__":
    unittest.main()
