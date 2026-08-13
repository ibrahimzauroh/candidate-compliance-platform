# Architecture

## Foundation

The repository is a pnpm workspace containing an Express API, a Next.js web application, a shared contracts package, and a root Prisma schema. PostgreSQL runs locally through Docker Compose. This phase deliberately contains no business data model or workflow implementation.

The planned application shape is a modular monolith. It keeps deployment and transactions simple while allowing domain boundaries to be established inside the API as requirements are implemented. A separate service architecture would add operational cost before the domain boundaries and scaling characteristics are known.

## Security boundaries

Tenant-owned data is not present yet. Before it is introduced, protected requests must establish authentication, validate tenant membership, apply operation-specific authorisation, validate input, and run repository work through a tenant-scoped transaction. PostgreSQL row-level security will provide defence in depth alongside application scoping.

Security-sensitive backend boundaries will be prioritised over feature quantity. Compliance history will use immutable versions, audit records will be append-only, and asynchronous verification work will use a PostgreSQL outbox. AI extraction will remain advisory until an authorised human confirms a proposal.

## Evolution

Future phases will introduce domain modules one at a time, with their API contracts, database migrations, security controls, tests, and documentation. The module boundaries are intended to make later extraction possible if independent scaling or ownership warrants it, without paying the cost of distributed transactions and messaging now.

Production work would additionally require managed secrets, TLS termination, database backups and connection pooling, observability, deployment automation, rate limiting, dependency scanning, and an operational RLS migration strategy.
