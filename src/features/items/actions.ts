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
  const object = fromForm(input);
  if (!object || typeof object !== "object") return { id: "", rest: {} };
  const { id, ...rest } = object as Record<string, unknown>;
  return { id: typeof id === "string" ? id : "", rest };
}

export const createItem = authedAction(
  async (viewer, _previous: unknown, input: unknown) =>
    queries().create(viewer, fields(input).rest),
);

// Another user's item is not found, the same as one that does not exist.
export const updateItem = authedAction(
  async (viewer, _previous: unknown, input: unknown) => {
    const { id, rest } = fields(input);
    return await queries().update(viewer, id, rest);
  },
);

export const deleteItem = authedAction(
  async (viewer, _previous: unknown, input: unknown) =>
    queries().delete(viewer, fields(input).id),
);
