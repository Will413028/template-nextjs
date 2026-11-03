// Same action client against the standalone image behind Caddy. Skipped unless the stack is up:
//   docker/stack-up.sh alpine && SPIKE_STACK=alpine pnpm vitest run test/stack.test.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionIds, callAction, effects, reset } from "./action-client";

const TAG = process.env.SPIKE_STACK;
const base = "http://127.0.0.1:8088";

// A client inside the compose network that talks to Next directly (bypassing Caddy).
function direct(script: string): string {
  return execFileSync("docker", ["run", "--rm", "--network", "spike-a-net", `spike-a-next:${TAG}`, "node", "--input-type=module", "-e", script], { encoding: "utf8" });
}

describe.skipIf(!TAG)(`stack (${TAG}): standalone image behind Caddy`, () => {
  const ids = TAG ? actionIds(readFileSync(`docker/manifest-${TAG}.json`, "utf8")) : {};
  const PING = ids["app/actions.ts#ping"];
  const ARGON = ids["app/actions.ts#argonInfo"];

  it("argon2id inside the image", async () => {
    const r = await callAction({ base, id: ARGON });
    console.log(`[stack ${TAG}] argonInfo:`, JSON.stringify(r.result));
    expect((r.result as { encoded: string }).encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(r.result).toMatchObject({ verifyOk: true, verifyBad: false });
  });

  it("cookie through Caddy", async () => {
    const r = await callAction({ base, id: PING, args: ["stack"] });
    console.log(`[stack ${TAG}] Set-Cookie:`, r.setCookie);
    expect(r.setCookie.some((c) => c.startsWith("__Host-session=") && /HttpOnly/.test(c) && /Secure/.test(c))).toBe(true);
  });

  it("CSRF: forged X-Forwarded-Host through Caddy vs direct to Next", async () => {
    const h = { Origin: "https://evil.test", "X-Forwarded-Host": "evil.test" };
    await reset(base);
    const viaCaddy = await callAction({ base, id: PING, args: ["xfh-caddy"], headers: h });
    const ranViaCaddy = (await effects(base)).effects.some((e) => e.action === "ping");
    await reset(base);
    const out = direct(`
      const r = await fetch("http://spike-a-next:3000/", { method: "POST", headers: { "Next-Action": "${PING}",
        "Content-Type": "text/plain;charset=UTF-8", Origin: "https://evil.test", "X-Forwarded-Host": "evil.test" },
        body: JSON.stringify(["xfh-direct"]) });
      console.log(r.status, JSON.stringify(r.headers.getSetCookie()));`);
    const ranDirect = (await effects(base)).effects.some((e) => e.action === "ping");
    console.log(`[stack ${TAG}] forged XFH via Caddy: status=${viaCaddy.status} executed=${ranViaCaddy} setCookie=${viaCaddy.setCookie.length > 0}`);
    console.log(`[stack ${TAG}] forged XFH direct to Next: ${out.trim()} executed=${ranDirect}`);
    expect(ranViaCaddy).toBe(false);
  });

  it("client IP: Caddy replaces a forged XFF; a direct peer is not trusted (preload)", async () => {
    const viaCaddy = await (await fetch(base + "/spike/headers", { headers: { "X-Forwarded-For": "6.6.6.6", "X-Spike-Peer": "172.31.250.2" } })).json();
    const d = direct(`const r = await fetch("http://spike-a-next:3000/spike/headers", { headers: { "X-Forwarded-For": "6.6.6.6" } }); console.log(await r.text());`);
    console.log(`[stack ${TAG}] via Caddy:`, JSON.stringify(viaCaddy));
    console.log(`[stack ${TAG}] direct:`, d.trim());
    expect(viaCaddy.xff).not.toContain("6.6.6.6");
    expect(viaCaddy.peer).toBe("172.31.250.2");
    expect(JSON.parse(d).resolved.ip).not.toBe("6.6.6.6");
  });
});
