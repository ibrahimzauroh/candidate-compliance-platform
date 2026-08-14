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
  -> request validation
  -> idempotent write coordination, for mutations
  -> domain service
  -> tenant-scoped transaction
  -> PostgreSQL RLS
```

Routes must compose these middleware layers in this order. Each layer fails closed when its required trusted context is absent; route composition remains explicit so the required permission is visible beside each operation.

## Candidate module

The Candidate API is the first tenant-owned business module. Each route applies authentication, validated tenant context, and its operation-specific permission before parsing Zod request contracts. The service then runs through `withTenantTransaction` and includes the validated `tenant_id` explicitly in every read or update predicate while PostgreSQL RLS independently enforces the same tenant boundary.

Create input cannot select tenant ownership, and candidate responses omit `tenantId`. Lists use bounded page-based pagination with deterministic `created_at DESC, id ASC` ordering and candidate-specific search, email, and applied-role filters. Audit and OpenAPI remain separate later sub-phases.

## Compliance document module

A `ComplianceDocument` is the stable logical record attached to a candidate; `ComplianceDocumentVersion` rows preserve its dated status history. Creating a document writes the logical record and DRAFT version 1, then selects that version as current inside one tenant-scoped transaction. Adding a version inserts a DRAFT row, references the previous current version through `supersedesVersionId`, and advances the current pointer atomically without updating earlier version contents.

Tenant ownership, candidate identity, version numbers, DRAFT status, and creator provenance are server-controlled. `createdBy` stores the validated `TenantContext.membershipId`; a migration converts the original seeded user identifiers and constrains the field to a membership in the same tenant. The runtime role can insert and update logical documents but can only insert versions, preserving an intentionally non-destructive API boundary before Phase 3 immutability rules arrive.

Document lists reuse bounded page pagination and deterministic `created_at DESC, id ASC` ordering, with only document type and current-version status filters. Every candidate, document, and version query is transaction-bound and explicitly tenant-scoped, while unchanged PostgreSQL RLS policies independently enforce row isolation.

The expiring-documents query evaluates only the logical document's pointed current version. One request-level clock value is normalised to the UTC calendar date, and inclusive date comparisons cover today through day 30. Results order by current expiry date and document ID, reuse document pagination and filters, and remain explicitly tenant-scoped inside `withTenantTransaction`. The existing indexes are adequate for the assessment dataset; a tenant/expiry index should be evaluated against production query plans and volume rather than added speculatively.

Basic version numbering reads the current maximum and relies on the existing tenant/document/version unique constraint as the final concurrent-write boundary. A colliding request receives a generic `409 Conflict` and may retry; no distributed lock or global serialisation is introduced. Approved-version immutability, correction semantics, and audit history remain deferred.

## Idempotent writes

The four current mutation routes require a validated `Idempotency-Key`. Records are scoped by the validated tenant and membership, a trusted operation identifier, and the client key; client body fields cannot select any part of this scope. A SHA-256 fingerprint covers the canonical, validated application input and any route ID that identifies the mutation. The stored result contains only the shaped public response DTO and original success status.

Idempotency lookup, domain mutation, and result insertion share one `withTenantTransaction` callback. A failed mutation or record insert therefore rolls back both sides, while an exact retry replays the committed response without querying a potentially changed domain representation. Immutable records have a database uniqueness constraint for concurrency: a losing identical request rolls back its attempted mutation, reads the committed winner in a fresh tenant transaction, and replays it; a different fingerprint returns `409 Conflict`.

`idempotency_records` is tenant-owned, forced-RLS protected, and owned by the migration role. The runtime role has only `SELECT` and `INSERT`, and every application lookup also includes explicit tenant, membership, operation, and key predicates. No cleanup worker is implemented; a production deployment requires a retention and deletion process operated outside the restricted runtime role.

## Evolution

Future phases will introduce domain modules one at a time, with their API contracts, database migrations, security controls, tests, and documentation. The module boundaries are intended to make later extraction possible if independent scaling or ownership warrants it, without paying the cost of distributed transactions and messaging now.

Production work would additionally require managed secrets, TLS termination, database backups and connection pooling, observability, deployment automation, rate limiting, dependency scanning, and an operational RLS migration strategy.
