#!/usr/bin/env python3
"""Generate a new project from this template into a new directory.

Usage: python3 template/new_project.py <name> <dest> [--repo <owner/name>]   (make new NAME=... DEST=... [REPO=...])

The template stays a project that runs as it is. This copies the files of its HEAD commit (never the working tree,
which must be clean) into <dest>: every token in TOKENS is replaced in one pass over contents and file names, the
paths in EXCLUDED are left out, files under template/derived/ replace their counterparts, and the lines between a
`>>> template-only` and a `<<< template-only` marker are dropped. The whole output is computed and checked in memory
first (no template name, no reference to the template-only parts); only then is it written, `git init`ed and
committed in a temporary directory next to <dest> and moved into place, so a failure leaves nothing behind. The new
repository has no remote and no link to the template: later template fixes do not reach it.
"""

import argparse
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

OLD_NAME = "template-nextjs"
OLD_DB = OLD_NAME.replace("-", "_")
OLD_REPO = f"Will413028/{OLD_NAME}"
DEFAULT_OWNER = "Will413028"
# Paths (prefixes) that are never copied: the generator and its tests, the derived files' sources, the plans.
EXCLUDED = ("template/", "docs/plans/")
# template/derived/<path> replaces <path> in the output.
DERIVED = "template/derived/"
BEGIN, END = b">>> template-only", b"<<< template-only"
# Any of these in the output means a template-only part leaked into it.
FORBIDDEN = re.compile(
    rb"template[-_]nextjs|template/(?:derived|new_project|test_new_project)|new_project|docs/plans|make new\b|" + re.escape(BEGIN) + b"|" + re.escape(END),
    re.IGNORECASE,
)
# PostgreSQL truncates identifiers at 63 bytes; the longest role is <name>_owner
MAX_NAME = 50
NAME_PATTERN = re.compile(r"[a-z](?:[a-z0-9-]*[a-z0-9])?")
REPO_PATTERN = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")


class GenerateError(Exception):
    pass


Template = tuple[str, dict[str, tuple[str, bytes]]]  # (commit sha, path -> (git mode, contents))


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


def read_template(top: pathlib.Path) -> Template:
    """The files of HEAD, read from git objects. A git failure is an error, never an empty template."""
    sha = run_git(top, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    entries = run_git(top, "ls-tree", "-r", "-z", "--full-tree", sha).split(b"\0")
    listed = []
    for entry in filter(None, entries):
        meta, path = entry.split(b"\t", 1)
        mode, kind, obj = meta.decode().split()
        if kind != "blob" or mode not in ("100644", "100755"):
            raise GenerateError(f"{path.decode()}: unsupported entry {mode} {kind} (only regular files are copied)")
        rel = path.decode()
        if not rel.startswith(EXCLUDED) or rel.startswith(DERIVED):  # never read what is left out
            listed.append((rel, mode, obj))
    blobs = run_git(top, "cat-file", "--batch", stdin="".join(f"{obj}\n" for _, _, obj in listed).encode())
    files: dict[str, tuple[str, bytes]] = {}
    offset = 0
    for path, mode, obj in listed:
        header_end = blobs.index(b"\n", offset)
        header = blobs[offset:header_end].split()  # <sha> blob <size>
        if header[:2] != [obj.encode(), b"blob"]:
            raise GenerateError(f"git cat-file returned {header!r} for {path}")
        start = header_end + 1
        size = int(header[2])
        files[path] = (mode, blobs[start:start + size])
        offset = start + size + 1
    if "package.json" not in files:
        raise GenerateError(f"{top} does not look like the template: no package.json at HEAD")
    return sha, files


def drop_template_only(path: str, text: bytes) -> bytes:
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
    return b"".join(kept)


def build_output(template: Template, name: str, repo: str) -> dict[str, tuple[str, bytes]]:
    """Every output file computed and checked in memory; raises GenerateError instead of returning a bad tree."""
    _, files = template
    table = {OLD_REPO: repo, OLD_DB: name.replace("-", "_"), OLD_NAME: name}
    # one pass, longest token first: a replacement is never scanned again, so a repository may contain the name
    pattern = re.compile("|".join(re.escape(t) for t in sorted(table, key=len, reverse=True)))

    def replace(text: str) -> str:
        return pattern.sub(lambda m: table[m.group(0)], text)

    sources = {p: v for p, v in files.items() if not p.startswith(EXCLUDED)}
    sources.update({p[len(DERIVED):]: v for p, v in files.items() if p.startswith(DERIVED)})
    output: dict[str, tuple[str, bytes]] = {}
    problems: list[str] = []
    for path, (mode, data) in sorted(sources.items()):
        try:
            text: str | None = drop_template_only(path, data).decode("utf-8")
        except UnicodeDecodeError:  # binary: copied as it is, still checked below
            text = None
        if text is not None:
            data = replace(text).encode("utf-8")
        out = replace(path)
        if out in output:
            problems.append(f"{out}: two template files map to this path")
        output[out] = (mode, data)
        if out.startswith(EXCLUDED):
            problems.append(f"{out}: an excluded path is in the output")
        # what the output keeps from the template, the replacements blanked out: they may name the project
        kept = pattern.sub("\0", path + "\n" + (text or "")).encode() + (data if text is None else b"")
        for found in FORBIDDEN.finditer(kept):
            problems.append(f"{out}: still contains {found.group(0).decode(errors='replace')!r}")
    if problems:
        raise GenerateError("the output is not clean; nothing was written:\n  " + "\n  ".join(problems))
    return output


def generate(top: pathlib.Path, dest: pathlib.Path, name: str, repo: str) -> str:
    """Generate into dest (missing or an empty directory). Returns the template commit it was generated from."""
    check_arguments(name, repo)
    dest = dest.absolute()
    if dest.exists() and (not dest.is_dir() or any(dest.iterdir())):
        raise GenerateError(f"{dest} exists and is not an empty directory")
    if not dest.parent.is_dir():
        raise GenerateError(f"{dest.parent} does not exist")
    if run_git(top, "status", "--porcelain", "--untracked-files=normal").strip():
        raise GenerateError(f"{top} has uncommitted or untracked files; commit or remove them first")
    template = read_template(top)
    output = build_output(template, name, repo)

    work = pathlib.Path(tempfile.mkdtemp(prefix=f".{dest.name}.", dir=dest.parent))
    umask = os.umask(0)
    os.umask(umask)
    work.chmod(0o777 & ~umask)  # mkdtemp makes it 0700; the project directory gets the usual permissions
    replaced_empty_dest = False
    try:
        for path, (mode, data) in output.items():
            target = work / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o755 if mode == "100755" else 0o644)
        for directory in {p for path in output for p in (work / path).parents if p != work and work in p.parents}:
            directory.chmod(0o777 & ~umask)
        run_git(work, "init", "-q", "-b", "main")
        run_git(work, "add", "-A")
        message = (
            f"chore: start {name} from the template\n\n"
            f"Quality-Gate: initial commit adds every checker's configuration\n"
            f"Large-Change: initial commit generated from {OLD_NAME}@{template[0]}\n"
        )
        run_git(work, "commit", "-q", "-F", "-", stdin=message.encode())
        # the project's branch model: daily work on dev, main only through a dev -> main pull request
        run_git(work, "branch", "dev")
        run_git(work, "switch", "-q", "dev")
        if dest.exists():
            dest.rmdir()  # empty, checked above
            replaced_empty_dest = True
        os.rename(work, dest)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        if replaced_empty_dest and not dest.exists():
            dest.mkdir()  # give back the empty directory the user made
        raise
    return template[0]


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
    print(f"Created {args.dest} from {OLD_NAME}@{sha[:12]} (one commit on main and dev, dev checked out, no remote).")
    print(f"Next: cd {args.dest} && pnpm install && make init-env")
    return 0


if __name__ == "__main__":
    sys.exit(main())
