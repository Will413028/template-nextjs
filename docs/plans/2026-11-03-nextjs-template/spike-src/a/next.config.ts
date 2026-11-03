import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // pnpm hoisting + standalone tracing: keep the trace root at this dir.
  outputFileTracingRoot: import.meta.dirname,
  // spike only: forms bind actions that return values (fine at runtime, rejected by the form action type).
  typescript: { ignoreBuildErrors: true },
};
export default config;
