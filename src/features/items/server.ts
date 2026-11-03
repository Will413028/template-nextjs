import "server-only";
import type { Viewer } from "@/features/auth/server";
import { queries } from "./server/queries";

// The items feature's server boundary for pages (plan D8): the reads a server component makes, each scoped to the
// Viewer that requireSession() returned. Changes go through the Server Actions in actions.ts.

// input is { cursor? }: a page's nextCursor; a cursor this app did not make is invalid_input.
export const listItems = (viewer: Viewer, input: unknown) =>
  queries().list(viewer, input);

// The viewer's item, or null: another user's, a deleted one and an id that is no UUID are all not found.
export const getItem = (viewer: Viewer, id: string) =>
  queries().get(viewer, id);
