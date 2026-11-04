COMPOSE = docker compose
COMPOSE_DEV = $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

# --- Stack ---

.PHONY: up
up:
	$(COMPOSE) up -d --build --wait
	@echo "\nStack started: http://localhost"

.PHONY: dev
dev:
	@echo "Dev stack: http://localhost:3000 (next dev behind caddy; edits under src/ and messages/ reload)"
	$(COMPOSE_DEV) up --build

.PHONY: down
down:
	$(COMPOSE) down

# Deletes the Postgres volume and all local data.
.PHONY: down-v
down-v:
	$(COMPOSE) down -v

.PHONY: build
build:
	$(COMPOSE) build

.PHONY: logs
logs:
	$(COMPOSE) logs -f

.PHONY: status
status:
	$(COMPOSE) ps

# --- Database ---

# Applies migrations/ to the running stack's database (rebuilds the migrate image, runs it once).
.PHONY: migration
migration:
	$(COMPOSE) build migrate
	$(COMPOSE) run --rm migrate

# Writes the next migrations/<n>_<name>.sql from the features' schema.ts files (needs no database); apply it with
# `make migration`.
.PHONY: generate-migration
generate-migration:
	@test -n "$(MSG)" || { echo "usage: make generate-migration MSG=<name>"; exit 1; }
	pnpm exec drizzle-kit generate --name "$(MSG)"

# --- Setup ---

# >>> template-only
# Generates a new project into DEST (missing or empty): names, database and role names, repository link (default
# Will413028/<NAME>; REPO= overrides it); a new git repository with one commit and no remote.
.PHONY: new
new:
ifndef NAME
	$(error NAME and DEST are required. Usage: make new NAME=my-project DEST=../my-project [REPO=owner/my-project])
endif
ifndef DEST
	$(error NAME and DEST are required. Usage: make new NAME=my-project DEST=../my-project [REPO=owner/my-project])
endif
	@python3 template/new_project.py "$(NAME)" "$(DEST)" $(if $(REPO),--repo "$(REPO)")
# <<< template-only

# ruff and diff-cover (requirements-dev.txt, pinned with hashes) in .venv, for pnpm lint:py and CI's coverage check.
# uv when installed, else the standard library's venv and pip.
.PHONY: py-tools
py-tools:
	@if command -v uv > /dev/null; then uv venv -q --allow-existing .venv && uv pip install -q --python .venv/bin/python --require-hashes -r requirements-dev.txt; \
	else python3 -m venv .venv && .venv/bin/pip install -q --require-hashes -r requirements-dev.txt; fi

.PHONY: init-env
init-env:
	@python3 scripts/init_env.py

# --- Checks ---

# Everything CI's app job runs (lint, dependency rules, migrations, tests, locks, build).
.PHONY: check
check:
	pnpm check

# hadolint is installed from its release binary; the checksums are the release's checksums.sha256.
HADOLINT_VERSION := 2.15.1
HADOLINT := bin/hadolint
HADOLINT_SHA256_macos-arm64  := 5c09f3213f8e40406abe048233d985eebef336d4a6a20021be47fadb6cf480a2
HADOLINT_SHA256_linux-x86_64 := c7187db94eeeeca956519a6af171adc31453941a1e777961f6e680f697c8c507
HADOLINT_SHA256_linux-arm64  := f6198ef8090f404dbb771abfee086eb8c48ac177f30da7fd3510aca35b344b5d
HADOLINT_PLATFORM := $(subst darwin,macos,$(shell uname -s | tr A-Z a-z))-$(subst aarch64,arm64,$(shell uname -m))

# Every finding fails, infos included (hadolint's default threshold).
.PHONY: lint-docker
lint-docker: $(HADOLINT)
	$(HADOLINT) Dockerfile

$(HADOLINT):
	@sum="$(HADOLINT_SHA256_$(HADOLINT_PLATFORM))"; \
	if [ -z "$$sum" ]; then echo "no hadolint checksum for $(HADOLINT_PLATFORM)"; exit 1; fi; \
	mkdir -p bin && \
	curl -sSfL -o $@.tmp "https://github.com/hadolint/hadolint/releases/download/v$(HADOLINT_VERSION)/hadolint-$(HADOLINT_PLATFORM)" && \
	echo "$$sum  $@.tmp" | shasum -a 256 -c - && \
	chmod 0755 $@.tmp && mv $@.tmp $@
