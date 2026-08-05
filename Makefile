# xNotes — all workflows run through Docker; the host needs only make + Docker.
# See openspec design D13 and the cross-browser-support spec ("Dockerized developer workflow").

NODE_IMAGE := node:22-bookworm-slim
UNAME := $(shell uname)

ifeq ($(UNAME),Linux)
  # Files created in the mounted repo volume must stay host-user-owned.
  USER_FLAGS := --user $(shell id -u):$(shell id -g) --env HOME=/app/.docker-home
  # A root-owned named volume is not writable by the host user; cache in a
  # host-owned bind dir instead (gitignored).
  CACHE_FLAGS := --env npm_config_cache=/app/.docker-npm-cache
  PREPARE := mkdir -p .docker-home .docker-npm-cache
else
  USER_FLAGS :=
  CACHE_FLAGS := -v xnotes-npm-cache:/root/.npm
  PREPARE := true
endif

DOCKER := docker run --rm $(USER_FLAGS) $(CACHE_FLAGS) -v "$(PWD)":/app -w /app $(NODE_IMAGE)

.PHONY: setup test typecheck lint build zip dev dev-firefox integration flush

setup: ## install dependencies (npm ci when a lockfile exists)
	$(PREPARE)
	$(DOCKER) sh -c 'if [ -f package-lock.json ]; then npm ci; else npm install; fi'

test: ## unit tests
	$(DOCKER) npm test

typecheck:
	$(DOCKER) npm run typecheck

lint:
	$(DOCKER) npm run lint

build: ## chrome + firefox builds
	$(DOCKER) sh -c 'npm run build && npm run build:firefox'

zip: ## store-ready zips (firefox zip includes sources zip automatically)
	$(DOCKER) sh -c 'npm run zip && npm run zip:firefox'

dev: ## chromium dev build with HMR; load .output/xnotes-chrome-mv3 as unpacked
	$(DOCKER) -p 3000:3000 npm run dev -- --port 3000 --host 0.0.0.0

# ponytail: `dev-firefox` not `dev:firefox` — macOS ships GNU make 3.81, which rejects colons in targets
dev-firefox: ## firefox dev build; load .output/xnotes-firefox-mv3
	$(DOCKER) -p 3001:3001 npm run dev:firefox -- --port 3001 --host 0.0.0.0

integration: ## dockerized integration tests (dufs + S3 mock)
	docker compose -f docker/compose.integration.yml up --build --abort-on-container-exit --exit-code-from tests; \
	status=$$?; \
	docker compose -f docker/compose.integration.yml down > /dev/null 2>&1; \
	exit $$status

flush: ## drop the npm cache volume + integration stack leftovers
	docker compose -f docker/compose.integration.yml down -v > /dev/null 2>&1 || true
	docker volume rm -f xnotes-npm-cache > /dev/null 2>&1 || true
	rm -rf .docker-home .docker-npm-cache
