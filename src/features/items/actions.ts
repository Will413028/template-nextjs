"use server";

import { authedAction } from "@/features/auth/server";
import { fromForm } from "./input";
import { queries } from "./server/queries";

// The items feature's Server Actions, each a public POST endpoint behind authedAction (server-actions.test.ts): the
// session is checked first, then the queries scope every row to the viewer. Reads are not actions: pages read through
// server.ts. The signatures fit useActionState: (previous state, form input); a form's empty description is none.

// The form's fields as an object, and the item id a hidden field names ("" when there is none).
function fields(input: unknown): {
  id: string;
  rest: Record<string, unknown>;
} {
  const object =
    input instanceof FormData ? Object.fromEntries(input) : fromForm(input);
  if (!object || typeof object !== "object") return { id: "", rest: {} };
  const { id, ...rest } = object as Record<string, unknown>;
  return { id: typeof id === "string" ? id : "", rest };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// A form the rules refused comes back with what it sent. React resets a form's fields to their defaults once its
// action returns, so the form makes these the defaults and what the user typed stays on screen.
function keepSent<T extends { ok: boolean; code?: string }>(
  result: T,
  sent: Record<string, unknown>,
): T & { sent?: { title: string; description: string } } {
  // a union with T & { sent } would reduce to T, so every result carries sent, mostly undefined
  if (result.ok || result.code !== "invalid_input") return result as T;
  return {
    ...result,
    sent: { title: text(sent.title), description: text(sent.description) },
  };
}

export const createItem = authedAction(
  async (viewer, _previous: unknown, input: unknown) => {
    const { rest } = fields(input);
    return keepSent(await queries().create(viewer, rest), rest);
  },
);

// Another user's item is not found, the same as one that does not exist.
export const updateItem = authedAction(
  async (viewer, _previous: unknown, input: unknown) => {
    const { id, rest } = fields(input);
    return keepSent(await queries().update(viewer, id, rest), rest);
  },
);

export const deleteItem = authedAction(
  async (viewer, _previous: unknown, input: unknown) =>
    queries().delete(viewer, fields(input).id),
);
