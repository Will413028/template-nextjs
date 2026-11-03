# template-nextjs

A fullstack template built only on Next.js: Server Actions instead of a separate backend, Drizzle on PostgreSQL 18,
next-intl (en, zh-TW), a per-request CSP nonce, and a Docker Compose stack behind Caddy for a single VPS.

## Start a project from it

```bash
git clone https://github.com/Will413028/template-nextjs.git
cd template-nextjs
make new NAME=my-project DEST=../my-project   # package, database and role names, branding, repository link
cd ../my-project
pnpm install
make init-env                                 # .env and the database password files in .secrets/
make up                                       # http://localhost
```

`make new` copies the template's last commit (the checkout must be clean) into a new directory, leaving out the
template's own parts (`template/`, `docs/plans/`, the generate job), and starts a new git repository there with one
commit and no remote. The repository link (the advisory form in `SECURITY.md`) becomes `Will413028/<NAME>`;
`REPO=owner/name` points it at another repository. The new project is disconnected from the template: later template
fixes do not reach it.

`make dev` runs `next dev` inside the stack on http://localhost:3000. `pnpm check` runs CI's checks except the ones that
start containers (Node.js 26, pnpm from `packageManager`); CI also runs `pnpm test:integration` and the compose stack.

See `AGENTS.md` for the structure, dependency rules and checks, and `docs/rules/` for the design rules.
