"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

// Shows only translated text: the error's message may carry server internals, so it goes to the console, never
// onto the page.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="mb-4 font-bold text-2xl">{t("title")}</h1>
        <p className="mb-6 text-muted">{t("description")}</p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-foreground px-6 py-3 font-medium text-background"
        >
          {t("retry")}
        </button>
      </div>
    </main>
  );
}
