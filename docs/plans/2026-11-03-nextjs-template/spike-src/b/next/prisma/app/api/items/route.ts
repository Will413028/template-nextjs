import { db } from "../../../lib/db.ts";
import { listItems } from "../../../lib/queries.ts";
export const dynamic = "force-dynamic";
export async function GET() {
  const u = await db.user.findFirst({ select: { id: true } });
  return Response.json({ who: await db.$queryRaw`select current_user`, items: u ? await listItems(db, u.id, 3) : [] });
}
