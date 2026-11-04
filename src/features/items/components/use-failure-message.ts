import { useTranslations } from "next-intl";
import type * as actions from "../actions";
import type { FieldCode } from "../input";
import { TITLE_MAX } from "../limits";

type Result = Awaited<ReturnType<(typeof actions)[keyof typeof actions]>>;

// Every way an items action can fail, as its result says. Each code is a key of items.errors: tsc fails when an action
// gains a code that en.json does not translate (src/i18n/app-config.d.ts).
export type Failure = Extract<Result, { ok: false }>;

export function useFailureMessage(): (failure: Failure) => string {
  const t = useTranslations("items.errors");
  return (failure) => t(failure.code);
}

export function useFieldMessage(): (code: FieldCode) => string {
  const t = useTranslations("items.fields");
  // only too_long names the limit
  return (code) =>
    code === "too_long" ? t(code, { max: TITLE_MAX }) : t(code);
}
