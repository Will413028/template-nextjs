import { store } from "@/lib/store";
import { authState, resetAuthState } from "@/lib/auth-state";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ effects: store.effects, sessions: store.sessions.size });
}
export async function DELETE() {
  store.effects.length = 0; store.users.clear(); store.sessions.clear(); resetAuthState();
  return new Response(null, { status: 204 });
}
// test-only: move the throttle clock forward (ms)
export async function PATCH(req: Request) {
  authState().clockOffset += Number(await req.text());
  return new Response(null, { status: 204 });
}
