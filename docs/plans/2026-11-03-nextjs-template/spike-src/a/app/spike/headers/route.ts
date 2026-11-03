import { resolveClient } from "@/lib/auth-state";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  const h = req.headers;
  return Response.json({
    host: h.get("host"), xfh: h.get("x-forwarded-host"), xff: h.get("x-forwarded-for"),
    xfp: h.get("x-forwarded-proto"), peer: h.get("x-spike-peer"), resolved: resolveClient(h),
  });
}
