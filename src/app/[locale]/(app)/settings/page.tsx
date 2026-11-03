import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { DeleteAccountForm, SessionButton } from "@/features/auth";
import { listSessions, requireSession } from "@/features/auth/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const viewer = await requireSession();
  const sessions = await listSessions(viewer);
  const t = await getTranslations("settings");
  const format = await getFormatter();
  const when = (at: Date) =>
    format.dateTime(at, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="flex flex-col gap-10">
      <h1 className="font-medium text-2xl">{t("title")}</h1>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium text-lg">{t("sessions")}</h2>
          <p className="text-muted text-sm">{t("sessionsDescription")}</p>
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="flex flex-col gap-0.5 text-sm">
                <span>
                  {t("signedInAt", { at: when(session.createdAt) })}
                  {session.current && (
                    <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-muted text-xs">
                      {t("thisDevice")}
                    </span>
                  )}
                </span>
                <span className="text-muted">
                  {t("lastUsedAt", { at: when(session.lastUsedAt) })}
                </span>
              </div>
              <SessionButton
                action="revokeSession"
                sessionId={session.id}
                endsSession={session.current}
              />
            </li>
          ))}
        </ul>
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted text-sm">
            {t("signOutEverywhereDescription")}
          </p>
          <SessionButton action="signOutEverywhere" endsSession />
        </div>
      </section>

      <section className="card flex flex-col gap-4 border-danger/40">
        <div>
          <h2 className="font-medium text-lg">{t("deleteTitle")}</h2>
          <p className="text-muted text-sm">{t("deleteDescription")}</p>
        </div>
        <DeleteAccountForm />
      </section>
    </div>
  );
}
