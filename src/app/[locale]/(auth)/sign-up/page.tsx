import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CredentialsForm } from "@/features/auth";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signUp") };
}

export default async function SignUpPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <h1 className="mb-2 font-medium text-2xl">{t("signUpTitle")}</h1>
      <p className="mb-8 text-muted text-sm">{t("signUpSubtitle")}</p>
      <CredentialsForm mode="sign-up" />
      <p className="mt-6 text-center text-muted text-sm">
        {t("hasAccount")}{" "}
        <Link href="/sign-in" className="text-foreground hover:underline">
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
