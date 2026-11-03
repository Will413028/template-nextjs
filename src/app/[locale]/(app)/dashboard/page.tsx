import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listSessions, requireSession } from "@/features/auth/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("overview") };
}

export default async function DashboardPage() {
  const viewer = await requireSession();
  const sessions = await listSessions(viewer);
  const t = await getTranslations("dashboard");
  return (
    <>
      <h1 className="mb-2 font-medium text-2xl">
        {t("welcome", { username: viewer.username })}
      </h1>
      <p className="mb-8 text-muted">{t("intro")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings" className="card hover:border-muted">
          <p className="mb-1 text-muted text-sm">{t("devices")}</p>
          <p className="font-medium text-2xl">{sessions.length}</p>
          <p className="mt-2 text-muted text-sm">{t("manageDevices")}</p>
        </Link>
      </div>
    </>
  );
}
