import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseNewItem, TITLE_MAX } from "../input";
import { decodeCursor, encodeCursor } from "../server/cursor";

// Rules checked over many generated inputs, not a few chosen ones (fast-check prints the failing input and a seed).

const uuid = fc.uuid({ version: 7 });

describe("the page cursor, for any id", () => {
  it("decodes to the id it was made from", () => {
    fc.assert(
      fc.property(uuid, (id) => {
        expect(decodeCursor(encodeCursor(id))).toBe(id);
      }),
    );
  });

  it("refuses a cursor with any one character changed", () => {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_+/=";
    fc.assert(
      fc.property(
        uuid,
        fc.nat({ max: 21 }),
        fc.constantFrom(...alphabet),
        (id, at, char) => {
          const cursor = encodeCursor(id);
          const changed = cursor.slice(0, at) + char + cursor.slice(at + 1);
          // a changed cursor decodes to another id, whose own cursor is what was sent, or to nothing
          const decoded = decodeCursor(changed);
          if (changed === cursor) expect(decoded).toBe(id);
          else if (decoded !== null)
            expect(encodeCursor(decoded)).toBe(changed);
        },
      ),
    );
  });

  it("refuses a cursor with padding or extra characters", () => {
    fc.assert(
      fc.property(
        uuid,
        fc.constantFrom("=", "==", "A", " ", "\n"),
        (id, extra) => {
          expect(decodeCursor(encodeCursor(id) + extra)).toBeNull();
        },
      ),
    );
  });
});

describe("an item's title, for any string", () => {
  // lengths around both limits, in characters of one and two UTF-16 units: the limit counts code points
  const storable = fc
    .array(fc.constantFrom("a", "é", "中", "😀", "👍🏽"), {
      maxLength: TITLE_MAX + 20,
      size: "max",
    })
    .map((chars) => chars.join(""));

  it("is accepted exactly when it holds 1 to TITLE_MAX code points", () => {
    fc.assert(
      fc.property(storable, (title) => {
        const length = [...title].length;
        const parsed = parseNewItem({ title });
        expect(parsed.ok).toBe(length >= 1 && length <= TITLE_MAX);
        if (!parsed.ok) {
          expect(parsed.fields.title).toBe(
            length < 1 ? "too_short" : "too_long",
          );
        }
      }),
    );
  });

  it("is refused when it holds U+0000", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (before, after) => {
        const title = `${before}\u0000${after}`;
        const parsed = parseNewItem({ title });
        expect(parsed.ok).toBe(false);
      }),
    );
  });
});
