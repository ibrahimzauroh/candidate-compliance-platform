# Candidate Compliance Platform

## Overview

This repository is the foundation for a secure, multi-tenant candidate compliance module. The current phase contains the workspace, local infrastructure, core relational tenant model, deterministic development seed, platform authentication, validated tenant context, operation-specific authorisation, tenant-scoped Candidate and ComplianceDocument APIs, API health endpoint, and minimal web shell. Audit, verification, AI, and frontend workflows are intentionally not implemented yet.

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

- Node.js 24 or later
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

The supported local variables are documented in `.env.example`. `DATABASE_URL` uses the restricted runtime role, while `DIRECT_DATABASE_URL` uses the local schema-owner role for migrations and seeding. The checked-in credentials are development-only examples. Do not commit `.env` files.

## Database setup

Start local PostgreSQL:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm db:check
```

The Compose service uses a neutral database and local-only credentials. The RLS migration provisions the restricted `candidate_compliance_app` role; the API and security tests use it automatically through `DATABASE_URL`. No paid service is required.

## Migrations

Apply existing migrations or create a development migration after an approved schema change with:

```bash
pnpm db:migrate
```

Prisma migrations are treated as forward-only in this project; a production rollback requires an explicitly reviewed compensating migration or approved database recovery procedure, not a destructive reset command.

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

Authentication does not select a tenant or grant tenant permissions. Tenant context and operation-specific authorisation remain separate layers.

## Tenant context

Tenant-scoped requests must provide the selected tenant as an `X-Tenant-Id` header. The API treats this client value as untrusted and establishes context only when the authenticated user has a matching current membership.

The context probe demonstrates the validated request boundary:

```bash
curl http://localhost:4000/api/v1/context \
  -H "Authorization: Bearer <access-token>" \
  -H "X-Tenant-Id: 10000000-0000-4000-8000-000000000001"
```

The resulting role belongs only to the selected membership. Tenant-owned database work must use `withTenantTransaction`, which applies the validated tenant ID transaction-locally before PostgreSQL RLS evaluates queries. Membership alone does not grant every operation; protected business routes must also apply the appropriate `requirePermission` middleware.

## Candidate API

Candidate routes require both a Bearer access token and validated `X-Tenant-Id` header. Candidate mutations also require an `Idempotency-Key` header:

```text
POST   /api/v1/candidates
GET    /api/v1/candidates
GET    /api/v1/candidates/:candidateId
PATCH  /api/v1/candidates/:candidateId
```

Lists accept bounded `page` and `pageSize` pagination plus optional `search`, exact `email`, and partial `roleAppliedFor` filters. Candidate ownership always comes from the validated tenant context; `tenantId` is neither accepted in write bodies nor exposed in candidate responses. An identical mutation retry with the same idempotency key replays its original response, while reuse for different input returns `409 Conflict`.

See [docs/api.md](docs/api.md) for the current developer-facing Candidate API reference. The implemented Candidate surface is create, list, retrieve, and update. Candidate deletion remains outstanding, and Phase 2 is not fully aligned with the tenant-scoped CRUD requirement until its policy is decided after reviewing compliance-document lifecycle and audit-history implications.

## ComplianceDocument API

The current document surface creates a logical document with version 1, lists a candidate's documents, retrieves a document's current version, and appends a new version:

```text
POST  /api/v1/candidates/:candidateId/documents
GET   /api/v1/candidates/:candidateId/documents
GET   /api/v1/documents/:documentId
GET   /api/v1/documents/expiring
POST  /api/v1/documents/:documentId/versions
```

New versions start as `DRAFT`; tenant ownership, creator membership, version number, and current-version selection are server-controlled. Document mutations require an `Idempotency-Key`. The expiring-documents route returns current versions expiring from today through day 30 for the validated tenant. See [docs/api.md](docs/api.md) for payloads, pagination, filters, responses, and current lifecycle limitations.

## Audit ledger

Candidate and compliance-document creates, updates, version creation, retrievals, paginated lists, and expiring-document results append tenant-scoped audit events. Mutation events commit atomically with the domain write and idempotency record; an idempotent replay does not append another mutation event. Events store actor and membership identifiers, the affected record identity, and canonical SHA-256 before/after hashes rather than raw candidate or document state.

List reads append one event for each record actually returned, bounded by the existing maximum page size of 100. Empty pages therefore create no record-level event. The restricted runtime role may only insert audit rows; forced RLS checks tenant ownership, and update/delete privileges are withheld. No audit browsing or export API is implemented.

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

An OpenAPI 3 document will be completed in Sub-phase 2E. The current API exposes the unversioned health check plus versioned login, authenticated identity, validated tenant context, Candidate, and ComplianceDocument endpoints.

## Demo users

The local seeded identities and development-only password are documented under Seed data. They work with `POST /api/v1/auth/login` after the database is seeded and the API is running.

## Security notes

No production secrets are stored in the repository. The checked-in database and JWT values are explicitly local-only. Tenant-owned tables are protected by PostgreSQL row-level security for the restricted runtime role. Future tenant-owned routes must apply operation-specific authorisation and define their audit behaviour explicitly.

## AI assistant usage

AI was used for implementation acceleration, refactoring suggestions, test generation ideas, and documentation review. Architecture, tenancy strategy, authorisation model, data model, security boundaries, trade-offs, and final review are decided and validated by the engineer. Generated code is reviewed, changed where necessary, and tested before inclusion.

## Known limitations

- Candidate and ComplianceDocument deletion and OpenAPI remain deferred.
- Production idempotency-record retention and cleanup policy remains an operational decision.
- Audit browsing/export, retention, and external log forwarding are not implemented.
- Empty list pages do not create an audit row because the ledger records each returned record rather than query intent.
- Approved-version immutability and explicit correction/supersession rules remain deferred to a later Phase 3 sub-phase.
- No frontend business screens are present.
- Production deployment and observability are outside this foundation phase.
