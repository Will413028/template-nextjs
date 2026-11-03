"""Tests for new_project.py. Run: python3 -m unittest discover -s template

CI's generate job runs the whole derived project's checks; these cover the generator's own rules on a small git
repository built in a temporary directory, so they run anywhere in a second or two.
"""

import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parent / "new_project.py"
_spec = importlib.util.spec_from_file_location("new_project", SCRIPT)
new_project = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(new_project)

NAME = new_project.OLD_NAME
DB = new_project.OLD_DB
REPO = new_project.OLD_REPO
GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.test",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.test",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
}


def git(cwd: pathlib.Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
                          env={**os.environ, **GIT_ENV}).stdout


def make_template(root: pathlib.Path, files: dict[str, str]) -> pathlib.Path:
    src = root / "src"
    src.mkdir()
    for rel, text in files.items():
        path = src / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    git(src, "init", "-q", "-b", "main")
    git(src, "add", "-A")
    git(src, "commit", "-q", "-m", "template")
    return src


BASE_FILES = {
    "package.json": f'{{"name": "{NAME}"}}\n',
    "SECURITY.md": f"report at https://github.com/{REPO}/security/advisories/new\n",
    "docker-compose.yml": f"POSTGRES_DB: {DB}\nAPP_USER: {DB}_app\n",
    "README.md": f"# {NAME}\ntemplate readme: make new\n",
    "template/derived/README.md": f"# {NAME}\nderived readme\n",
    "template/new_project.py": "# the generator\n",
    "docs/plans/plan.md": f"{NAME} plan\n",
    ".github/workflows/ci.yml": "jobs:\n  app: {}\n  # >>> template-only\n  generate: {}\n  # <<< template-only\n",
    f"{NAME}.txt": "a file named after the template\n",
}


class GenerateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.env = mock.patch.dict(os.environ, GIT_ENV)
        self.env.start()
        self.umask = os.umask(0o022)

    def tearDown(self):
        self.env.stop()
        os.umask(self.umask)
        self.tmp.cleanup()

    def generate(self, files=None, name="my-app", repo=None, dest=None):
        src = make_template(self.root, BASE_FILES if files is None else files)
        dest = dest or self.root / "out"
        return src, dest, new_project.generate(src, dest, name, repo or f"acme/{name}")

    def read(self, dest: pathlib.Path, rel: str) -> str:
        return (dest / rel).read_text(encoding="utf-8")

    def test_replaces_each_token_in_contents_and_names(self):
        _, dest, _ = self.generate()
        self.assertEqual(self.read(dest, "package.json"), '{"name": "my-app"}\n')
        self.assertIn("github.com/acme/my-app/security", self.read(dest, "SECURITY.md"))
        self.assertEqual(self.read(dest, "docker-compose.yml"), "POSTGRES_DB: my_app\nAPP_USER: my_app_app\n")
        self.assertTrue((dest / "my-app.txt").exists())

    def test_a_repository_that_names_the_project_is_replaced_once(self):
        # sequential str.replace rewrote acme/<name>-fork a second time; one pass never rescans its output
        _, dest, _ = self.generate(repo=f"acme/{NAME}-fork")
        self.assertIn(f"github.com/acme/{NAME}-fork/security", self.read(dest, "SECURITY.md"))

    def test_template_only_files_and_blocks_are_left_out(self):
        _, dest, _ = self.generate()
        self.assertFalse((dest / "template").exists())
        self.assertFalse((dest / "docs/plans").exists())
        self.assertEqual(self.read(dest, "README.md"), "# my-app\nderived readme\n")
        self.assertEqual(self.read(dest, ".github/workflows/ci.yml"), "jobs:\n  app: {}\n")

    def test_starts_a_new_repository_with_one_commit_and_no_remote(self):
        src, dest, _ = self.generate()
        self.assertEqual(git(dest, "rev-list", "--count", "HEAD").strip(), "1")
        self.assertEqual(git(dest, "branch", "--show-current").strip(), "dev")
        self.assertEqual(git(dest, "rev-parse", "main"), git(dest, "rev-parse", "dev"))
        self.assertEqual(oct(dest.stat().st_mode & 0o777), oct(0o777 & ~self.umask))
        self.assertEqual(git(dest, "remote").strip(), "")
        self.assertEqual(git(dest, "status", "--porcelain"), "")
        sha = git(src, "rev-parse", "HEAD").strip()
        self.assertIn(f"Large-Change: initial commit generated from {NAME}@{sha}", git(dest, "log", "-1", "--format=%B"))

    def test_keeps_the_executable_bit(self):
        files = {**BASE_FILES, "run.sh": "#!/bin/sh\n"}
        src = make_template(self.root, files)
        (src / "run.sh").chmod(0o755)
        git(src, "add", "run.sh")
        git(src, "commit", "-q", "-m", "exec")
        dest = self.root / "out"
        new_project.generate(src, dest, "my-app", "acme/my-app")
        self.assertTrue(os.access(dest / "run.sh", os.X_OK))
        self.assertFalse(os.access(dest / "package.json", os.X_OK))

    def assert_refused_and_untouched(self, files=None, name="my-app", repo=None, dest_setup=None):
        dest = self.root / "out"
        if dest_setup:
            dest_setup(dest)
        before = sorted(p.name for p in self.root.iterdir())
        src = make_template(self.root, BASE_FILES if files is None else files)
        with self.assertRaises(new_project.GenerateError):
            new_project.generate(src, dest, name, repo or f"acme/{name}")
        after = sorted(p.name for p in self.root.iterdir() if p.name != "src")
        self.assertEqual(after, before, "a refused run left files next to the template")
        if dest.exists():
            self.assertEqual(sorted(p.name for p in dest.iterdir()), ["keep"] if dest_setup else [])

    def test_output_still_naming_the_template_writes_nothing(self):
        # a capitalised form the table does not cover: the check runs before any file is written
        self.assert_refused_and_untouched(files={**BASE_FILES, "notes.md": "TEMPLATE-NEXTJS\n"})

    def test_output_referring_to_the_generator_writes_nothing(self):
        self.assert_refused_and_untouched(files={**BASE_FILES, "notes.md": "see template/new_project.py\n"})

    def test_unbalanced_template_only_block_writes_nothing(self):
        self.assert_refused_and_untouched(files={**BASE_FILES, "x.yml": "a\n# >>> template-only\nb\n"})

    def test_refuses_a_destination_that_is_not_empty(self):
        self.assert_refused_and_untouched(dest_setup=lambda d: (d.mkdir(), (d / "keep").write_text("x")))

    def test_an_empty_destination_directory_is_used(self):
        dest = self.root / "out"
        dest.mkdir()
        new_project.generate(make_template(self.root, BASE_FILES), dest, "my-app", "acme/my-app")
        self.assertTrue((dest / ".git").is_dir())

    def test_refuses_a_dirty_template(self):
        src = make_template(self.root, BASE_FILES)
        (src / "package.json").write_text("changed\n", encoding="utf-8")
        with self.assertRaises(new_project.GenerateError):
            new_project.generate(src, self.root / "out", "my-app", "acme/my-app")
        self.assertFalse((self.root / "out").exists())

    def test_a_git_failure_is_an_error_not_an_empty_template(self):
        notrepo = self.root / "notrepo"
        notrepo.mkdir()
        with self.assertRaisesRegex(new_project.GenerateError, r"git .* failed"):
            new_project.generate(notrepo, self.root / "out", "my-app", "acme/my-app")
        self.assertFalse((self.root / "out").exists())

    def test_a_failure_after_writing_leaves_nothing(self):
        # the files are written and git init ran when the commit fails (a hook, a missing identity)
        src = make_template(self.root, BASE_FILES)
        real = new_project.run_git

        def failing_commit(cwd, *args, **kwargs):
            if args[0] == "commit":
                raise new_project.GenerateError("commit failed")
            return real(cwd, *args, **kwargs)

        with mock.patch.object(new_project, "run_git", failing_commit), self.assertRaises(new_project.GenerateError):
            new_project.generate(src, self.root / "out", "my-app", "acme/my-app")
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["src"])

    def test_two_files_mapping_to_one_path_writes_nothing(self):
        self.assert_refused_and_untouched(files={**BASE_FILES, "my-app.txt": "already named\n"})

    def test_a_failed_move_gives_back_the_empty_destination(self):
        dest = self.root / "out"
        dest.mkdir()
        src = make_template(self.root, BASE_FILES)
        with mock.patch.object(new_project.os, "rename", side_effect=OSError("busy")), self.assertRaises(OSError):
            new_project.generate(src, dest, "my-app", "acme/my-app")
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["out", "src"])
        self.assertEqual(list(dest.iterdir()), [])

    def test_other_paths_under_a_template_directory_are_allowed(self):
        _, dest, _ = self.generate(files={**BASE_FILES, "src/mail/template/x.ts": "// a mail template/ dir\n"})
        self.assertTrue((dest / "src/mail/template/x.ts").exists())

    def test_refuses_bad_names_and_repositories(self):
        for name, repo in (("My-App", "acme/x"), ("my_app", "acme/x"), ("1app", "acme/x"), (NAME, "acme/x"),
                           ("a" * 51, "acme/x"), ("my-app", "acme"), ("my-app", "acme/x/y"), ("my-app", "acme/x y")):
            with self.subTest(name=name, repo=repo):
                with self.assertRaises(new_project.GenerateError):
                    new_project.check_arguments(name, repo)


class TemplateRepositoryTest(unittest.TestCase):
    """Rules about this repository's own files that the generator relies on."""

    def test_the_real_template_generates_cleanly(self):
        # computes (never writes) the output of this checkout's HEAD: every check except the clean-tree one
        top = SCRIPT.parent.parent
        files = new_project.build_output(new_project.read_template(top), "my-app", "acme/my-app")
        self.assertIn("package.json", files)
        self.assertNotIn("template/new_project.py", files)


if __name__ == "__main__":
    sys.exit(unittest.main())
