"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { revokeSession, signOut, signOutEverywhere } from "../actions";
import { useFailureMessage } from "./use-failure-message";

const ACTIONS = { signOut, signOutEverywhere, revokeSession };

type State = Awaited<ReturnType<(typeof ACTIONS)[keyof typeof ACTIONS]>> | null;

const VARIANTS = {
  secondary: "btn-secondary",
  ghost: "btn-ghost",
} as const;

// One button bound to a session action. After it succeeds the page reloads its data; an action that ended this
// browser's session goes to the sign-in page instead.
export function SessionButton({
  action,
  sessionId,
  endsSession,
  variant = "secondary",
}: {
  action: keyof typeof ACTIONS;
  sessionId?: string;
  endsSession?: boolean;
  variant?: keyof typeof VARIANTS;
}) {
  const t = useTranslations("auth");
  const failureMessage = useFailureMessage();
  const router = useRouter();
  const [state, run, pending] = useActionState<State, FormData>(
    ACTIONS[action],
    null,
  );
  useEffect(() => {
    if (!state) return;
    if (state.ok ? endsSession : state.code === "unauthenticated") {
      router.push("/sign-in");
    } else if (state.ok) {
      router.refresh();
    }
  }, [state, endsSession, router]);

  return (
    <form action={run} className="flex items-center gap-3">
      {sessionId && <input type="hidden" name="id" value={sessionId} />}
      <button type="submit" disabled={pending} className={VARIANTS[variant]}>
        {t(action)}
      </button>
      {state && !state.ok && (
        <span role="alert" className="text-danger text-sm">
          {failureMessage(state)}
        </span>
      )}
    </form>
  );
}
