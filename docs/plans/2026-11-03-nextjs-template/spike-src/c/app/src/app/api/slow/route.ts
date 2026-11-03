import { connection } from "next/server";
export async function GET() {
  await connection();
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 8000));
  return Response.json({ slept_ms: Date.now() - started });
}
