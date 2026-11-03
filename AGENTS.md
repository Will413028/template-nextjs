# template-nextjs

Fullstack template built only on Next.js (no separate backend service): Server Actions, Drizzle on PostgreSQL 18, Docker Compose behind Caddy. A sibling of `template-go-nextjs` and `template-fastapi-nextjs`; it shares no code with them.

Status: walking skeleton (home page, i18n, CSP, `/api/health`, migrations, compose stack, CI). Auth and items land in later steps of `docs/plans/2026-11-03-nextjs-template.md`.

## Verification

- Branch model: daily work goes to `dev`; `main` changes only through a `dev`→`main` PR merged with a merge commit (no squash, no rebase); never push to `main` directly. The pre-push hook compares against `origin/main` (the released code) on purpose.
- `pnpm check` runs everything CI's app job runs: TypeScript and Biome (`pnpm lint`), knip (`pnpm check:deps`), dependency-cruiser (`pnpm check:arch`), migration checks and squawk (`pnpm check:migrations`), the unit tests (`pnpm test:report`), the locks (`pnpm check:locks`) and `next build`. A task is complete only when it passes locally and CI is green.
- Integration tests (`test/integration/`, `pnpm test:integration`) start PostgreSQL 18 in Docker with testcontainers and the production role setup. CI's app job runs them after `pnpm check`; `pnpm check` and the pre-push hook leave them out, so a shared dev machine never starts database containers. The compose stack job also runs only in CI. Browser and E2E tests run only in CI.
- `make lint-docker` (hadolint, pinned with checksums in the `Makefile`) checks the Dockerfile; every finding fails, infos included.
- `git push` runs CI's checks first through the lefthook pre-push hook (all but the integration tests, the rename smoke test and the compose stack job, except its `make lint-docker`); it needs `actionlint`, `zizmor`, `gitleaks` and `osv-scanner` installed. Do not skip it with `--no-verify`.
- Suppression comments (`biome-ignore`, `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, `-- squawk-ignore`) and the number of unit and integration tests run are locked in `scripts/quality-locks.json`; `scripts/check_locks.py` fails when a count differs (unit tests: pre-push and CI; integration tests: CI). Suppressions only go down and tests only up: update the lock in the same commit.
- A commit that edits a checker's configuration (`biome.json`, `.dependency-cruiser.cjs`, `knip.config.ts`, `tsconfig.json`, `vitest.config.mts`, `.squawk.toml`, `lefthook.yml`, any `osv-scanner.toml`, the check scripts) or moves a lock the bad way carries a `Quality-Gate: <why>` trailer, and a commit over 1,000 changed lines (files `.gitattributes` marks `linguist-generated` not counted) is split or carries a `Large-Change: <why>` trailer; `scripts/check_commit_policy.py` checks both at commit time (lefthook) and for every pushed commit (CI and pre-push).
- Tests run in random order (vitest `sequence.shuffle`); a failure prints its seed, and `--sequence.seed=<seed>` replays it. A test that must run in order says so with `{ shuffle: false }` and a comment.
- A bug fix starts with a test that fails because of the bug; the fix makes it pass, and the commit keeps the test.
- Cover observable behavior, failure conditions, and regressions; do not add tests per module or function when existing tests already cover the behavior. Docs-only or formatting changes need only the relevant static checks.

## Constraints

- Tables are defined only in `src/features/<name>/schema.ts`; migrations come from `make generate-migration MSG=<name>` (drizzle-kit). Hand-written SQL only for a data backfill or lock-free steps squawk asks for (`docs/rules/database-design.md`). A migration merged into `main` never changes; add a new one.
- drizzle-kit refuses to generate when no `schema.ts` exists yet; the first feature with tables adds one.
- `make down-v` deletes the Postgres volume and all local data.
- Never commit `.env` or `.secrets/`; add new variables to `.env-example`.
- Agents do not add or upgrade dependencies on their own: list each package and version, confirm the package exists and was not registered recently (deps.dev shows publish dates), and wait for approval before installing.
- Fix known vulnerabilities (`osv-scanner` over `pnpm-lock.yaml`, `pnpm audit`, Dependabot alerts; the Security workflow rescans the default branch `dev`, which contains all of `main`, every Monday) by severity: critical within 7 days, high within 30 days, medium within 90 days, low at the next routine upgrade. osv-scanner blocks any finding; an advisory that cannot be fixed at once goes into an `osv-scanner.toml` next to the lockfile as `[[IgnoredVulns]]` with `ignoreUntil` set to its deadline and a `reason`, so the scan fails again when the deadline passes.
- `cacheComponents` stays off: a prerendered shell carries scripts without the request's CSP nonce and the page never hydrates. Turning it on needs a decision on the CSP first.
- `docs/plans/` is the plan and its step 0 spike record: the spike sources there are frozen evidence, not code this repository builds, lints or scans.

## Structure

```
├── src/
│   ├── app/                  # routes: [locale]/ pages, api/health (the only Route Handler so far)
│   ├── features/<name>/      # vertical slices (from step 2): schema.ts, server/, actions.ts, components/
│   ├── server/               # kernel: db.ts (app-role pool), env.ts (server configuration)
│   ├── lib/                  # client-safe utilities (env.ts: NODE_ENV only)
│   ├── i18n/                 # next-intl routing, request config, navigation
│   └── proxy.ts              # locale routing + per-request CSP nonce
├── messages/                 # en.json, zh-TW.json (same keys; a test checks)
├── migrations/               # drizzle-kit SQL migrations and meta/
├── scripts/                  # migrate.mts (compose migrate service), check scripts, rename, init_env
├── test/integration/         # testcontainers PostgreSQL tests
├── deploy/                   # Caddyfile, PostgreSQL initdb (roles)
├── docker-compose.yml        # postgres → migrate → app → caddy (only caddy publishes ports)
├── docker-compose.dev.yml    # next dev in the app container, caddy on 127.0.0.1:3000
├── Dockerfile                # targets: dev, migrate, runner (standalone, non-root)
└── docs/rules/               # design rules (database)
```

## Dependency direction

`pnpm check:arch` (CI and pre-push) enforces these rules from `.dependency-cruiser.cjs`, with no exceptions:

| Layer | May import |
|---|---|
| `app/` | everything below it; a feature only through `features/<name>/index.ts`, `server.ts` or `schema.ts` |
| `features/<name>/` | its own files, shared layers, `server/`; another feature only through its `index.ts`, `server.ts` or `schema.ts`; never `app/` |
| `features/auth/` | the base feature: no other feature |
| `features/<name>/schema.ts` | only `drizzle-orm` (table builders, `sql`; no driver) and other features' `schema.ts` (drizzle-kit loads it outside Next.js) |
| `server/` (kernel) | only `lib/` |
| `lib/`, `components/`, `hooks/`, `i18n/` (shared) | each other; never `features/`, `app/` or `server/` |

- No import cycles anywhere.
- The database (`src/server/db.ts`, `pg`, `drizzle-orm/node-postgres`) is imported only from `features/*/server/**`, `src/server/**` and `app/api/health/route.ts`; drizzle-orm's query builder (`eq`, `sql`) holds no connection and is not restricted. `src/__tests__/architecture.test.ts` breaks these rules on purpose and checks that dependency-cruiser reports them (pnpm resolves packages under `node_modules/.pnpm/`, which a rule's pattern must match).
- Code that can reach the browser (`features/*/index.ts`, `features/*/components/**`, `components/**`, `hooks/**`) never imports `server.ts`, `server/**` or `src/server/**`. Every server module starts with `import "server-only"` (a test checks), so a client component that reaches one through other modules fails `next build`.
- Server configuration is read only in `src/server/env.ts` (Biome `noProcessEnv`; `src/lib/env.ts` reads only `NODE_ENV`).

A derived project that adds a layer adds it to the table and to the matching rule in `.dependency-cruiser.cjs` in the same commit. Fix a violation by moving code, not by adding an exception.

## Quick reference

```bash
make init-env                       # Create .env and the database password files in .secrets/
make dev                            # Dev stack on http://localhost:3000 (next dev behind caddy)
make up                             # Production stack on http://localhost (builds, waits for health)
make down / make down-v             # Stop / stop and delete volumes
make migration                      # Apply migrations to the running stack
make generate-migration MSG=<name>  # Next migration from the features' schema.ts
make rename NAME=<name>             # Rename a fresh clone (optional REPO=owner/name)
make lint-docker                    # hadolint
pnpm check                          # Everything CI's app job runs
pnpm test                           # unit tests
pnpm test:integration               # PostgreSQL integration tests (Docker; CI runs them)
```

## Design rules

Read before changing the matching area:

- **Database**: `docs/rules/database-design.md` — naming, types, migrations, roles.
