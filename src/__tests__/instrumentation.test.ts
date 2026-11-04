import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "@/instrumentation";

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
