import { useTranslations } from "next-intl";
import type * as actions from "../actions";
import type { FieldCode } from "../credentials";

type Result = Awaited<ReturnType<(typeof actions)[keyof typeof actions]>>;

// Every way an auth action can fail, as its result says. Each code is a key of auth.errors: tsc fails when an action
// gains a code that en.json does not translate (src/i18n/app-config.d.ts).
export type Failure = Extract<Result, { ok: false }>;

// The sentence for a failed action, with the wait in it when the action asks the user to come back later.
export function useFailureMessage(): (failure: Failure) => string {
  const t = useTranslations("auth.errors");
  return (failure) => {
    const seconds =
      "retryAfterSeconds" in failure ? (failure.retryAfterSeconds ?? 0) : 0;
    return t(failure.code, { seconds, minutes: Math.ceil(seconds / 60) });
  };
}

export function useFieldMessage(): (code: FieldCode) => string {
  const t = useTranslations("auth.fields");
  return (code) => t(code);
}
