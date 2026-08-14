# Architecture

## Application shape

The repository is a pnpm workspace containing an Express API, a Next.js web application, a shared contracts package, and a root Prisma schema. PostgreSQL runs locally through Docker Compose.

The planned application shape is a modular monolith. It keeps deployment and transactions simple while allowing domain boundaries to be established inside the API as requirements are implemented. A separate service architecture would add operational cost before the domain boundaries and scaling characteristics are known.

## Relational tenant foundation

Users represent platform identities, while tenant memberships connect those identities to one or more tenants with a small tenant-specific role. Login and candidate email equality is case-insensitive at the PostgreSQL boundary, while candidate email uniqueness remains tenant-scoped.

Every tenant-owned table stores `tenant_id` directly so later row-level security policies can operate without relying on joins. Compound foreign keys include `tenant_id` when linking candidates, logical compliance documents, document versions, superseded versions, current versions, and version creators. These constraints prevent cross-tenant relationships even before application-layer tenant validation and row-level security are implemented.

A compliance document is the logical record attached to a candidate. Its versions hold the dated review lifecycle, creator, and supersession history. The document's optional current-version reference is constrained to one of its own versions; selection and immutability rules remain application concerns for later sub-phases.

## Security boundaries

Authentication establishes only the current platform user identity. Login verifies the seeded bcrypt password, issues a short-lived JWT containing the user ID as its subject, and protected requests resolve the current user from PostgreSQL before attaching a tenant-neutral authenticated actor.

Authentication does not select a tenant or place memberships, roles, or permissions in the token. A tenant-scoped request supplies `X-Tenant-Id` as untrusted input. After authentication, the API validates that exact tenant ID against the current user's PostgreSQL membership and attaches a request-level tenant context containing only the selected membership ID and role.

Tenant memberships are themselves protected by RLS, creating a bootstrap boundary before normal tenant context exists. A narrowly scoped, admin-owned `SECURITY DEFINER` function accepts one authenticated user ID and one requested tenant ID and returns only that exact membership. Its fixed search path, static query, revoked public execution, and runtime-only execute grant prevent it from acting as a general RLS bypass. Because `SECURITY DEFINER` executes with owner privileges, this function must remain small, fixed, reviewed, and tested.

The schema-owner connection applies migrations and seeds, while the API uses a separate non-owner, non-superuser runtime role without `BYPASSRLS`. Tenant-owned work runs through `withTenantTransaction`, which sets `app.current_tenant_id` transaction-locally before the callback receives its transaction-bound Prisma client. Forced PostgreSQL RLS protects memberships, candidates, documents, and document versions when application query scoping is accidentally omitted. Explicit application tenant scope and RLS remain complementary defence-in-depth controls.

Global user authentication remains outside tenant RLS. Operation-specific authorisation evaluates the validated tenant context's single membership role against an explicit in-code permission policy. A valid membership grants only the operations listed for that role; roles from other memberships are neither selected nor merged. `ADMIN` is evaluated through the same policy mechanism as every other role rather than bypassing it.

Authorisation and PostgreSQL RLS remain separate controls. Authorisation decides whether the selected membership may perform an operation, while RLS independently limits which tenant-owned rows a transaction can access.

The complete protected request boundary is:

```text
HTTP request
  -> authentication
  -> validated tenant membership and context
  -> operation-specific authorisation
  -> request validation and domain service
  -> tenant-scoped transaction
  -> PostgreSQL RLS
```

Routes must compose these middleware layers in this order. Each layer fails closed when its required trusted context is absent; route composition remains explicit so the required permission is visible beside each operation.

## Candidate module

The Candidate API is the first tenant-owned business module. Each route applies authentication, validated tenant context, and its operation-specific permission before parsing Zod request contracts. The service then runs through `withTenantTransaction` and includes the validated `tenant_id` explicitly in every read or update predicate while PostgreSQL RLS independently enforces the same tenant boundary.

Create input cannot select tenant ownership, and candidate responses omit `tenantId`. Lists use bounded page-based pagination with deterministic `created_at DESC, id ASC` ordering and candidate-specific search, email, and applied-role filters. Idempotency, compliance documents, audit, and OpenAPI remain separate later sub-phases.

## Evolution

Future phases will introduce domain modules one at a time, with their API contracts, database migrations, security controls, tests, and documentation. The module boundaries are intended to make later extraction possible if independent scaling or ownership warrants it, without paying the cost of distributed transactions and messaging now.

Production work would additionally require managed secrets, TLS termination, database backups and connection pooling, observability, deployment automation, rate limiting, dependency scanning, and an operational RLS migration strategy.
