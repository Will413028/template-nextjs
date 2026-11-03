import { getTranslations } from "next-intl/server";
import { SessionButton } from "@/features/auth";
import { requireSession } from "@/features/auth/server";
import { Link } from "@/i18n/navigation";

export default async function DashboardPage() {
  const viewer = await requireSession();
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-16">
      <h1 className="font-bold text-2xl">
        {t("signedInAs", { username: viewer.username })}
      </h1>
      <Link href="/settings">{t("settings")}</Link>
      <SessionButton action="signOut" endsSession />
    </main>
  );
}
