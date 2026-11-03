"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { deleteItem } from "../actions";
import { useFailureMessage } from "./use-failure-message";

type State = Awaited<ReturnType<typeof deleteItem>> | null;

// Deletes the item and opens the list; an item already gone says so and stays.
export function DeleteItemButton({ id }: { id: string }) {
  const t = useTranslations("items");
  const failureMessage = useFailureMessage();
  const router = useRouter();
  const [state, run, pending] = useActionState<State, FormData>(
    deleteItem,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.push("/items");
    else if (state?.code === "unauthenticated") router.push("/sign-in");
  }, [state, router]);

  return (
    <form action={run} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-danger">
        {t("delete")}
      </button>
      {state && !state.ok && (
        <span role="alert" className="text-danger text-sm">
          {failureMessage(state)}
        </span>
      )}
    </form>
  );
}
