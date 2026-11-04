import { beforeEach, describe, expect, it, vi } from "vitest";

// The actions run inside next start in the integration tests, where coverage does not reach; here they run with the
// session check and the service replaced, for what only the action decides: when the cookie is cleared.
const viewer = { userId: "u", sessionId: "s" };
const deleteAccount = vi.fn();
const clearSessionCookie = vi.fn();
vi.mock("../server", () => ({
  authedAction:
    (run: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      run(viewer, ...args),
  publicAction: (run: unknown) => run,
}));
vi.mock("../server/runtime", () => ({
  authService: () => ({ deleteAccount }),
  clearSessionCookie,
  sessionToken: vi.fn(),
  setSessionCookie: vi.fn(),
}));

const actions = await import("../actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteAccount", () => {
  it.each([
    ["deleted", { ok: true }, true],
    // the session ended between the check and the delete: its cookie names nothing
    ["a session that ended", { ok: false, code: "session_invalid" }, true],
    [
      "a session too old",
      { ok: false, code: "reauthentication_required" },
      false,
    ],
  ])("after %s, clears the cookie: %s", async (_, result, cleared) => {
    deleteAccount.mockResolvedValue(result);
    expect(await actions.deleteAccount()).toEqual(result);
    expect(clearSessionCookie).toHaveBeenCalledTimes(cleared ? 1 : 0);
  });
});
