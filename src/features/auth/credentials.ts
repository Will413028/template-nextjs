import { z } from "zod";

// The sign-up and sign-in input rules, the one source for the forms and the server (plan D2 deviation 9: zod
// instead of OpenAPI). Lengths count code points, as template-go-nextjs's contract does. users_username_check in
// schema.ts is the database's copy of the username rule.

const codePoints = (s: string) => [...s].length;

const length = (min: number, max: number) =>
  z
    .string()
    .refine((s) => codePoints(s) >= min, { message: "too_short" })
    .refine((s) => codePoints(s) <= max, { message: "too_long" });

export const signUpInput = z.object({
  username: length(3, 50).refine((s) => /^[A-Za-z0-9_.-]*$/.test(s), {
    message: "invalid_characters",
  }),
  // NIST SP 800-63B-4: 15 or more, no composition rules; the common-password check runs on the server
  password: length(15, 128),
});

export const signInInput = z.object({
  username: length(1, 50),
  password: length(1, 128),
});

export type FieldErrors = Partial<Record<"username" | "password", string>>;

// The first problem of each field, as a code the forms translate (messages/*.json).
export function fieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field === "username" || field === "password") && !fields[field]) {
      fields[field] =
        issue.code === "invalid_type" ? "required" : issue.message;
    }
  }
  return fields;
}
