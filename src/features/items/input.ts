import { z } from "zod";

// The item input rules, the one source for the forms and the queries (plan D2 deviation 9: zod instead of OpenAPI),
// ported from template-go-nextjs api/openapi.yaml at 560106d (ItemTitle, CreateItemRequest, ItemPatch, Limit,
// Cursor). Titles count code points; items_title_check in schema.ts is the database's copy of the title rule. A
// description has no limit of its own, as in Go: the Server Action body limit bounds it.

const TITLE_MAX = 200;
// Items per page when the caller names no limit, and the most it may name.
export const PAGE_SIZE = 20;
const PAGE_SIZE_MAX = 100;

// What a field can be wrong with: the forms translate each (items.fields in messages/*.json, checked by tsc).
const FIELD_CODES = [
  "required",
  "too_short",
  "too_long",
  "null_not_allowed",
  "out_of_range",
  "invalid",
] as const;
export type FieldCode = (typeof FIELD_CODES)[number];
type Field = "title" | "description" | "limit" | "cursor";
export type FieldErrors = Partial<Record<Field, FieldCode>>;

const codePoints = (s: string) => [...s].length;

// A value of the wrong type: missing, null or anything else, each with its own code.
const typeError = (issue: { input?: unknown }): FieldCode =>
  issue.input === undefined
    ? "required"
    : issue.input === null
      ? "null_not_allowed"
      : "invalid";

const title = z
  .string({ error: typeError })
  .refine((s) => codePoints(s) >= 1, { message: "too_short" })
  .refine((s) => codePoints(s) <= TITLE_MAX, { message: "too_long" });

const description = z.string({ error: () => "invalid" }).nullable();

const newItem = z.object({ title, description: description.optional() });
const itemPatch = z.object({
  title: title.optional(),
  description: description.optional(),
});
const page = z.object({
  limit: z
    .number({ error: () => "invalid" })
    .int({ error: "invalid" })
    .min(1, { error: "out_of_range" })
    .max(PAGE_SIZE_MAX, { error: "out_of_range" })
    .optional(),
  cursor: z.string({ error: () => "invalid" }).optional(),
});

export type NewItem = { title: string; description: string | null };
// An omitted field stays as it is; description: null clears it (Go's JSON Merge Patch, RFC 7396).
export type ItemPatch = { title?: string; description?: string | null };
export type PageRequest = { limit: number; cursor?: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

const isFieldCode = (s: string): s is FieldCode =>
  (FIELD_CODES as readonly string[]).includes(s);

// Input that is not an object has none of the fields.
const asObject = (input: unknown) =>
  input && typeof input === "object" && !Array.isArray(input) ? input : {};

function parse<T>(schema: z.ZodType<T>, input: unknown): Parsed<T> {
  const parsed = schema.safeParse(asObject(input));
  if (parsed.success) return { ok: true, value: parsed.data };
  // the first problem of each field, as a code the forms translate; a message that is no FieldCode is "invalid"
  const fields: FieldErrors = {};
  for (const problem of parsed.error.issues) {
    const field = problem.path[0] as Field;
    fields[field] ??= isFieldCode(problem.message)
      ? problem.message
      : "invalid";
  }
  return { ok: false, fields };
}

export function parseNewItem(input: unknown): Parsed<NewItem> {
  const parsed = parse(newItem, input);
  return parsed.ok
    ? {
        ok: true,
        value: {
          title: parsed.value.title,
          description: parsed.value.description ?? null,
        },
      }
    : parsed;
}

export const parseItemPatch = (input: unknown): Parsed<ItemPatch> =>
  parse(itemPatch, input);

export function parsePage(input: unknown): Parsed<PageRequest> {
  const parsed = parse(page, input);
  if (!parsed.ok) return parsed;
  const { limit = PAGE_SIZE, cursor } = parsed.value;
  return {
    ok: true,
    value: cursor === undefined ? { limit } : { limit, cursor },
  };
}

// A form's fields as the object the rules take. A form cannot send null, so its empty description means none; other
// input keeps an empty description, as Go does.
export function fromForm(input: unknown): unknown {
  if (!(input instanceof FormData)) return input;
  const fields: Record<string, unknown> = Object.fromEntries(input);
  if (fields.description === "") fields.description = null;
  return fields;
}
