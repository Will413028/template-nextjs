import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PEER_HEADER } from "../server/runtime";

// The preload and the app name the header separately (a .cjs preload cannot import the TypeScript module).
describe("peer.cjs", () => {
  it("writes the header the app reads the peer from", () => {
    const preload = readFileSync(
      new URL("../../../../peer.cjs", import.meta.url),
      "utf8",
    );
    expect(preload).toContain(`const HEADER = "${PEER_HEADER}";`);
  });
});
