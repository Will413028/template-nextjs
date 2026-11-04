"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { signIn, signUp } from "../actions";
import type { FieldCode } from "../credentials";
import { useFailureMessage, useFieldMessage } from "./use-failure-message";

type State = Awaited<ReturnType<typeof signIn | typeof signUp>> | null;

// The sign-up and sign-in form: posts to the action, shows what it says is wrong (next to the field it names, or
// above the button), and opens the dashboard once the session cookie is set.
export function CredentialsForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const t = useTranslations("auth");
  const failureMessage = useFailureMessage();
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
  // a failure no field shows (an empty fields, or none) is said above the button
  const shownByField = Boolean(fields?.username || fields?.password);
  const signingUp = mode === "sign-up";

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        name="username"
        label={t("username")}
        hint={signingUp ? t("usernameHint") : undefined}
        error={fields?.username}
        autoComplete="username"
      />
      <Field
        name="password"
        type="password"
        label={t("password")}
        hint={signingUp ? t("passwordHint") : undefined}
        error={fields?.password}
        autoComplete={signingUp ? "new-password" : "current-password"}
      />
      {failure && !shownByField && (
        <p role="alert" className="text-danger text-sm">
          {failureMessage(failure)}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary py-3">
        {t(signingUp ? "signUp" : "signIn")}
      </button>
    </form>
  );
}

function Field({
  name,
  type = "text",
  label,
  hint,
  error,
  autoComplete,
}: {
  name: "username" | "password";
  type?: "text" | "password";
  label: string;
  hint?: string;
  error?: FieldCode;
  autoComplete: string;
}) {
  const fieldMessage = useFieldMessage();
  const described = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-muted text-sm">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className="input"
      />
      {error ? (
        <p id={`${name}-error`} role="alert" className="text-danger text-sm">
          {fieldMessage(error)}
        </p>
      ) : (
        hint && (
          <p id={`${name}-hint`} className="text-muted text-xs">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
