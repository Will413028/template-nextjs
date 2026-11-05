import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";

// Starts the production build (`next build` ran first: pnpm check in CI) with `next start` and the peer preload, the
// way the image runs it, on a free port; no browser.

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

export type NextServer = {
  base: string;
  host: string;
  logs: string[];
  stop: () => Promise<void>;
};

// Ready once ready() accepts the health check's response: by default when it is 2xx, that is, the database is up. Five 500s
// in a row that ready() refuses (a second) fail the start: a broken configuration answers 500 to every request and
// does not go away by waiting, while one 500 as the server starts does (a 503, the database not up yet, is retried).
export async function startNext(
  env: Record<string, string>,
  ready: (health: Response) => boolean = (health) => health.ok,
): Promise<NextServer> {
  const port = await freePort();
  const host = `127.0.0.1:${port}`;
  const logs: string[] = [];
  const child: ChildProcess = spawn(
    "node_modules/.bin/next",
    ["start", "-p", String(port), "-H", "127.0.0.1"],
    {
      env: {
        ...process.env,
        NODE_OPTIONS: "--require=./peer.cjs",
        NEXT_TELEMETRY_DISABLED: "1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  const base = `http://${host}`;
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  let errors = 0;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) break;
    let health: Response | undefined;
    try {
      health = await fetch(`${base}/api/health`);
    } catch {}
    if (health && ready(health)) return { base, host, logs, stop };
    errors = health?.status === 500 ? errors + 1 : 0;
    if (errors >= 5) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop();
  throw new Error(`next start did not become ready:\n${logs.join("")}`);
}
