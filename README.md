# Candidate Compliance Platform

## Overview

This repository is the foundation for a secure, multi-tenant candidate compliance module. The current phase contains the workspace, local infrastructure, core relational tenant model, deterministic development seed, platform authentication, validated tenant context, API health endpoint, and minimal web shell. Business APIs, authorisation, audit, verification, AI, and frontend workflows are intentionally not implemented yet.

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
pnpm db:migrate
pnpm db:seed
pnpm db:check
```

The Compose service uses a neutral database and local-only credentials. No paid service is required.

## Migrations

Apply existing migrations or create a development migration after an approved schema change with:

```bash
pnpm db:migrate
```

## Seed data

Run the deterministic development seed with:

```bash
pnpm db:seed
```

### LOCAL DEVELOPMENT / DEMO CREDENTIALS

The seed creates these future login identities:

- `admin@iza.com`
- `recruiter@iza.com`
- `compliance@iza.com`
- `shared@iza.com`
- `khaleel.admin@iza.com`

All seeded users use the development-only password `ComplianceDemo123`.

## Authentication

Set `JWT_SECRET` and `JWT_EXPIRES_IN` in the local `.env` file. The example values are for local development only; production must use a securely managed secret of at least 32 characters.

Log in with a seeded platform identity:

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@iza.com","password":"ComplianceDemo123"}'
```

Pass the returned access token as a Bearer token to resolve the current platform identity:

```bash
curl http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer <access-token>"
```

Authentication does not select a tenant or grant tenant permissions. Tenant context and operation-specific authorisation remain separate, unimplemented layers.

## Tenant context

Tenant-scoped requests must provide the selected tenant as an `X-Tenant-Id` header. The API treats this client value as untrusted and establishes context only when the authenticated user has a matching current membership.

The context probe demonstrates the validated request boundary:

```bash
curl http://localhost:4000/api/v1/context \
  -H "Authorization: Bearer <access-token>" \
  -H "X-Tenant-Id: 10000000-0000-4000-8000-000000000001"
```

The resulting role belongs only to the selected membership. It does not grant operation-specific permissions, which remain a later security layer.

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

The local seeded identities and development-only password are documented under Seed data. They work with `POST /api/v1/auth/login` after the database is seeded and the API is running.

## Security notes

No production secrets are stored in the repository. The checked-in JWT value is explicitly local-only. Tenant membership is validated at the application boundary, but PostgreSQL row-level security, operation-specific authorisation, and audit controls remain required before tenant-owned data is exposed.

## AI assistant usage

AI was used for implementation acceleration, refactoring suggestions, test generation ideas, and documentation review. Architecture, tenancy strategy, authorisation model, data model, security boundaries, trade-offs, and final review are decided and validated by the engineer. Generated code is reviewed, changed where necessary, and tested before inclusion.

## Known limitations

- Operation-specific authorisation and PostgreSQL row-level security are not implemented.
- No business endpoints or frontend business screens are present.
- Production deployment and observability are outside this foundation phase.
