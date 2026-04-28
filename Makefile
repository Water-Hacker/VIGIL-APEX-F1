# VIGIL APEX — Developer Entry Points
# Per OPERATIONS.md §1-3.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

# --- Help ---------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_.-]+:.*?##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Setup --------------------------------------------------------------------
.PHONY: setup
setup: ## Install all workspace dependencies + git hooks
	pnpm install --frozen-lockfile
	pnpm exec husky install || true

.PHONY: setup-system
setup-system: ## (sudo) Install system tooling (ykman, tor, age, pandoc, libreoffice)
	bash scripts/setup-system-tooling.sh

# --- Quality gates ------------------------------------------------------------
.PHONY: lint
lint: ## Run ESLint across the workspace
	pnpm run lint

.PHONY: typecheck
typecheck: ## Run tsc across the workspace
	pnpm run typecheck

.PHONY: test
test: ## Run unit tests across the workspace
	pnpm run test

.PHONY: test-coverage
test-coverage: ## Run tests with coverage
	pnpm run test:coverage

.PHONY: format
format: ## Auto-format all files with prettier
	pnpm run format

.PHONY: secrets
secrets: ## Run gitleaks against the working tree (warning-only locally)
	pnpm run audit:secrets

.PHONY: deps
deps: ## Audit dependencies for vulnerabilities
	pnpm run audit:deps

.PHONY: licenses
licenses: ## Summarise license types of production deps
	pnpm run audit:licenses

.PHONY: gates
gates: lint typecheck test secrets ## Run every blocking quality gate

# --- Compose stack ------------------------------------------------------------
.PHONY: compose-up
compose-up: ## Bring the dev stack up
	pnpm run compose:up

.PHONY: compose-down
compose-down: ## Stop the dev stack
	pnpm run compose:down

.PHONY: compose-logs
compose-logs: ## Tail the dev stack logs
	pnpm run compose:logs

.PHONY: compose-health
compose-health: ## Show health of the dev stack
	pnpm run compose:health

# --- Database ----------------------------------------------------------------
.PHONY: db-migrate
db-migrate: ## Run forward migrations
	pnpm run db:migrate

.PHONY: db-seed
db-seed: ## Seed development data
	pnpm run db:seed

.PHONY: db-reset
db-reset: ## Drop and recreate the development DB (destructive)
	pnpm run db:reset

# --- Contracts ----------------------------------------------------------------
.PHONY: contracts-build
contracts-build: ## Compile Solidity contracts
	pnpm run contracts:build

.PHONY: contracts-test
contracts-test: ## Run Hardhat test suite
	pnpm run contracts:test

# --- Audit chain --------------------------------------------------------------
.PHONY: verify-hashchain
verify-hashchain: ## Verify Postgres hash chain integrity (continuous-test CT-01)
	pnpm run verify:hashchain

.PHONY: verify-ledger
verify-ledger: ## Verify Polygon anchor matches local audit-chain root (CT-02)
	pnpm run verify:ledger

# --- Cleanup ------------------------------------------------------------------
.PHONY: clean
clean: ## Remove build outputs and node_modules
	pnpm run clean
