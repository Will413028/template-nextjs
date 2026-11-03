#!/usr/bin/env python3
"""Generate a new project from this template into a new directory.

Usage: python3 template/new_project.py <name> <dest> [--repo <owner/name>]   (make new NAME=... DEST=... [REPO=...])

The template stays a project that runs as it is. Its HEAD commit (never the working tree, which must be clean) is
exported with `git archive`, leaving out the paths in EXCLUDED, and unpacked with tarfile's "data" filter into a
temporary directory next to <dest>, the way create-next-app unpacks an example. There, files under template/derived/
replace their counterparts, the lines between a `>>> template-only` and a `<<< template-only` marker are dropped, and
every token in TOKENS is replaced in one pass over file contents (file names are not rewritten: a path holding a token
is refused). The tree is then checked: nothing may still name the template, refer to an excluded path or hold a
marker. Only a clean tree is committed (`git init -b main`, one commit, no remote) and moved onto <dest>, so a failure
leaves nothing behind. The branch model and branch protection are set up on the hosting side after the first push.
The new project has no link to the template: later template fixes do not reach it.
"""

import argparse
import io
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

OLD_NAME = "template-nextjs"
OLD_DB = OLD_NAME.replace("-", "_")
OLD_REPO = f"Will413028/{OLD_NAME}"
DEFAULT_OWNER = "Will413028"
# Paths (prefixes) the export leaves out: the generator, its tests and the derived files' sources; the plans.
EXCLUDED = ("template/", "docs/plans/")
# template/derived/<path> replaces <path> in the output.
DERIVED = "template/derived/"
BEGIN, END = ">>> template-only", "<<< template-only"
GENERATOR = pathlib.Path(__file__).stem  # new_project
MAKE_TARGET = "make new"
# PostgreSQL truncates identifiers at 63 bytes; the longest one made from the name is the role <name>_owner.
MAX_NAME = 63 - len("_owner")
NAME_PATTERN = re.compile(r"[a-z](?:[a-z0-9-]*[a-z0-9])?")
REPO_PATTERN = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")
# What the output must not hold, derived from the tables above: a template name in any case; a reference to an
# excluded path at a path boundary or after ./ or ../ (src/mail/template/ is fine); the generator and its make target;
# a marker.
FORBIDDEN = re.compile(
    "|".join(
        [re.escape(token) for token in (OLD_REPO, OLD_DB, OLD_NAME)]
        + [r"(?:(?<![\w./-])|(?<=\./))" + re.escape(prefix) for prefix in EXCLUDED]
        + [re.escape(GENERATOR), re.escape(MAKE_TARGET) + r"\b", re.escape(BEGIN), re.escape(END)]
    ),
    re.IGNORECASE,
)


class GenerateError(Exception):
    pass


def run_git(cwd: pathlib.Path, *args: str, stdin: bytes | None = None) -> bytes:
    result = subprocess.run(["git", *args], cwd=cwd, input=stdin, capture_output=True, check=False)
    if result.returncode != 0:
        raise GenerateError(f"git {' '.join(args)} failed in {cwd}: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def check_arguments(name: str, repo: str) -> None:
    if not NAME_PATTERN.fullmatch(name):
        raise GenerateError(f"invalid name {name!r}: use lowercase letters, digits and hyphens, starting with a letter")
    if len(name) > MAX_NAME:
        raise GenerateError(f"name {name!r} is longer than {MAX_NAME} characters (it becomes PostgreSQL identifiers)")
    if name == OLD_NAME:
        raise GenerateError(f"choose a name other than {OLD_NAME!r}")
    if not REPO_PATTERN.fullmatch(repo):
        raise GenerateError(f"invalid repository {repo!r}: use owner/name")


def drop_template_only(path: str, text: str) -> str:
    kept, inside = [], False
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        if BEGIN in line or END in line:
            if (BEGIN in line) == inside:
                raise GenerateError(f"{path}:{number}: unbalanced template-only marker")
            inside = not inside
        elif not inside:
            kept.append(line)
    if inside:
        raise GenerateError(f"{path}: template-only block is never closed")
    return "".join(kept)


def export(top: pathlib.Path, sha: str, into: pathlib.Path, *pathspecs: str) -> None:
    """Unpack `git archive` of the pathspecs at sha into the new directory into."""
    # tar.umask=user: the archive's modes follow the user's umask, as files they created would
    archive = run_git(top, "-c", "tar.umask=user", "archive", "--format=tar", sha, "--", *pathspecs)
    into.mkdir()
    try:
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(into, filter="data")  # refuses absolute links and links leaving the tree
    except tarfile.FilterError as error:
        raise GenerateError(f"the template holds an entry the export refuses: {error}") from error


def materialize(top: pathlib.Path, out: pathlib.Path, name: str, repo: str) -> str:
    """Write the checked output tree of top's HEAD to out (which must not exist). Returns the template commit."""
    sha = run_git(top, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    # git archive applies export-ignore and export-subst; the output must be the committed files, nothing else
    found = subprocess.run(["git", "grep", "-l", "-E", "export-(ignore|subst)", sha, "--", ":(glob)**/.gitattributes"],
                           cwd=top, capture_output=True, check=False)
    if found.returncode not in (0, 1):  # 1: no match
        raise GenerateError(f"git grep failed in {top}: {found.stderr.decode(errors='replace').strip()}")
    if found.returncode == 0:
        raise GenerateError("a .gitattributes sets export-ignore or export-subst, which would change the output")
    export(top, sha, out, ".", *(f":!{prefix}" for prefix in EXCLUDED))
    if not (out / "package.json").is_file():
        raise GenerateError(f"{top} does not look like the template: no package.json at HEAD")
    if run_git(top, "ls-tree", "-r", "--name-only", sha, "--", DERIVED).strip():
        derived = out.parent / "derived"
        export(top, sha, derived, DERIVED)
        for source in (p for p in (derived / DERIVED).rglob("*") if p.is_file() or p.is_symlink()):
            target = out / source.relative_to(derived / DERIVED)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, target)  # keeps the derived file's own mode
    # regular files only: a link would carry a name or a target the checks below never read
    if links := sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_symlink()):
        raise GenerateError(f"the template holds symbolic links, which are not copied: {', '.join(links)}")

    table = {OLD_REPO: repo, OLD_DB: name.replace("-", "_"), OLD_NAME: name}
    # one pass, longest token first: a replacement is never scanned again, so a repository may contain the name
    pattern = re.compile("|".join(re.escape(t) for t in sorted(table, key=len, reverse=True)))
    problems: list[str] = []
    for file in sorted(p for p in out.rglob("*") if p.is_file()):
        rel = file.relative_to(out).as_posix()
        problems += [f"{rel}: the path holds {m.group(0)!r} (file names are not rewritten)"
                     for m in FORBIDDEN.finditer(rel)]
        data = file.read_bytes()
        try:
            text = drop_template_only(rel, data.decode("utf-8"))
        except UnicodeDecodeError:  # binary: kept as it is, still checked
            problems += [f"{rel}: still contains {m.group(0)!r}" for m in FORBIDDEN.finditer(data.decode("latin-1"))]
            continue
        # what the output keeps from the template, the replacements blanked out: they may name the project
        problems += [f"{rel}: still contains {m.group(0)!r}" for m in FORBIDDEN.finditer(pattern.sub("\0", text))]
        new = pattern.sub(lambda m: table[m.group(0)], text).encode("utf-8")
        if new != data:
            file.write_bytes(new)
    if problems:
        raise GenerateError("the output is not clean; nothing was written:\n  " + "\n  ".join(problems))
    return sha


def generate(top: pathlib.Path, dest: pathlib.Path, name: str, repo: str) -> str:
    """Generate into dest (missing or an empty directory). Returns the template commit it was generated from."""
    check_arguments(name, repo)
    if not hasattr(tarfile, "data_filter"):
        raise GenerateError(f"Python {sys.version.split()[0]} lacks tarfile's extraction filters; use Python 3.12+")
    dest = dest.absolute()
    if dest.exists() and (not dest.is_dir() or any(dest.iterdir())):
        raise GenerateError(f"{dest} exists and is not an empty directory")
    if not dest.parent.is_dir():
        raise GenerateError(f"{dest.parent} does not exist")
    if run_git(top, "status", "--porcelain", "--untracked-files=normal").strip():
        raise GenerateError(f"{top} has uncommitted or untracked files; commit or remove them first")

    # the project is built in a subdirectory: mkdtemp's own directory is 0700, a plain mkdir follows the umask
    work = pathlib.Path(tempfile.mkdtemp(prefix=f".{dest.name}.", dir=dest.parent))
    try:
        out = work / "project"
        sha = materialize(top, out, name, repo)
        run_git(out, "init", "-q", "-b", "main")
        run_git(out, "add", "-A")
        message = (
            f"chore: start {name} from the template\n\n"
            f"Quality-Gate: initial commit adds every checker's configuration\n"
            f"Large-Change: initial commit generated from {OLD_NAME}@{sha}\n"
        )
        run_git(out, "commit", "-q", "-F", "-", stdin=message.encode())
        os.rename(out, dest)  # same filesystem; replaces an empty dest in one step
    except OSError as error:
        raise GenerateError(f"generating {dest} failed: {error}") from error
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return sha


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("name", help="lowercase letters, digits and hyphens, e.g. my-project")
    parser.add_argument("dest", type=pathlib.Path, help="new or empty directory")
    parser.add_argument("--repo", help=f"GitHub repository as owner/name (default {DEFAULT_OWNER}/<name>)")
    args = parser.parse_args()
    top = pathlib.Path(__file__).resolve().parent.parent
    try:
        sha = generate(top, args.dest, args.name, args.repo or f"{DEFAULT_OWNER}/{args.name}")
    except GenerateError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"Created {args.dest} from {OLD_NAME}@{sha[:12]} (one commit on main, no remote).")
    print(f"Next: cd {args.dest} && pnpm install && make init-env; see README.md for the first push")
    return 0


if __name__ == "__main__":
    sys.exit(main())
