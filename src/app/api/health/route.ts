import { databaseReady } from "@/server/db";

// Readiness for the compose healthcheck and the CI stack job: 200 when the database answers, 503 otherwise. The
// body never carries the reason (it would expose internals); the server log has it.
export async function GET() {
  const ready = await databaseReady();
  return Response.json(
    { status: ready ? "ok" : "unavailable" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
