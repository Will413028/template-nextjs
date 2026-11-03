"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteAccount } from "../actions";
import { useFailureMessage } from "./use-failure-message";

type State = Awaited<ReturnType<typeof deleteAccount>> | null;

// Deletes the account after the user ticks that they understand. The server needs a session issued within ten
// minutes; past that the form says so and links to the sign-in page.
export function DeleteAccountForm() {
  const t = useTranslations("settings");
  const failureMessage = useFailureMessage();
  const router = useRouter();
  const [state, run, pending] = useActionState<State, FormData>(
    deleteAccount,
    null,
  );
  useEffect(() => {
    if (state?.ok || (state && state.code === "unauthenticated")) {
      router.push("/sign-in");
    }
  }, [state, router]);

  const failure = state && !state.ok ? state : null;
  return (
    <form action={run} className="flex flex-col items-start gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirm" required />
        {t("deleteConfirm")}
      </label>
      {failure && (
        <p role="alert" className="text-danger text-sm">
          {failureMessage(failure)}{" "}
          {failure.code === "reauthentication_required" && (
            <Link href="/sign-in" className="underline">
              {t("signInAgain")}
            </Link>
          )}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-danger">
        {t("deleteAccount")}
      </button>
    </form>
  );
}
