#!/usr/bin/env python3
"""Rename a fresh clone of the template: package, database and role names, branding and the repository link.

Usage: python3 scripts/rename.py <name> [--repo <owner/name>]
Run from the repository root. The GitHub repository defaults to Will413028/<name> (SECURITY.md links to its advisory
form). Afterwards no tracked file outside docs/plans/ names the template; CI's rename job checks that. This script
rewrites its own OLD_NAME too, so it can run again. Review the changes with `git diff`.
"""

import argparse
import pathlib
import re
import subprocess
import sys

OLD_NAME = "template-nextjs"
OLD_REPO = "Will413028/template-nextjs"
# Every tracked file that names the template, outside docs/plans/ (the plans keep the history as it was).
FILES = (
    "AGENTS.md",
    "README.md",
    "SECURITY.md",
    "package.json",
    "docker-compose.yml",
    ".env-example",
    ".github/workflows/ci.yml",
    "messages/en.json",
    "messages/zh-TW.json",
    "test/integration/postgres.ts",
    "scripts/rename.py",
)
NAME_PATTERN = re.compile(r"[a-z](?:[a-z0-9-]*[a-z0-9])?")
REPO_PATTERN = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+")


def rename(text: str, name: str, repo: str) -> str:
    old_db = OLD_NAME.replace("-", "_")
    # the database and its roles: unquoted SQL identifiers, so underscores instead of hyphens
    text = text.replace(old_db, name.replace("-", "_"))
    return text.replace(OLD_NAME, name)


def leftovers(root: pathlib.Path) -> list[str]:
    """Files outside docs/plans/ that still name the template, untracked ones too (not the ignored ones)."""
    found = subprocess.run(
        ["git", "grep", "--untracked", "-l", "-i", "-E", "template[-_]nextjs", "--", ":!docs/plans/**"],
        cwd=root, capture_output=True, text=True, check=False,
    )
    return found.stdout.split()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("name", help="lowercase letters, digits and hyphens, e.g. my-project")
    parser.add_argument("--repo", help="GitHub repository as owner/name (default Will413028/<name>)")
    args = parser.parse_args()

    name = args.name
    if not NAME_PATTERN.fullmatch(name):
        parser.error(f"invalid name {name!r}: use lowercase letters, digits and hyphens, starting with a letter")
    repo = args.repo or f"Will413028/{name}"
    if not REPO_PATTERN.fullmatch(repo):
        parser.error(f"invalid repository {repo!r}: use owner/name")
    # the name replacements run over the whole file after the repository link is in: they would rewrite it again
    if OLD_NAME in repo.lower() or OLD_NAME.replace("-", "_") in repo.lower():
        parser.error(f"repository {repo!r} names the project {OLD_NAME!r}, which the rename replaces; choose another")
    root = pathlib.Path.cwd()
    if not (root / "package.json").exists():
        parser.error("package.json not found; run from the repository root")
    if name == OLD_NAME:
        parser.error(f"the project is already named {name!r}")

    print(f"Renaming project to {name!r} (repository {repo})...")
    for rel in FILES:
        path = root / rel
        text = path.read_text(encoding="utf-8")
        new = rename(text, name, repo)
        if new != text:
            path.write_text(new, encoding="utf-8")
            print(f"Updated {rel}")

    left = leftovers(root)
    if left:
        print(f"error: these files still name {OLD_NAME}; add them to FILES in scripts/rename.py:", file=sys.stderr)
        for rel in left:
            print(f"  {rel}", file=sys.stderr)
        return 1
    print("Done! Review the changes with: git diff")
    print("An existing .env keeps the old database and role names; compare it with .env-example.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
