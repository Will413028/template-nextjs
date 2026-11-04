import { describe, expect, it } from "vitest";
import {
  fromForm,
  PAGE_SIZE,
  parseItemPatch,
  parseNewItem,
  parsePage,
} from "../input";

// The item input rules (template-go-nextjs api/openapi.yaml at 560106d: ItemTitle, CreateItemRequest, ItemPatch,
// Limit), as the forms and the queries both apply them. test/integration/items.test.ts checks the queries refuse
// what these refuse, and that the database refuses a title these let nobody send.
describe("a new item", () => {
  it("takes a title of 1 to 200 characters counted in code points", () => {
    for (const title of ["a", "字".repeat(200), "😀".repeat(200)]) {
      expect(parseNewItem({ title })).toEqual({
        ok: true,
        value: { title, description: null },
      });
    }
    expect(parseNewItem({ title: "字".repeat(201) })).toEqual({
      ok: false,
      fields: { title: "too_long" },
    });
  });

  it.each([
    ["an empty title", { title: "" }, { title: "too_short" }],
    ["no title", { description: "no title" }, { title: "required" }],
    ["a null title", { title: null }, { title: "null_not_allowed" }],
    ["a title that is not text", { title: 5 }, { title: "invalid" }],
    [
      "a description that is not text",
      { title: "x", description: 5 },
      { description: "invalid" },
    ],
    ["no object at all", "title", { title: "required" }],
    // PostgreSQL text cannot store U+0000
    [
      "a title with a NUL character",
      { title: "a\u0000b" },
      { title: "invalid" },
    ],
    [
      "a description with a NUL character",
      { title: "x", description: "a\u0000b" },
      { description: "invalid" },
    ],
    // UTF-8 cannot encode one: the database would store U+FFFD instead
    [
      "a title with a lone surrogate",
      { title: "a\uD800b" },
      { title: "invalid" },
    ],
    [
      "a description with a lone surrogate",
      { title: "x", description: "\uDE00" },
      { description: "invalid" },
    ],
  ])("refuses %s", (_, input, fields) => {
    expect(parseNewItem(input)).toEqual({ ok: false, fields });
  });

  it("keeps a character outside the BMP, a surrogate pair", () => {
    expect(parseNewItem({ title: "\u{1F600}" })).toEqual({
      ok: true,
      value: { title: "\u{1F600}", description: null },
    });
  });

  it("takes a missing or null description as none", () => {
    for (const input of [{ title: "x" }, { title: "x", description: null }]) {
      expect(parseNewItem(input)).toEqual({
        ok: true,
        value: { title: "x", description: null },
      });
    }
    expect(parseNewItem({ title: "x", description: "" })).toEqual({
      ok: true,
      value: { title: "x", description: "" },
    });
  });
});

// Go's JSON Merge Patch (RFC 7396): an omitted field stays, description: null clears it, title: null is refused.
describe("an item patch", () => {
  it("sets only the fields it names", () => {
    expect(parseItemPatch({})).toEqual({ ok: true, value: {} });
    expect(parseItemPatch({ title: "renamed" })).toEqual({
      ok: true,
      value: { title: "renamed" },
    });
    expect(parseItemPatch({ description: null })).toEqual({
      ok: true,
      value: { description: null },
    });
    expect(parseItemPatch({ description: "changed" })).toEqual({
      ok: true,
      value: { description: "changed" },
    });
  });

  it.each([
    ["a null title", { title: null }, { title: "null_not_allowed" }],
    ["an empty title", { title: "" }, { title: "too_short" }],
    [
      "a title of 201 characters",
      { title: "a".repeat(201) },
      { title: "too_long" },
    ],
  ])("refuses %s", (_, input, fields) => {
    expect(parseItemPatch(input)).toEqual({ ok: false, fields });
  });
});

describe("a page request", () => {
  it(`has ${PAGE_SIZE} items by default, and no cursor on the first page`, () => {
    expect(parsePage({})).toEqual({ ok: true, value: { limit: PAGE_SIZE } });
    expect(parsePage({ limit: 1, cursor: "abc" })).toEqual({
      ok: true,
      value: { limit: 1, cursor: "abc" },
    });
  });

  it.each([
    ["limit 0", { limit: 0 }, { limit: "out_of_range" }],
    ["limit 101", { limit: 101 }, { limit: "out_of_range" }],
    ["a fractional limit", { limit: 2.5 }, { limit: "invalid" }],
    ["a limit that is not a number", { limit: "10" }, { limit: "invalid" }],
    // a page's ?cursor= repeated comes as an array
    [
      "a cursor that is not text",
      { cursor: ["a", "b"] },
      { cursor: "invalid" },
    ],
  ])("refuses %s", (_, input, fields) => {
    expect(parsePage(input)).toEqual({ ok: false, fields });
  });
});

// A form cannot send null, so its empty description means "none"; other input keeps "" as it is, as Go does.
describe("a form's fields", () => {
  it("become an object, an empty description becoming null", () => {
    const form = new FormData();
    form.set("title", "Buy milk");
    form.set("description", "");
    expect(fromForm(form)).toEqual({ title: "Buy milk", description: null });
  });

  it("leave a description the form did not send out", () => {
    const form = new FormData();
    form.set("id", "x");
    expect(fromForm(form)).toEqual({ id: "x" });
  });

  it("pass anything but FormData through", () => {
    const input = { title: "x", description: "" };
    expect(fromForm(input)).toBe(input);
  });
});
