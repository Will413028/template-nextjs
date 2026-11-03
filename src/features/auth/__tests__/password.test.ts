import { describe, expect, it } from "vitest";
import {
  createHasher,
  DEFAULT_ARGON2,
  isCommonPassword,
  normalizePassword,
} from "../server/password";

const cheap = { memoryKiB: 64, time: 1, threads: 1 };

describe("argon2id hasher", () => {
  it("hashes with OWASP's argon2id parameters and verifies hashes made with others", async () => {
    const hasher = createHasher();
    const encoded = await hasher.hash("correct horse battery staple");
    expect(encoded.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(DEFAULT_ARGON2).toEqual({ memoryKiB: 19456, time: 2, threads: 1 });
    expect(await hasher.verify("correct horse battery staple", encoded)).toBe(
      true,
    );
    expect(await hasher.verify("correct horse battery stapler", encoded)).toBe(
      false,
    );
    const other = await createHasher({ params: cheap }).hash("pw");
    expect(await hasher.verify("pw", other)).toBe(true);
  });

  it.each([
    "",
    "$2b$12$abc",
    "$argon2id$v=19$m=0,t=1,p=1$c2FsdA$a2V5",
    "$argon2id$v=19$m=64,t=1,p=1$!$a2V5",
  ])("treats the unparsable hash %j as a mismatch", async (bad) => {
    expect(await createHasher({ params: cheap }).verify("pw", bad)).toBe(false);
  });

  it("runs at most maxConcurrent hashes at once", async () => {
    let running = 0;
    let peak = 0;
    const slow = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return "hash";
    };
    const hasher = createHasher({
      maxConcurrent: 2,
      argon2: { hash: slow, verify: async () => (await slow()) === "hash" },
    });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        i % 2 ? hasher.hash("password") : hasher.verify("password", "x"),
      ),
    );
    expect(peak).toBe(2);
    expect(running).toBe(0);
  });
});

describe("password rules", () => {
  it("folds full-width characters with NFKC", () => {
    expect(
      normalizePassword("ｃｏｒｒｅｃｔ－ｈｏｒｓｅ－ｂａｔｔｅｒｙ"),
    ).toBe("correct-horse-battery");
  });

  it("finds a 15-character password on the common-password list", () => {
    expect(isCommonPassword("demon1q2w3e4r5t")).toBe(true);
    expect(isCommonPassword("a phrase nobody has used before")).toBe(false);
  });
});
