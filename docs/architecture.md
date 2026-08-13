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

Validated tenant context, operation-specific authorisation, and PostgreSQL row-level security remain separate, unimplemented layers. Authentication does not select a tenant or place memberships, roles, or permissions in the token. Those controls must be added before tenant-owned records are exposed through business endpoints.

## Evolution

Future phases will introduce domain modules one at a time, with their API contracts, database migrations, security controls, tests, and documentation. The module boundaries are intended to make later extraction possible if independent scaling or ownership warrants it, without paying the cost of distributed transactions and messaging now.

Production work would additionally require managed secrets, TLS termination, database backups and connection pooling, observability, deployment automation, rate limiting, dependency scanning, and an operational RLS migration strategy.
