import { afterEach, describe, expect, it, vi } from "vitest";

const checks = vi.hoisted(() => ({
  databaseConfig: vi.fn(),
  authConfig: vi.fn(),
  trustedProxies: vi.fn(),
}));
vi.mock("@/server/env", () => ({
  databaseConfig: checks.databaseConfig,
  authConfig: checks.authConfig,
}));
vi.mock("@/server/request", () => ({
  trustedProxies: checks.trustedProxies,
}));

import { onRequestError, register } from "@/instrumentation";

describe("onRequestError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs one JSON line with the request id and no error message", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      lines.push(line);
    });
    const error = Object.assign(new Error("password=hunter2"), {
      digest: "123",
    });
    await onRequestError(
      error,
      {
        path: "/en/items",
        method: "POST",
        headers: { "x-request-id": "req-1" },
      },
      {
        routerKind: "App Router",
        routePath: "/[locale]/items",
        routeType: "action",
        renderSource: undefined,
        revalidateReason: undefined,
        renderType: undefined,
      } as never,
    );
    expect(lines).toHaveLength(1);
    const [line = ""] = lines;
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({
      event: "request.error",
      request_id: "req-1",
      method: "POST",
      path: "/en/items",
      route_type: "action",
      route: "/[locale]/items",
      digest: "123",
    });
    expect(line).not.toContain("hunter2");
  });
});

describe("register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("reads every server setting when the Node.js server starts", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(checks.databaseConfig).toHaveBeenCalledOnce();
    expect(checks.authConfig).toHaveBeenCalledOnce();
    expect(checks.trustedProxies).toHaveBeenCalledOnce();
  });

  it("stops the start when a setting is wrong", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    checks.trustedProxies.mockImplementationOnce(() => {
      throw new Error("not an address prefix: x");
    });
    await expect(register()).rejects.toThrow("not an address prefix");
  });

  it("reads nothing in the edge runtime, which has no Node.js modules", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(checks.databaseConfig).not.toHaveBeenCalled();
  });
});
