#!/usr/bin/env python3
"""A parity table's acceptance: auth-parity.md for step 2 (checked at 2c), items-parity.md for step 3.

Every row of the Go test table whose step is one of --steps:
- 沿用: the TS column names at least one test, and every quoted name is found in src/ or test/ (a "describe > it"
  name is checked part by part; "case: template …", one row of an it.each table, word group by word group);
- 偏離: cites a deviation of the table's list (auth: D2 第 1–13 條; items: its own list), and any test it names is
  found as above;
- 不適用: gives a reason after the colon.

Run from the repository root:
  python3 docs/plans/2026-11-03-nextjs-template/check-parity.py                       # auth-parity.md, step 2
  python3 docs/plans/2026-11-03-nextjs-template/check-parity.py items-parity.md --steps 3a 3b
"""

import argparse
import re
import sys
from pathlib import Path

# the numbered deviations each table may cite: auth-parity.md cites the plan's D2 list, items-parity.md its own
DEVIATIONS = {"auth-parity.md": range(1, 14), "items-parity.md": range(1, 2)}
SOURCES = [p for root in ("src", "test") for p in Path(root).rglob("*.ts") if p.is_file()]
TEXT = "\n".join(p.read_text(encoding="utf-8") for p in SOURCES)


def found(name: str) -> bool:
    for part in name.split(" > "):
        # "case: template …" names one row of an it.each table: the case and the template's words are each in the source
        tokens = part.split("…")[0].split(":") if "…" in part else [part]
        if any(t.strip() and t.strip() not in TEXT for t in tokens):
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("table", nargs="?", default="auth-parity.md", choices=sorted(DEVIATIONS))
    parser.add_argument("--steps", nargs="+", default=["2"])
    args = parser.parse_args()
    deviations = DEVIATIONS[args.table]
    rows = []
    for line in Path(__file__).with_name(args.table).read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 5 and cells[0].startswith("Test") and cells[3] in args.steps:
            rows.append(cells)
    problems = []
    for go, _file, kind, _step, ts in rows:
        names = re.findall(r'"([^"]+)"', ts)
        missing = [n for n in names if not found(n)]
        if missing:
            problems.append(f"{go}: not found in src/ or test/: {missing}")
        # a row may follow Go in part and deviate in part: every deviation it names must be a confirmed one
        cited = [int(n) for n in re.findall(r"偏離清單第 (\d+) 條", kind)]
        if any(n not in deviations for n in cited) or ("偏離" in kind and not cited):
            problems.append(f"{go}: deviates without citing a deviation of the list (第 {deviations.start}–{deviations.stop - 1} 條)")
        if kind.startswith("沿用") and not names:
            problems.append(f"{go}: 沿用 without a TS test name")
        elif kind.startswith("不適用") and not kind.partition("：")[2].strip():
            problems.append(f"{go}: 不適用 without a reason")
        elif not kind.startswith(("沿用", "偏離", "不適用")):
            problems.append(f"{go}: unknown 歸屬 {kind!r}")
    kinds = {k: sum(1 for r in rows if r[2].startswith(k)) for k in ("沿用", "偏離", "不適用")}
    print(f"{args.table} step {'/'.join(args.steps)} rows: {len(rows)} ({', '.join(f'{k} {v}' for k, v in kinds.items())}); sources: {len(SOURCES)} files")
    for p in problems:
        print("FAIL", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
