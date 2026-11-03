import "server-only";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import {
  type Algorithm,
  hash as argon2Hash,
  verify as argon2Verify,
} from "@node-rs/argon2";

// Password storage (docs/adr/2026-10-18-api-and-auth-baseline.md D6 in template-go-nextjs; NIST SP 800-63B-4,
// OWASP Password Storage Cheat Sheet).

// NFKC is applied before a password is checked against the list or hashed, so the same password typed with
// full-width or half-width characters is the same password. Length limits count the raw input.
export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

// OWASP's argon2id minimum: 19 MiB, 2 iterations, 1 thread.
export type Argon2Params = {
  memoryKiB: number;
  time: number;
  threads: number;
};
export const DEFAULT_ARGON2: Argon2Params = {
  memoryKiB: 19 * 1024,
  time: 2,
  threads: 1,
};

// @node-rs/argon2 declares Algorithm as a const enum, which isolatedModules cannot read; 2 is Argon2id.
const ARGON2ID = 2 as Algorithm;

export type PasswordHasher = {
  hash(password: string): Promise<string>;
  // A hash that does not parse is a mismatch, not an error.
  verify(password: string, encoded: string): Promise<boolean>;
};

type Argon2 = {
  hash: (password: string, params: Argon2Params) => Promise<string>;
  verify: (encoded: string, password: string) => Promise<boolean>;
};

const nodeArgon2: Argon2 = {
  hash: (password, p) =>
    argon2Hash(password, {
      algorithm: ARGON2ID,
      memoryCost: p.memoryKiB,
      timeCost: p.time,
      parallelism: p.threads,
    }),
  // verify reads the parameters stored in the hash, so hashes made with older parameters still verify
  verify: (encoded, password) => argon2Verify(encoded, password),
};

// @node-rs/argon2 hashes on libuv's thread pool, which Node.js sizes at 4 unless UV_THREADPOOL_SIZE says otherwise;
// the same pool serves dns.lookup (new database connections) and fs. One worker stays free for them, so a burst of
// sign-ins cannot stall every other request.
const LIBUV_POOL = 4;
const DEFAULT_MAX_CONCURRENT = Math.max(
  1,
  Math.min(availableParallelism(), LIBUV_POOL - 1),
);

// Each hash holds memoryKiB while it runs, so at most maxConcurrent run at once; the rest wait in order.
export function createHasher(
  options: {
    params?: Argon2Params;
    maxConcurrent?: number;
    argon2?: Argon2;
  } = {},
): PasswordHasher {
  const params = options.params ?? DEFAULT_ARGON2;
  const argon2 = options.argon2 ?? nodeArgon2;
  const slots = semaphore(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  return {
    hash: (password) => slots.run(() => argon2.hash(password, params)),
    verify: (password, encoded) =>
      slots.run(async () => {
        try {
          return await argon2.verify(encoded, password);
        } catch {
          // @node-rs/argon2 throws on a hash it cannot decode; Go's Verify reports a mismatch
          return false;
        }
      }),
  };
}

function semaphore(size: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (running < size) {
        running++;
      } else {
        // a finishing task hands its slot straight to the first waiter, so no newcomer takes it in between
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      try {
        return await task();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else running--;
      }
    },
  };
}

// common-passwords.txt is SecLists Passwords/Common-Credentials/Pwdb_top-1000000.txt at commit
// 12274c98fdebe98c7a7284914436a472ed469aed (sha256 e9a88f67aafe65496682dc374559ee714e978bee50314767494c3e37a18c9fc8,
// MIT, see LICENSE-SecLists), keeping only the distinct lines of at least 15 code points: shorter ones can never be
// a valid password here. The same file as template-go-nextjs. To refresh it, download the file at a new commit,
// check its hash, and keep the lines of at least 15 Unicode code points (not bytes), in their original order.
// next.config.ts traces it into the standalone output; the server runs from the project root.
const COMMON_PASSWORDS = join(
  process.cwd(),
  "src/features/auth/server/common-passwords.txt",
);

let common: Set<string> | undefined;

// Whether the normalized password is on the list. The match is exact: the list already holds the common case
// variants.
export function isCommonPassword(normalized: string): boolean {
  common ??= new Set(
    readFileSync(COMMON_PASSWORDS, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.normalize("NFKC")),
  );
  return common.has(normalized);
}
