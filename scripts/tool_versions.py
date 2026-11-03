#!/usr/bin/env python3
"""Keep the release binaries pinned in the Makefile (hadolint) current, with verified checksums.

Dependabot reads manifests, not Makefiles, so these pins would otherwise age unnoticed. Tools that ship as npm
packages are pinned in package.json instead, where Dependabot looks.

Usage (from the repository root):
  python3 scripts/tool_versions.py check           # print pins older than the newest release past the cooldown;
                                                   # exit 10 when any is, 1 when a source cannot be read
  python3 scripts/tool_versions.py bump <tool> [--version V]
                                                   # rewrite version and checksums from the release's checksum file

Releases younger than COOLDOWN_DAYS are ignored, the same cooldown as Dependabot (.github/dependabot.yml).
"""

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

COOLDOWN_DAYS = 7
# check's exit status when a pin is behind, so a caller can tell it from a failure (1).
OUTDATED = 10
MAKEFILE = pathlib.Path("Makefile")
HADOLINT_PLATFORMS = ["macos-arm64", "linux-x86_64", "linux-arm64"]
# Each tool: its GitHub repository and the Makefile variable holding its version.
TOOLS = {"hadolint": {"repo": "hadolint/hadolint", "version_var": "HADOLINT_VERSION"}}


def http_get(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "tool-versions"})
    if url.startswith("https://api.github.com/") and os.environ.get("GITHUB_TOKEN"):
        req.add_header("Authorization", "Bearer " + os.environ["GITHUB_TOKEN"])
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, b""


def make_var(text: str, name: str) -> str:
    m = re.search(rf"^{re.escape(name)}\s*:=\s*(\S+)", text, re.M)
    if not m:
        raise SystemExit(f"no {name} := … line")
    return m.group(1)


def set_make_var(text: str, name: str, value: str) -> str:
    new, n = re.subn(rf"^({re.escape(name)}\s*:=\s*)\S+", lambda m: m.group(1) + value, text, flags=re.M)
    if n != 1:
        raise SystemExit(f"expected one {name} := … line, found {n}")
    return new


def checksum_lines(text: str) -> dict[str, str]:
    """Parse `<sha256>  <file>` or `<sha256> *<file>` lines."""
    sums = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and re.fullmatch(r"[0-9a-f]{64}", parts[0]):
            sums[parts[1].lstrip("*")] = parts[0]
    return sums


def github_latest(repo: str, cooldown: dt.date) -> tuple[str, dt.date]:
    status, body = http_get(f"https://api.github.com/repos/{repo}/releases?per_page=30")
    if status != 200:
        raise SystemExit(f"{repo}: GitHub releases returned {status}")
    for rel in json.loads(body):
        published = dt.date.fromisoformat(rel["published_at"][:10])
        if not rel["draft"] and not rel["prerelease"] and published <= cooldown:
            return rel["tag_name"].removeprefix("v"), published
    raise SystemExit(f"{repo}: no release older than the cooldown")


def new_checksums(version: str) -> dict[str, str]:
    """Makefile variable -> checksum for the version, from the release's published checksum file."""
    url = f"https://github.com/hadolint/hadolint/releases/download/v{version}/checksums.sha256"
    status, body = http_get(url)
    if status != 200:
        raise SystemExit(f"{url}: {status}")
    sums = checksum_lines(body.decode())
    return {f"HADOLINT_SHA256_{p}": sums[f"hadolint-{p}"] for p in HADOLINT_PLATFORMS}


def cmd_check() -> int:
    cooldown = dt.date.today() - dt.timedelta(days=COOLDOWN_DAYS)
    outdated = 0
    for tool, spec in TOOLS.items():
        current = make_var(MAKEFILE.read_text(), spec["version_var"])
        newest, released = github_latest(spec["repo"], cooldown)
        if newest == current:
            print(f"{tool}: {current} (current)")
            continue
        outdated += 1
        print(f"{tool}: {current} -> {newest} (released {released}): python3 scripts/tool_versions.py bump {tool}")
    return OUTDATED if outdated else 0


def cmd_bump(tool: str, version: str | None) -> int:
    spec = TOOLS[tool]
    if version is None:
        version, _ = github_latest(spec["repo"], dt.date.today() - dt.timedelta(days=COOLDOWN_DAYS))
    text = set_make_var(MAKEFILE.read_text(), spec["version_var"], version)
    for var, value in new_checksums(version).items():
        text = set_make_var(text, var, value)
    MAKEFILE.write_text(text)
    print(f"{tool} -> {version}; checksums from the release's published checksum file")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    bump = sub.add_parser("bump")
    bump.add_argument("tool", choices=sorted(TOOLS))
    bump.add_argument("--version")
    args = parser.parse_args()
    if args.cmd == "check":
        return cmd_check()
    return cmd_bump(args.tool, args.version)


if __name__ == "__main__":
    sys.exit(main())
