import { NextResponse, type NextRequest } from "next/server";

// Prototype: Go http.CrossOriginProtection semantics (Fetch Metadata first, then Origin vs Host) for every
// unsafe method, enabled with SPIKE_FETCH_METADATA=1. Compares against Host, never X-Forwarded-Host.
function crossOrigin(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs) return sfs !== "same-origin" && sfs !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false; // non-browser client, as Go
  try {
    return new URL(origin).host !== req.headers.get("host");
  } catch {
    return true; // "null" and garbage
  }
}

export function proxy(req: NextRequest) {
  if (process.env.SPIKE_FETCH_METADATA === "1" && crossOrigin(req)) {
    return new NextResponse("cross-origin request", { status: 403 });
  }
  if (process.env.SPIKE_PROXY_AUTH === "1" && req.nextUrl.pathname.startsWith("/protected")
      && !req.cookies.get("__Host-session")) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
