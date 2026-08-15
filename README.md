# Candidate Compliance Platform

## Overview

This repository implements a secure, multi-tenant candidate compliance module. It includes local infrastructure, a relational tenant model, deterministic development fixtures, platform authentication, validated tenant context, operation-specific authorisation, tenant-scoped Candidate and ComplianceDocument APIs, an append-only audit ledger, PostgreSQL-backed Right-to-Work verification, governed CV extraction, and a focused authenticated web application. The frontend supports sign-in, actor-scoped membership discovery, backend-validated tenant selection, a protected application shell, Candidate list and creation, Candidate detail, compliance-document list/create/read, immutable version history, approval, governed correction, and human-governed CV proposal review. Candidate editing/removal and the verification and audit frontend workflows remain intentionally deferred.

## Architecture summary

The project is a pnpm monorepo with an Express API, a Next.js web application, shared validation contracts, and PostgreSQL accessed through Prisma. The application is a modular monolith; see [docs/architecture.md](docs/architecture.md).

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
## Local troubleshooting

### PostgreSQL port unavailable on Windows

The default local Compose configuration publishes PostgreSQL on port `5432`.

If Docker reports that port 5432 cannot be bound after a Windows restart, first
check whether another process owns the port and whether Windows has placed it
inside an excluded TCP range:

```powershell
netstat -ano | findstr :5432
netsh interface ipv4 show excludedportrange protocol=tcp
```

If no process owns the port but `5432` falls inside an excluded range, treat this
as a host networking issue rather than an application or migration failure.
Resolve the local port conflict/exclusion before running database-backed tests.
Do not reset or delete the PostgreSQL volume merely to resolve a host port-binding
problem.

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

The seed creates these local login identities:

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

Before selecting a tenant, an authenticated user can discover only their own current membership options:

```bash
curl http://localhost:4000/api/v1/memberships \
  -H "Authorization: Bearer <access-token>"
```

Membership discovery does not require or trust `X-Tenant-Id`, and it does not grant a tenant permission. The response contains only the membership ID, tenant ID, tenant display name, and role needed by a tenant selector. The selected tenant must still be validated through the context endpoint below.

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
DELETE /api/v1/candidates/:candidateId
```

Lists accept bounded `page` and `pageSize` pagination plus optional `search`, exact `email`, and partial `roleAppliedFor` filters. Candidate ownership always comes from the validated tenant context; `tenantId` is neither accepted in write bodies nor exposed in candidate responses. An identical mutation retry with the same idempotency key replays its original response, while reuse for different input returns `409 Conflict`.

`DELETE` requires `candidate:remove` and performs retention-safe logical removal: it marks the Candidate inactive without deleting its row, documents, versions, verification history, CV extraction evidence, confirmed profile, or audit events. Removed Candidates are excluded in database queries and fail closed across normal Candidate, document, verification, and CV operations. Restoration is not exposed. See [docs/api.md](docs/api.md) for the current developer-facing Candidate API reference.

## ComplianceDocument API

The current document surface creates a logical document with version 1, lists and retrieves documents, appends draft versions, approves eligible current versions, and corrects approved current versions through supersession:

```text
POST  /api/v1/candidates/:candidateId/documents
GET   /api/v1/candidates/:candidateId/documents
GET   /api/v1/documents/:documentId
GET   /api/v1/documents/:documentId/versions
GET   /api/v1/documents/expiring
POST  /api/v1/documents/:documentId/versions
POST  /api/v1/documents/:documentId/approve
POST  /api/v1/documents/:documentId/corrections
DELETE /api/v1/documents/:documentId
```

New versions start as `DRAFT`; tenant ownership, creator membership, version number, status transitions, and current-version selection are server-controlled. The authenticated history endpoint returns the complete immutable version chain in ascending version order and identifies the current version without exposing tenant or creator identifiers. A current `DRAFT` or `PENDING_REVIEW` version may be approved, while correcting a current `APPROVED` version creates a new `DRAFT` that supersedes it and atomically becomes current. The approved row is retained unchanged. Document `DELETE` requires `document:remove` and marks only the logical document inactive; every immutable version, correction chain, verification record, and audit event remains stored. Removed documents are excluded from reads, lists, expiry queries, lifecycle writes, and verification API access. All document mutations require an `Idempotency-Key`, use operation-specific permissions, and write their audit event transactionally. The expiring-documents route returns current versions expiring from today through day 30 for the validated tenant. See [docs/api.md](docs/api.md) for payloads, pagination, filters, responses, and lifecycle rules.

## Right-to-Work verification

An approved current `RIGHT_TO_WORK` document version can be submitted to the asynchronous verification workflow:

```text
POST  /api/v1/documents/:documentId/verifications
GET   /api/v1/verifications/:verificationRequestId
```

Submission requires `verification:request` and `Idempotency-Key`; status access requires `verification:read`. The request, outbox event, audit event, and idempotency response commit atomically with initial status `requested`. A separate worker moves the request through `pending` to `verified` or `failed`, using a deterministic local verifier and at most three attempts. Retained verification history is no longer exposed by the API when its document or parent Candidate is removed. Tenant-owned requests and outbox rows remain protected by explicit tenant scoping, restricted runtime privileges, and forced PostgreSQL RLS.

## Governed CV extraction

Existing candidates support an advisory CV extraction workflow:

```text
POST  /api/v1/candidates/:candidateId/cv-extractions
GET   /api/v1/cv-extractions/:extractionId
POST  /api/v1/cv-extractions/:extractionId/confirm
POST  /api/v1/cv-extractions/:extractionId/reject
```

Extraction requires `ai:extract` and an `Idempotency-Key`. The upload is the raw request body with `Content-Type: text/plain` or `application/pdf`, is limited to 2 MiB, and is processed only in memory. Raw CV bytes and extracted text are not retained. 
The deterministic network-free local provider exists to demonstrate the governed extraction boundary rather than production-grade CV parsing accuracy. Its output must pass strict shared validation before a tenant-owned `PROPOSED` result can be stored, and that output remains advisory until a recruiter explicitly confirms or rejects it.

Reading a proposal requires `ai:extract`; confirming or rejecting it requires `ai:confirm` and an `Idempotency-Key`. Confirmation may supply validated recruiter edits and atomically creates or replaces the candidate's small confirmed profile while retaining the original proposal separately. Rejection changes only the proposal. Neither extraction nor rejection changes, scores, ranks, disables, or rejects the Candidate record. PostgreSQL prevents the runtime role from creating a profile without matching accepted extraction evidence or deciding one proposal twice.

## Audit ledger

Candidate and compliance-document creates, updates, retention-safe removals, version creation, retrievals, paginated lists, expiring-document results, verification creation/state transitions, and governed CV proposal decisions append tenant-scoped audit events. Removal hashes distinguish the active before-state from the retained state containing its removal timestamp. Verification status and CV proposal reads are audited as sensitive reads. Mutation events commit atomically with the domain write and idempotency record; an idempotent replay does not append another mutation event. Events store actor and membership identifiers, the affected record identity, and canonical SHA-256 before/after hashes rather than raw candidate, document, CV text, or provider state.

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

The application is available at `http://localhost:3000`. It provides sign-in, membership-based tenant selection, the protected shell, a server-paginated Candidate list with search and supported filters, Add Candidate, Candidate detail, and paginated compliance-document list/create/read screens. A document detail shows the complete immutable version history, permits eligible `DRAFT` or `PENDING_REVIEW` versions to be approved, and offers correction only for an `APPROVED` current version. Correction creates a new `DRAFT`; it never edits approved history. Document creation remains metadata-only rather than a file upload. Candidate detail also accepts a bounded text or PDF CV upload, presents the validated AI output as a visibly non-authoritative proposal, and requires a recruiter to edit and explicitly confirm or reject that proposal. Proposal rejection never rejects the Candidate. Candidate edit/removal and verification and audit screens are not implemented.

The frontend uses same-origin Next.js route handlers as its session boundary. The API JWT remains in an `HttpOnly` cookie and is not returned to browser JavaScript. Tenant selection is constrained to the authenticated actor's discovered memberships and revalidated through the backend context endpoint; client state is never treated as authorisation. Candidate creation, document creation and lifecycle actions, CV extraction, and CV decisions use server-derived idempotency keys, while the Express API remains authoritative for tenant scope, permissions, lifecycle state, AI proposal state, validation, and idempotent replay.

## Running worker

Run the local PostgreSQL-backed verification worker separately from the API:

```bash
pnpm dev:worker
```

The worker uses the deterministic local verifier. It polls the transactional outbox in-process; no Redis, external queue, scheduled infrastructure, or external verification API is required.

## Running tests

```bash
pnpm format:check
pnpm test:web
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Backend end-to-end smoke test

After configuring the disposable local PostgreSQL database and applying the
committed migrations, run the primary backend HTTP journey with one command:

```powershell
$env:E2E_ALLOW_DATABASE_MUTATION = 'true'

try {
  corepack pnpm e2e:smoke

  if ($LASTEXITCODE -ne 0) {
    throw "E2E smoke test failed with exit code $LASTEXITCODE"
  }
}
finally {
  Remove-Item Env:E2E_ALLOW_DATABASE_MUTATION -ErrorAction SilentlyContinue
}
```

The command refuses non-local or production-like database targets, prints only
the redacted host and database name, starts the real Express application on an
ephemeral loopback port, invokes the real verification processor, and cleans up
its listener and database clients after success or failure. It uses unique data
for each run; Candidate, document, workflow, CV, and audit rows are intentionally
retained after logical removal. See [docs/manual-testing.md](docs/manual-testing.md)
for the authoritative cross-platform prerequisites, coverage, and safety
details.

This is a backend smoke test, not a substitute for `pnpm test`. Frontend browser
acceptance remains a separate activity.

## OpenAPI

The canonical OpenAPI 3.1 specification is [docs/openapi.json](docs/openapi.json). It documents the unversioned health check and every registered versioned authentication, tenant-context, Candidate, ComplianceDocument, verification, and governed CV extraction operation.

Validate the specification and its exact synchronisation with the registered Express route/method inventory using:

```bash
pnpm openapi:check
```

The check performs standards-aware OpenAPI 3.1 validation and fails for missing or nonexistent routes, incorrect methods or operation IDs, duplicate operation IDs, or missing security, tenant, idempotency, response, upload, and retention-safe deletion declarations.

## Browser demo

After completing database setup and seeding, start both applications with
`pnpm dev`, or run `pnpm dev:api` and `pnpm dev:web` in separate terminals.
Open `http://localhost:3000`.

All seeded demo accounts use the development-only password `ComplianceDemo123`.

### Recommended happy-path account

For the broadest frontend demonstration, sign in with:

```text
Email: khaleel.admin@iza.com
Password: ComplianceDemo123
Tenant: Khaleel Care Staffing
Role: ADMIN
```

Use this account to exercise the primary browser journey:

1. Sign in.
2. Select **Khaleel Care Staffing**.
3. Open **Candidates**.
4. Create a Candidate.
5. Open the Candidate detail page.
6. Add a compliance document.
7. Open the new `DRAFT` document.
8. Approve the current version.
9. Confirm that it becomes `APPROVED` and is presented as immutable.
10. Create a correction.
11. Confirm that correction creates a new current `DRAFT` rather than modifying
    the approved version.
12. Inspect the retained version history.
13. Return to the Candidate.
14. Upload a text or PDF CV of at most 2 MiB.
15. Review the AI-proposed values.
16. Edit recruiter-confirmed values as required.
17. Explicitly confirm or reject the proposal.

The deterministic local CV provider demonstrates the governed extraction boundary
rather than production-grade parsing accuracy. Its output remains advisory until
a human explicitly confirms or rejects it, and rejecting a proposal never rejects
the Candidate.

### Authorisation demonstration

Backend permissions remain authoritative. To exercise an operation-level denial,
sign in as `shared@iza.com`, select **Khaleel Care Staffing**, and attempt a
document approval. That membership is a `RECRUITER`; an unauthorised approval is
expected to return a bounded permission-denied state without changing the
document.


### Frontend scope

The frontend is intentionally Candidate-centred rather than a collection of
independent administration dashboards. Candidate detail is the entry point for
Candidate-owned compliance documents and governed CV extraction.

Standalone global Documents, Verification, CV-review, and Audit dashboards are
not implemented. Right-to-Work verification remains available through the
backend API and worker and is covered by backend tests and documentation.

## Security notes

No production secrets are stored in the repository. The checked-in database and JWT values are explicitly local-only. Tenant-owned tables are protected by PostgreSQL row-level security for the restricted runtime role. Future tenant-owned routes must apply operation-specific authorisation and define their audit behaviour explicitly.

## AI assistant usage

AI was used for implementation acceleration, refactoring suggestions, test generation ideas, and documentation review. Architecture, tenancy strategy, authorisation model, data model, security boundaries, trade-offs, and final review are decided and validated by the engineer. Generated code is reviewed, changed where necessary, and tested before inclusion.


## Known limitations

- Retention-safe removal is one-way through the runtime application; restoration, hard erasure, and privileged retention operations require a separately governed operational process.
- Tenant-scoped Candidate email uniqueness includes retained inactive rows, so an email cannot be reused through the runtime API after removal.
- Production idempotency-record retention and cleanup policy remains an operational decision.
- Audit browsing/export, retention, and external log forwarding are not implemented.
- Empty list pages do not create an audit row because the ledger records each returned record rather than query intent.
- Approval currently records the transition through the append-only ledger rather than separate approval-comment or approval-reason fields.
- The local verifier is deterministic and intentionally does not represent a production identity-check provider; production integration requires provider authentication, idempotency, timeout handling, and operational monitoring.
- Outbox polling runs as a local Node.js worker without distributed scheduling or leader election.
- CV extraction uses a deterministic local provider and text extraction only. It has no OCR, external model, prompt orchestration, malware scanning, or permanent file storage; production uploads require additional content-security controls and an explicitly governed provider integration.
- The frontend currently covers authentication, tenant selection, Candidate list/search/filter/pagination, Candidate creation/detail, compliance-document list/create/read, version history, approval and governed correction, plus governed CV upload, proposal review, recruiter editing, confirmation and proposal-only rejection. Candidate edit/removal and verification and audit screens remain intentionally deferred.
- Frontend component and server-boundary behaviour is covered by `pnpm test:web`. The primary browser journey has also been manually exercised against the local API and seeded database, including authentication, tenant selection, Candidate creation/detail, document creation, approval, governed correction/version history, role-based approval denial, and governed CV upload/proposal review. Automated browser E2E, systematic viewport coverage, and manual assistive-technology verification remain outstanding. No `pnpm e2e:web` command exists yet.
- Frontend sign-out clears the local same-origin cookies but does not revoke an issued backend JWT. Refresh tokens and session renewal are not implemented.
- The frontend does not receive operation-level permission discovery, so the API remains solely authoritative when a role cannot perform an offered operation.
- The current `HttpOnly`, `SameSite=Lax` cookie boundary and same-origin mutation checks are suitable for the local application. Production deployment requires deployment-specific session renewal/revocation, cookie-domain, TLS, CSRF, and rate-limit review.
- Production deployment and observability are outside this foundation phase.
