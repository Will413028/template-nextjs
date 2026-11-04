"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { createItem, updateItem } from "../actions";
import type { FieldCode } from "../input";
import { useFailureMessage, useFieldMessage } from "./use-failure-message";

type State = Awaited<ReturnType<typeof createItem | typeof updateItem>> | null;
type Sent = { title: string; description: string };

type Editing = { id: string; title: string; description: string | null };

// Adds an item, or, given one, changes it. After adding, the list reloads and React empties the form; after a change,
// the list opens. What the action says is wrong shows next to the field it names, or above the button, and the
// fields keep what was sent: React resets them to their defaults after the action, so a failed form's defaults are
// what it sent, kept here in the browser as it submits rather than sent back by the action (the form's action stays the
// Server Action, so it posts before the page's scripts load), and a successful add's are empty. Either
// order of React's reset and its new defaults ends there: a field reset and not typed in since shows its default as it
// changes (HTML's dirty flag). The defaults are always strings, so a textarea's is never left behind.
export function ItemForm({ item }: { item?: Editing }) {
  const t = useTranslations("items");
  const failureMessage = useFailureMessage();
  const router = useRouter();
  const editing = item !== undefined;
  const [result, action, pending] = useActionState<State, FormData>(
    editing ? updateItem : createItem,
    null,
  );
  const [sent, setSent] = useState<Sent | null>(null);
  useEffect(() => {
    if (!result) return;
    if (result.ok) {
      if (editing) router.push("/items");
      else router.refresh();
    } else if (result.code === "unauthenticated") {
      router.push("/sign-in");
    }
  }, [result, editing, router]);

  const failure = result && !result.ok ? result : null;
  const fields = failure && "fields" in failure ? failure.fields : undefined;
  const shownByField = Boolean(fields?.title || fields?.description);
  const kept = failure ? sent : null;

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const form = new FormData(event.currentTarget);
        setSent({
          title: text(form.get("title")),
          description: text(form.get("description")),
        });
      }}
      className="flex flex-col gap-4"
    >
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field
        name="title"
        label={t("titleLabel")}
        error={fields?.title}
        defaultValue={kept?.title ?? item?.title ?? ""}
        required
      />
      <Field
        name="description"
        label={t("descriptionLabel")}
        hint={t("descriptionHint")}
        error={fields?.description}
        defaultValue={kept?.description ?? item?.description ?? ""}
        multiline
      />
      {failure && !shownByField && (
        <p role="alert" className="text-danger text-sm">
          {failureMessage(failure)}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn-primary self-start"
      >
        {t(editing ? "save" : "add")}
      </button>
    </form>
  );
}

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";

function Field({
  name,
  label,
  hint,
  error,
  defaultValue,
  required,
  multiline,
}: {
  name: "title" | "description";
  label: string;
  hint?: string;
  error?: FieldCode;
  defaultValue?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const fieldMessage = useFieldMessage();
  const described = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  const props = {
    id: name,
    name,
    defaultValue,
    required,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described,
    className: "input",
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-muted text-sm">
        {label}
      </label>
      {multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
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
