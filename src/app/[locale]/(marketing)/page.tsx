import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function Home() {
  const t = useTranslations("home");
  const auth = useTranslations("auth");

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-6">
      <h1 className="mb-4 font-bold text-4xl md:text-6xl">{t("title")}</h1>
      <p className="mb-8 max-w-2xl text-center text-lg text-muted">
        {t("description")}
      </p>
      <div className="flex gap-3">
        <Link href="/sign-up" className="btn-primary">
          {auth("signUp")}
        </Link>
        <Link href="/sign-in" className="btn-secondary">
          {auth("signIn")}
        </Link>
      </div>
    </main>
  );
}
