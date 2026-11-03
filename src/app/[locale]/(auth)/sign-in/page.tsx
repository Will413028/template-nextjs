import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CredentialsForm } from "@/features/auth";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signIn") };
}

export default async function SignInPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <h1 className="mb-2 font-medium text-2xl">{t("signInTitle")}</h1>
      <p className="mb-8 text-muted text-sm">{t("signInSubtitle")}</p>
      <CredentialsForm mode="sign-in" />
      <p className="mt-6 text-center text-muted text-sm">
        {t("noAccount")}{" "}
        <Link href="/sign-up" className="text-foreground hover:underline">
          {t("signUp")}
        </Link>
      </p>
    </>
  );
}
