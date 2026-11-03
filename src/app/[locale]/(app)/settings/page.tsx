import { getFormatter, getTranslations } from "next-intl/server";
import { SessionButton } from "@/features/auth";
import { listSessions, requireSession } from "@/features/auth/server";

export default async function SettingsPage() {
  const viewer = await requireSession();
  const sessions = await listSessions(viewer);
  const t = await getTranslations("auth");
  const format = await getFormatter();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="font-bold text-2xl">{t("settings")}</h1>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("sessions")}</h2>
        <ul>
          {sessions.map((session) => (
            <li key={session.id} className="flex gap-3">
              <span>
                {t("lastUsed", {
                  at: format.dateTime(session.lastUsedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
                {session.current && ` (${t("thisDevice")})`}
              </span>
              <SessionButton
                action="revokeSession"
                sessionId={session.id}
                endsSession={session.current}
              />
            </li>
          ))}
        </ul>
        <SessionButton action="signOutEverywhere" endsSession />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("deleteAccount")}</h2>
        <SessionButton action="deleteAccount" endsSession />
      </section>
    </main>
  );
}
