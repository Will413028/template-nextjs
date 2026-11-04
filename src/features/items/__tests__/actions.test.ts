import { describe, expect, it, vi } from "vitest";

// The actions run inside next start in the integration tests, where coverage does not reach; here they run with the
// session check and the queries replaced, for what only the action decides: what it passes on.
const viewer = { userId: "u", sessionId: "s" };
const create = vi.fn(async () => ({ ok: true }));
const update = vi.fn(async () => ({ ok: false, code: "not_found" }));
vi.mock("@/features/auth/server", () => ({
  authedAction:
    (run: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      run(viewer, ...args),
}));
vi.mock("../server/queries", () => ({
  queries: () => ({ create, update, delete: vi.fn() }),
}));

const { createItem, updateItem } = await import("../actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("the items actions", () => {
  it("create from the form's fields, an empty description as none", async () => {
    expect(
      await createItem(null, form({ title: "t", description: "" })),
    ).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith(viewer, {
      title: "t",
      description: null,
    });
  });

  it("update the item the hidden id names, and return what the queries said", async () => {
    expect(
      await updateItem(null, form({ id: "i", title: "t", description: "d" })),
    ).toEqual({ ok: false, code: "not_found" });
    expect(update).toHaveBeenCalledWith(viewer, "i", {
      title: "t",
      description: "d",
    });
  });
});
