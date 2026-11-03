import { Pool } from "pg";

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD_FILE
    ? (await import("node:fs")).readFileSync(process.env.DB_PASSWORD_FILE, "utf8").trim()
    : undefined,
  max: 2,
});

export async function GET() {
  try {
    const r = await pool.query("select count(*)::int as n from spike_items");
    return Response.json({ status: "ok", db: "ok", items: r.rows[0].n });
  } catch (e) {
    return Response.json({ status: "error", error: (e as Error).message }, { status: 503 });
  }
}
