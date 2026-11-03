"""Offline tests for tool_versions.py. Run: python3 -m unittest discover -s scripts -p 'test_*.py'"""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import tool_versions as tv  # noqa: E402

A, B = ("a" * 64), ("b" * 64)

MAKEFILE = f"""HADOLINT_VERSION := 2.15.1
HADOLINT_SHA256_linux-arm64  := {A}
"""


class ToolVersionsTest(unittest.TestCase):
    def test_make_var_round_trip(self):
        text = tv.set_make_var(MAKEFILE, "HADOLINT_VERSION", "2.15.2")
        self.assertEqual(tv.make_var(text, "HADOLINT_VERSION"), "2.15.2")
        self.assertEqual(tv.make_var(text, "HADOLINT_SHA256_linux-arm64"), A)

    def test_set_make_var_refuses_a_missing_line(self):
        with self.assertRaises(SystemExit):
            tv.set_make_var(MAKEFILE, "NOPE", "1")

    def test_checksum_lines_reads_both_formats(self):
        sums = tv.checksum_lines(f"{A}  hadolint-linux-x86_64\n{B} *hadolint-linux-arm64\nnoise\n")
        self.assertEqual(sums, {"hadolint-linux-x86_64": A, "hadolint-linux-arm64": B})


if __name__ == "__main__":
    unittest.main()
