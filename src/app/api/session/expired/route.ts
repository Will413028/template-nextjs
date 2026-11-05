import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { clearDeadSessionCookie } from "@/features/auth/server";
import { routing } from "@/i18n/routing";

// Where a page sends a request whose session cookie is no longer live: a server component cannot write cookies while it
// renders, so this clears the cookie and goes on to the sign-in page (ADR auth-and-sign-in-throttling D1, deviation 3;
// ADR nextjs-fullstack-baseline D2). A live session's cookie is left alone, so a link from another site cannot sign
// anyone out.
export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale");
  await clearDeadSessionCookie();
  redirect(
    `/${hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}/sign-in`,
  );
}
