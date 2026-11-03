# template-nextjs

A fullstack template built only on Next.js: Server Actions instead of a separate backend, Drizzle on PostgreSQL 18,
next-intl (en, zh-TW), a per-request CSP nonce, and a Docker Compose stack behind Caddy for a single VPS.

## Start a project from it

```bash
git clone https://github.com/Will413028/template-nextjs.git my-project
cd my-project
make rename NAME=my-project     # package, database and role names, branding
make init-env                   # .env and the database password files in .secrets/
make up                         # http://localhost
```

`make dev` runs `next dev` inside the stack on http://localhost:3000. `pnpm check` runs every check CI runs (Node.js
26, pnpm from `packageManager`, Docker for the integration tests).

The project is disconnected from the template after `make rename`: later template fixes do not reach it.

See `AGENTS.md` for the structure, dependency rules and checks, and `docs/rules/` for the design rules.
