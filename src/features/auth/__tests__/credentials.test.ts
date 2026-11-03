import { describe, expect, it } from "vitest";
import { fieldErrors, signInInput, signUpInput } from "../credentials";

function errors(
  schema: typeof signUpInput | typeof signInInput,
  input: unknown,
) {
  const result = schema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
}

describe("sign-up input", () => {
  it("rejects a 14-character password", () => {
    expect(
      errors(signUpInput, { username: "alice", password: "fourteen chars" }),
    ).toEqual({ password: "too_short" });
  });

  it("has no composition rule: a long all-lowercase password is fine", () => {
    expect(
      errors(signUpInput, {
        username: "alice",
        password: "onlylowercaseletters",
      }),
    ).toEqual({});
  });

  it("counts code points, not UTF-16 units", () => {
    // 15 emoji are 30 UTF-16 units; 129 code points are too many however they are encoded
    expect(
      errors(signUpInput, { username: "alice", password: "😀".repeat(15) }),
    ).toEqual({});
    expect(
      errors(signUpInput, { username: "alice", password: "😀".repeat(129) }),
    ).toEqual({ password: "too_long" });
  });

  it.each([
    ["ab", "too_short"],
    ["a".repeat(51), "too_long"],
    ["al ice", "invalid_characters"],
    ["álice", "invalid_characters"],
  ])("rejects the username %j with %s", (username, code) => {
    expect(
      errors(signUpInput, { username, password: "a long enough password" }),
    ).toEqual({ username: code });
  });

  it("reports missing fields as required", () => {
    expect(errors(signUpInput, {})).toEqual({
      username: "required",
      password: "required",
    });
  });
});

describe("sign-in input", () => {
  it("accepts any non-empty username and password up to the limits", () => {
    expect(errors(signInInput, { username: "A", password: "x" })).toEqual({});
    expect(errors(signInInput, { username: "", password: "" })).toEqual({
      username: "too_short",
      password: "too_short",
    });
  });
});
