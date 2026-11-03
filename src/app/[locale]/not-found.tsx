import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="mb-4 font-medium text-6xl">404</h1>
        <p className="mb-8 text-muted text-xl">{t("title")}</p>
        <Link
          href="/"
          className="rounded-full bg-foreground px-6 py-3 font-medium text-background"
        >
          {t("goHome")}
        </Link>
      </div>
    </main>
  );
}
