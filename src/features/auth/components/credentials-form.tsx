"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { signIn, signUp } from "../actions";
import { useFailureMessage, useFieldMessage } from "./use-failure-message";

type State = Awaited<ReturnType<typeof signIn | typeof signUp>> | null;

// The sign-up and sign-in form: posts to the action, shows what it says is wrong (next to the field it names, or
// above the button), and opens the dashboard once the session cookie is set.
export function CredentialsForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const t = useTranslations("auth");
  const failureMessage = useFailureMessage();
  const fieldMessage = useFieldMessage();
  const router = useRouter();
  const [state, action, pending] = useActionState<State, FormData>(
    mode === "sign-in" ? signIn : signUp,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.push("/dashboard");
  }, [state, router]);

  const failure = state && !state.ok ? state : null;
  const fields = failure && "fields" in failure ? failure.fields : undefined;

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col">
        {t("username")}
        <input name="username" autoComplete="username" required />
        {fields?.username && <span>{fieldMessage(fields.username)}</span>}
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
        {fields?.password && <span>{fieldMessage(fields.password)}</span>}
      </label>
      {failure && !fields && <p role="alert">{failureMessage(failure)}</p>}
      <button type="submit" disabled={pending}>
        {t(mode === "sign-in" ? "signIn" : "signUp")}
      </button>
    </form>
  );
}
