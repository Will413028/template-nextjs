# template-nextjs

A fullstack app built only on Next.js: Server Actions instead of a separate backend, Drizzle on PostgreSQL 18,
next-intl (en, zh-TW), a per-request CSP nonce, and a Docker Compose stack behind Caddy for a single VPS. It starts
with username and password sign-in and an items feature as the example vertical slice.

## Getting started

```bash
pnpm install
make init-env                   # .env and the database password files in .secrets/
make up                         # http://localhost
```

Push it to its repository (`git remote add origin git@github.com:Will413028/template-nextjs.git`, then
`git push -u origin main dev`; make `dev` the default branch); `SECURITY.md` links to that repository's advisory
form. Daily work goes to `dev` (see `AGENTS.md`).

`make dev` runs `next dev` inside the stack on http://localhost:3000. `pnpm check` runs CI's checks except the ones that
start containers (Node.js 26, pnpm from `packageManager`); CI also runs `pnpm test:integration` and the compose stack.

See `AGENTS.md` for the structure, dependency rules and checks, and `docs/rules/` for the design rules.
