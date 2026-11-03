import { describe, it } from "vitest";
import { actionIds } from "../integration/action-client";
import { signUpToSignOut } from "../integration/flow";

// CI's stack job (pnpm test:stack): the flow pages.test.ts runs against `next start`, here against the compose stack
// through Caddy, with the action ids of the app image's own build. STACK_NEXT_DIR holds the manifest copied out of
// the image (<dir>/server/server-reference-manifest.json).
const base = process.env.STACK_BASE_URL ?? "http://localhost";
const nextDir = process.env.STACK_NEXT_DIR;

describe("the compose stack through Caddy", () => {
  it("signs up, signs in, shows the dashboard with the username, signs out and sends the user back to sign in", async () => {
    if (!nextDir) throw new Error("STACK_NEXT_DIR is not set");
    await signUpToSignOut(base, actionIds(nextDir));
  });
});
