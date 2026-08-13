# Candidate Compliance Platform

## Overview

This repository is the foundation for a secure, multi-tenant candidate compliance module. The current phase contains the workspace, local infrastructure, an API health endpoint, and a minimal web shell. Candidate, compliance, audit, verification, AI, and frontend business workflows are intentionally not implemented yet.

## Architecture summary

The project is a pnpm monorepo with an Express API, a Next.js web application, shared validation contracts, and PostgreSQL accessed through Prisma. The intended architecture is a modular monolith; see [docs/architecture.md](docs/architecture.md).

## Technology choices

- Node.js and TypeScript
- Express for the REST API
- Next.js and Tailwind CSS for the web application
- PostgreSQL and Prisma for persistence
- Zod for shared runtime contracts
- Vitest and Supertest for tests
- ESLint and Prettier for code quality

## Prerequisites

- Node.js 20.9 or later
- Corepack
- Docker Desktop or another Docker installation with Compose v2

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

## Environment variables

The supported local variables are documented in `.env.example`. The checked-in values are development-only examples. Do not commit `.env` files.

## Database setup

Start local PostgreSQL:

```bash
docker compose up -d postgres
pnpm db:generate
pnpm db:check
```

The Compose service uses a neutral database and local-only credentials. No paid service is required.

## Migrations

No domain tables or migrations exist in the foundation phase. After a schema change, create a migration with:

```bash
pnpm db:migrate
```

## Seed data

Seed data will be added with authentication and tenancy. There is no seed command in this phase.

## Running API

```bash
pnpm dev:api
```

The health check is available at `GET http://localhost:4000/health`.

## Running frontend

```bash
pnpm dev:web
```

The shell is available at `http://localhost:3000`.

## Running worker

The verification worker is intentionally deferred until the verification workflow phase.

## Running tests

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## OpenAPI

An OpenAPI 3 document will be introduced with the first versioned business endpoints. The unversioned `GET /health` endpoint is the only API route in this phase.

## Demo users

Demo users will be added with authentication. No credentials are included in this phase.

## Security notes

No production secrets are stored in the repository. Tenant isolation, PostgreSQL row-level security, operation-specific authorisation, and audit controls remain required before tenant-owned data is introduced.

## AI assistant usage

AI was used for implementation acceleration, refactoring suggestions, test generation ideas, and documentation review. Architecture, tenancy strategy, authorisation model, data model, security boundaries, trade-offs, and final review are decided and validated by the engineer. Generated code is reviewed, changed where necessary, and tested before inclusion.

## Known limitations

- The database schema contains no domain models yet.
- Authentication and authorisation are not implemented.
- No business endpoints or frontend business screens are present.
- Production deployment and observability are outside this foundation phase.
