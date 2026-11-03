"""Tests for rename.py's argument checks. Run: python3 -m unittest discover scripts

CI's rename job checks the rename itself end to end; these cover inputs that job never passes.
"""

import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parent / "rename.py"
_spec = importlib.util.spec_from_file_location("rename", SCRIPT)
rename = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rename)


class RenameArgumentsTest(unittest.TestCase):
    def run_rename(self, *args: str) -> subprocess.CompletedProcess:
        # an empty directory: an accepted input would stop at the missing package.json, after the checks under test
        with tempfile.TemporaryDirectory() as tmp:
            return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=tmp, capture_output=True, text=True)

    def test_refuses_a_repository_that_names_the_project(self):
        # the name replacements would rewrite it a second time: acme/<name>-fork became acme/my-project-fork
        old = rename.OLD_NAME
        for repo in (f"acme/{old}-fork", f"acme/{old.replace('-', '_')}", f"{old}/app"):
            with self.subTest(repo=repo):
                result = self.run_rename("my-project", "--repo", repo)
                self.assertEqual(result.returncode, 2)
                self.assertIn("names the project", result.stderr)

    def test_accepts_another_repository(self):
        result = self.run_rename("my-project", "--repo", "acme/my-project")
        self.assertEqual(result.returncode, 2)
        self.assertIn("package.json not found", result.stderr)


if __name__ == "__main__":
    unittest.main()
