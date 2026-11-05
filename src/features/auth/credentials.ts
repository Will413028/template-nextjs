import { z } from "zod";

// The sign-up and sign-in input rules, the one source for the forms and the server
// (ADR auth-and-sign-in-throttling D1, deviation 6: zod instead of OpenAPI). Lengths count code points, as
// template-go-nextjs's contract does. users_username_check in schema.ts is the database's copy of the username rule.

const codePoints = (s: string) => [...s].length;

// What a field can be wrong with: the forms translate each (auth.fields in messages/*.json, checked by tsc).
const FIELD_CODES = [
  "required",
  "too_short",
  "too_long",
  "invalid_characters",
  "username_taken",
  "password_too_common",
  "invalid",
] as const;
export type FieldCode = (typeof FIELD_CODES)[number];

const issue = (message: FieldCode) => ({ message });

const length = (min: number, max: number) =>
  z
    .string()
    .refine((s) => codePoints(s) >= min, issue("too_short"))
    .refine((s) => codePoints(s) <= max, issue("too_long"));

export const signUpInput = z.object({
  username: length(3, 50).refine(
    (s) => /^[A-Za-z0-9_.-]*$/.test(s),
    issue("invalid_characters"),
  ),
  // NIST SP 800-63B-4: 15 or more, no composition rules; the common-password check runs on the server. The minimum
  // counts the NFKC form the server hashes, which can be shorter than what was typed; the maximum counts the input
  // (ADR auth-and-sign-in-throttling D1, deviation 8; template-go-nextjs counts the input for both).
  password: z
    .string()
    .refine((s) => codePoints(s.normalize("NFKC")) >= 15, issue("too_short"))
    .refine((s) => codePoints(s) <= 128, issue("too_long")),
});

export const signInInput = z.object({
  username: length(1, 50),
  password: length(1, 128),
});

export type FieldErrors = Partial<Record<"username" | "password", FieldCode>>;

const isFieldCode = (s: string): s is FieldCode =>
  (FIELD_CODES as readonly string[]).includes(s);

// The first problem of each field, as a code the forms translate. A message that is not a FieldCode (a zod default)
// becomes "invalid", so the form never shows a raw message.
export function fieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const problem of error.issues) {
    const field = problem.path[0];
    if ((field === "username" || field === "password") && !fields[field]) {
      const code =
        problem.code === "invalid_type" ? "required" : problem.message;
      fields[field] = isFieldCode(code) ? code : "invalid";
    }
  }
  return fields;
}
