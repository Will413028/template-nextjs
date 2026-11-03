"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { signIn, signUp } from "../actions";

type State = Awaited<ReturnType<typeof signIn | typeof signUp>> | null;

// The sign-up and sign-in form: posts to the action, shows the error code it returns, and opens the dashboard once
// the session cookie is set. Step 2c styles it and translates the codes.
export function CredentialsForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [state, action, pending] = useActionState<State, FormData>(
    mode === "sign-in" ? signIn : signUp,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.push("/dashboard");
  }, [state, router]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col">
        {t("username")}
        <input name="username" autoComplete="username" required />
      </label>
      <label className="flex flex-col">
        {t("password")}
        <input
          name="password"
          type="password"
          autoComplete={
            mode === "sign-in" ? "current-password" : "new-password"
          }
          required
        />
      </label>
      {state && !state.ok && <p role="alert">{state.code}</p>}
      <button type="submit" disabled={pending}>
        {t(mode === "sign-in" ? "signIn" : "signUp")}
      </button>
    </form>
  );
}
