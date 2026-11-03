import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";

// Starts the production build (`next build` ran first: pnpm check in CI) with `next start` and the peer preload, the
// way the image runs it, on a free port; no browser (plan step 0 (a) §7).

async function freePort(): Promise<number> {
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

export async function startNext(
  env: Record<string, string>,
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
  // ready once the health check reaches the database
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/api/health`)).ok)
        return { base, host, logs, stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop();
  throw new Error(`next start did not become ready:\n${logs.join("")}`);
}
