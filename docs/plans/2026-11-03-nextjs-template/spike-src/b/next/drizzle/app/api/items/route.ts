import { db } from "../../../lib/db.ts";
import { listItems } from "../../../lib/queries.ts";
import { users } from "../../../lib/schema.ts";
export const dynamic = "force-dynamic";
export async function GET() {
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  return Response.json({ who: (await db.execute("select current_user")).rows[0], items: u ? await listItems(db, u.id, 3) : [] });
}
