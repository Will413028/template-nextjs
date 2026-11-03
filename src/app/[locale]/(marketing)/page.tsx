import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("home");

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-6">
      <h1 className="mb-4 font-bold text-4xl md:text-6xl">{t("title")}</h1>
      <p className="max-w-2xl text-center text-lg text-muted">
        {t("description")}
      </p>
    </main>
  );
}
