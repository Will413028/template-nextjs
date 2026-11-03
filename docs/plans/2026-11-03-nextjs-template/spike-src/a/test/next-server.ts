// Starts `next start` on a free port for integration tests (no browser). Assumes `pnpm build` ran.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

export async function startNext(env: Record<string, string> = {}, opts: { preload?: boolean } = {}) {
  const port = await freePort();
  const logs: string[] = [];
  const child: ChildProcess = spawn("node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
    env: { ...process.env, ...env, ...(opts.preload ? { NODE_OPTIONS: "-r ./peer.cjs" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => logs.push(String(d)));
  child.stderr!.on("data", (d) => logs.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/spike/effects")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    base, port, logs,
    stop: () => new Promise<void>((r) => { child.once("exit", () => r()); child.kill("SIGTERM"); }),
  };
}
