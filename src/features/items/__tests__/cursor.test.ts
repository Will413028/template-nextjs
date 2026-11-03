import { randomUUIDv7 } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../server/cursor";

// Ported from template-go-nextjs platform/httpx/cursor_test.go: the cursor is the 16 bytes of the last id on a page,
// in unpadded base64url, and anything else is refused.
describe("the page cursor", () => {
  it("round-trips an id", () => {
    const id = randomUUIDv7();
    const cursor = encodeCursor(id);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(decodeCursor(cursor)).toBe(id);
  });

  const id = randomUUIDv7();
  const bytes = Buffer.from(id.replaceAll("-", ""), "hex");
  const valid = encodeCursor(id);
  // the last of 22 characters holds the 16th byte's last 2 bits and 4 bits that are always clear: set one of those
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const nonCanonical =
    valid.slice(0, 21) + alphabet[alphabet.indexOf(valid.slice(21)) + 1];
  it.each([
    ["not base64url", `${valid.slice(0, 10)}*${valid.slice(11)}`],
    ["padded base64", bytes.toString("base64")],
    ["one byte short", bytes.subarray(0, 15).toString("base64url")],
    [
      "one byte long",
      Buffer.concat([bytes, Buffer.of(0)]).toString("base64url"),
    ],
    ["empty", ""],
    // 16 bytes of 0xff: "/" in standard base64, "_" in base64url
    [
      "standard base64 alphabet",
      Buffer.alloc(16, 0xff).toString("base64").replace(/=+$/, ""),
    ],
    ["not the canonical form", nonCanonical],
  ])("refuses a cursor it did not make: %s", (_, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});
