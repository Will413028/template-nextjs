"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  deleteAccount,
  revokeSession,
  signOut,
  signOutEverywhere,
} from "../actions";

const ACTIONS = { signOut, signOutEverywhere, revokeSession, deleteAccount };

type State = { ok: boolean; code?: string } | null;

// One button bound to a session action. After it succeeds the page reloads its data; an action that ended this
// browser's session goes to the sign-in page instead.
export function SessionButton({
  action,
  sessionId,
  endsSession,
}: {
  action: keyof typeof ACTIONS;
  sessionId?: string;
  endsSession?: boolean;
}) {
  const t = useTranslations("auth");
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
    <form action={run}>
      {sessionId && <input type="hidden" name="id" value={sessionId} />}
      <button type="submit" disabled={pending}>
        {t(action)}
      </button>
      {state && !state.ok && <span role="alert">{state.code}</span>}
    </form>
  );
}
