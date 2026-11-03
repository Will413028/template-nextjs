import { getTranslations } from "next-intl/server";
import { CredentialsForm } from "@/features/auth";
import { Link } from "@/i18n/navigation";

export default async function SignInPage() {
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-16">
      <h1 className="font-bold text-2xl">{t("signIn")}</h1>
      <CredentialsForm mode="sign-in" />
      <Link href="/sign-up">{t("signUp")}</Link>
    </main>
  );
}
