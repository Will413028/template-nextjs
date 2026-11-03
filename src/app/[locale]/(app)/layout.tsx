import { getTranslations } from "next-intl/server";
import { NavLink } from "@/components/nav-link";
import { SessionButton } from "@/features/auth";
import { requireSession } from "@/features/auth/server";
import { Link } from "@/i18n/navigation";

// The signed-in area's frame: navigation, who is signed in, sign out. Each page still calls requireSession itself:
// a layout does not render again when the user moves between its pages (Next.js "Authentication" guide).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requireSession();
  const t = await getTranslations("dashboard");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center gap-4 border-border border-b px-6">
        <Link href="/dashboard" className="mr-2 font-semibold">
          {t("title")}
        </Link>
        <nav className="flex gap-1">
          <NavLink href="/dashboard">{t("overview")}</NavLink>
          <NavLink href="/settings">{t("settings")}</NavLink>
        </nav>
        <div className="flex-1" />
        <span className="text-muted text-sm">{viewer.userId.length}</span>
        <SessionButton action="signOut" endsSession variant="ghost" />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
