import { getTranslations } from "next-intl/server";
import { CredentialsForm } from "@/features/auth";
import { Link } from "@/i18n/navigation";

export default async function SignUpPage() {
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-16">
      <h1 className="font-bold text-2xl">{t("signUp")}</h1>
      <CredentialsForm mode="sign-up" />
      <Link href="/sign-in">{t("signIn")}</Link>
    </main>
  );
}
