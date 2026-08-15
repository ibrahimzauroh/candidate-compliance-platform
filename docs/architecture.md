# Architecture

## Application shape

The repository is a pnpm workspace containing an Express API, a Next.js web application, a shared contracts package, and a root Prisma schema. PostgreSQL runs locally through Docker Compose.

The planned application shape is a modular monolith. It keeps deployment and transactions simple while allowing domain boundaries to be established inside the API as requirements are implemented. A separate service architecture would add operational cost before the domain boundaries and scaling characteristics are known.

## Relational tenant foundation

Users represent platform identities, while tenant memberships connect those identities to one or more tenants with a small tenant-specific role. Login and candidate email equality is case-insensitive at the PostgreSQL boundary, while candidate email uniqueness remains tenant-scoped.

Every tenant-owned table stores `tenant_id` directly so later row-level security policies can operate without relying on joins. Compound foreign keys include `tenant_id` when linking candidates, logical compliance documents, document versions, superseded versions, current versions, and version creators. These constraints prevent cross-tenant relationships even before application-layer tenant validation and row-level security are implemented.

A compliance document is the logical record attached to a candidate. Its versions hold the dated review lifecycle, creator, and supersession history. The document's optional current-version reference is constrained to one of its own versions. Approved rows are retained as immutable history, while corrections create a superseding version and advance the logical document pointer.

## Security boundaries

Authentication establishes only the current platform user identity. Login verifies the seeded bcrypt password, issues a short-lived JWT containing the user ID as its subject, and protected requests resolve the current user from PostgreSQL before attaching a tenant-neutral authenticated actor.

Authentication does not select a tenant or place memberships, roles, or permissions in the token. A tenant-scoped request supplies `X-Tenant-Id` as untrusted input. After authentication, the API validates that exact tenant ID against the current user's PostgreSQL membership and attaches a request-level tenant context containing only the selected membership ID and role.

Tenant memberships are themselves protected by RLS, creating a bootstrap boundary before normal tenant context exists. A narrowly scoped, admin-owned `SECURITY DEFINER` function accepts one authenticated user ID and one requested tenant ID and returns only that exact membership. Its fixed search path, static query, revoked public execution, and runtime-only execute grant prevent it from acting as a general RLS bypass. Because `SECURITY DEFINER` executes with owner privileges, this function must remain small, fixed, reviewed, and tested.

The schema-owner connection applies migrations and seeds, while the API uses a separate non-owner, non-superuser runtime role without `BYPASSRLS`. Tenant-owned work runs through `withTenantTransaction`, which sets `app.current_tenant_id` transaction-locally before the callback receives its transaction-bound Prisma client. Forced PostgreSQL RLS protects every tenant-owned domain, idempotency, workflow, and AI table when application query scoping is accidentally omitted. Explicit application tenant scope and RLS remain complementary defence-in-depth controls.

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
  -> domain service and audit append
  -> tenant-scoped transaction atomicity
  -> PostgreSQL RLS
```

Routes must compose these middleware layers in this order. Each layer fails closed when its required trusted context is absent; route composition remains explicit so the required permission is visible beside each operation.

## Candidate module

The Candidate API is the first tenant-owned business module. Each route applies authentication, validated tenant context, and its operation-specific permission before parsing Zod request contracts. The service then runs through `withTenantTransaction` and includes the validated `tenant_id` explicitly in every read or update predicate while PostgreSQL RLS independently enforces the same tenant boundary.

Create input cannot select tenant ownership, and candidate responses omit `tenantId`. Lists use bounded page-based pagination with deterministic `created_at DESC, id ASC` ordering and candidate-specific search, email, and applied-role filters. Candidate creates, updates, retrievals, and returned list records append audit events inside their tenant transaction. OpenAPI remains a separate later sub-phase.

## Compliance document module

A `ComplianceDocument` is the stable logical record attached to a candidate; `ComplianceDocumentVersion` rows preserve its dated status history. Creating a document writes the logical record and DRAFT version 1, then selects that version as current inside one tenant-scoped transaction. Adding a general version inserts a DRAFT row, references the previous current version through `supersedesVersionId`, and advances the current pointer atomically, but is rejected once the current version is approved.

Tenant ownership, candidate identity, version numbers, status transitions, and creator provenance are server-controlled. `createdBy` stores the validated `TenantContext.membershipId`; a migration converts the original seeded user identifiers and constrains the field to a membership in the same tenant. Approval requires `document:approve` and moves only a current DRAFT or PENDING_REVIEW version to APPROVED. Reapproving the same current version is a semantic no-op, while invalid transitions return `409 Conflict`.

Correction requires `document:correct` and an approved current version. It inserts a new DRAFT with the next version number, records the approved version in `supersedesVersionId`, and advances the current pointer in the same tenant transaction. A row lock on the logical document serialises competing pointer transitions. The prior approved row and its values remain unchanged.

The runtime role retains `INSERT` on versions but receives column-level `UPDATE` only for `status`. A database trigger permits only unchanged status or DRAFT/PENDING_REVIEW to APPROVED for that role and rejects every modification to an already approved row. Application transition checks provide precise public errors; restricted privileges and the trigger independently protect history against an accidental application update. Schema-owner maintenance remains privileged and migrations are forward-only.

Document lists reuse bounded page pagination and deterministic `created_at DESC, id ASC` ordering, with only document type and current-version status filters. Every candidate, document, and version query is transaction-bound and explicitly tenant-scoped, while unchanged PostgreSQL RLS policies independently enforce row isolation.

The expiring-documents query evaluates only the logical document's pointed current version. One request-level clock value is normalised to the UTC calendar date, and inclusive date comparisons cover today through day 30. Results order by current expiry date and document ID, reuse document pagination and filters, and remain explicitly tenant-scoped inside `withTenantTransaction`. The existing indexes are adequate for the local dataset; a tenant/expiry index should be evaluated against production query plans and volume rather than added speculatively.

Version numbering reads the current maximum while the existing tenant/document/version unique constraint remains the final integrity boundary. The logical-document row lock serialises version insertion, approval, correction, and current-pointer changes for one document without introducing distributed or tenant-wide locking.

## Idempotent writes

The seven current mutation routes require a validated `Idempotency-Key`. Records are scoped by the validated tenant and membership, a trusted operation identifier, and the client key; client body fields cannot select any part of this scope. A SHA-256 fingerprint covers the canonical, validated application input and any route ID that identifies the mutation. The stored result contains only the shaped public response DTO and original success status.

Idempotency lookup, domain mutation, and result insertion share one `withTenantTransaction` callback. A failed mutation or record insert therefore rolls back both sides, while an exact retry replays the committed response without querying a potentially changed domain representation. Immutable records have a database uniqueness constraint for concurrency: a losing identical request rolls back its attempted mutation, reads the committed winner in a fresh tenant transaction, and replays it; a different fingerprint returns `409 Conflict`.

`idempotency_records` is tenant-owned, forced-RLS protected, and owned by the migration role. The runtime role has only `SELECT` and `INSERT`, and every application lookup also includes explicit tenant, membership, operation, and key predicates. No cleanup worker is implemented; a production deployment requires a retention and deletion process operated outside the restricted runtime role.

## Append-only audit ledger

`audit_events` records the validated tenant, authenticated user, selected membership, trusted action, record identity, timestamp, and canonical SHA-256 before/after hashes. It deliberately has no foreign keys to mutable domain rows, users, or memberships so later lifecycle operations cannot cascade away history. Candidate or document state is hashed after public DTO shaping; raw PII and response bodies are not stored. Metadata defaults to an empty object and is reserved for minimal non-PII context only.

Mutation audit inserts occur inside the same transaction callback as the domain write. Approval and correction hash the public document state before and after the transition; the ledger action identifies which operation occurred without storing raw compliance fields. For idempotent mutations that callback runs only for the winning execution, so replays return the stored public result without duplicating the ledger event. Read services append before returning from their tenant transaction. Retrieve reads create one event; candidate lists, document lists, and expiry lists create one event per returned record using a single bounded insert, with the API page-size cap limiting a request to 100 events. Empty pages create no event because this phase audits disclosed records rather than query intent.

The migration role owns the table, while the restricted runtime role receives only `INSERT`. A forced-RLS insert policy checks `app.current_tenant_id`; the runtime cannot select, update, or delete ledger rows. The absence of domain foreign keys plus withheld mutation privileges provides practical append-only enforcement. Privileged retention, legal-hold, browsing/export, and external log-forwarding procedures remain operational work outside this phase.

## Right-to-Work verification workflow

An approved current `RIGHT_TO_WORK` version can create one `VerificationRequest`. A tenant/document/version uniqueness constraint prevents repeated logical verification of the same immutable version. The request starts as REQUESTED; one associated `OutboxEvent` is inserted in the same transaction together with the creation audit and idempotency record, so no worker-visible event can exist without its domain request.

The API returns `202 Accepted` and exposes a separate `verification:read` status endpoint. The worker transitions REQUESTED to PENDING before invoking the verifier, then records VERIFIED or FAILED in a later tenant transaction. Each state change appends an audit event attributed to the authenticated user and membership that requested the work. Failure storage is restricted to bounded machine codes; raw provider errors and document content are not persisted.

Workers claim one due event through `claim_next_verification_outbox_event`. The admin-owned `SECURITY DEFINER` function uses static SQL, a fixed search path, `FOR UPDATE SKIP LOCKED`, a fixed lease, and no client-provided tenant or record selector. It returns only the claimed event, tenant, request, and bounded-attempt identifiers. Public execution is revoked, the restricted runtime role has execute only, and the function neither establishes tenant session state nor exposes a general query surface. All subsequent reads and mutations use `withTenantTransaction`, explicit tenant predicates, and ordinary forced RLS.

The outbox records claim ownership and expiry, availability, processed time, and at most three attempts. A transient verifier exception releases the event with a generic retry code; the third unsuccessful attempt becomes a terminal FAILED request. If a worker dies after claiming the final attempt, the exhausted event remains claimable only for database terminalisation and the verifier is not invoked again. Processed events are excluded from future claims. The local verifier is deterministic: a missing or expired expiry date fails, while a non-expired date verifies. A production provider must use the verification request ID as its idempotency reference because a process crash can cause at-least-once provider invocation before the final attempt is exhausted or the database result is committed.

`verification_requests` and `outbox_events` carry `tenant_id`, tenant-aware foreign keys, forced RLS, and explicit tenant policies. The runtime role receives only the select/insert and state-transition columns required by the API and worker. No Redis, external queue, external verification API, distributed scheduler, or audit browsing surface is introduced.

## Governed CV extraction

CV ingestion is route-local and accepts only bounded raw `text/plain` or `application/pdf` bodies. Express buffers at most 2 MiB in memory; plain text uses strict UTF-8 decoding, while PDF text is extracted locally and capped at 100,000 characters. Neither bytes nor extracted text are written to PostgreSQL or disk. This avoids a general upload subsystem and leaves malware scanning, OCR, object storage, and provider-specific prompt controls as explicit production work.

`CvExtractionProvider` returns `unknown`. The default implementation is deterministic, network-free, and identifies itself as `local-mock` / `deterministic-cv-extractor-v1`. Shared Zod contracts strictly validate and bound the proposed profile, trim values, and deduplicate skills and certifications case-insensitively. Provider exceptions and invalid output become generic responses without exposing CV text or provider details. Input text, including prompt-like instructions, is treated only as untrusted source data; the provider has no authority to score, rank, disable, or reject a candidate.

The extraction row is the AI evidence record: it retains purpose, provider/model identity, the original validated proposal, requester identity, decision status, reviewer identity, decision time, and a separate confirmed output. `PROPOSED` state does not change the Candidate or create a profile. An authorised `ai:confirm` decision may edit the proposal and atomically transitions it to `ACCEPTED`, materialises the smallest tenant-owned `candidate_profiles` record, appends an audit transition, and stores the idempotency result. `ai:reject` changes only the extraction evidence and never the Candidate. Row locking serialises decisions; PostgreSQL runtime triggers prevent re-deciding a proposal or materialising a profile without matching accepted evidence.

Extraction, confirmation, and rejection use operation-specific idempotency scopes. The upload fingerprint contains only candidate ID, media type, and a SHA-256 content hash; raw content is not retained. Identical replays do not duplicate proposals, profiles, or audit events, while different input under the same scoped key returns `409 Conflict`. Proposal reads and all state transitions are audited with canonical hashes. Audit metadata is limited to purpose/provider/model or the decision and never contains raw CV text, prompts, or provider errors.

`cv_extractions` and `candidate_profiles` carry `tenant_id`, tenant-aware candidate and membership constraints, forced RLS, and explicit tenant policies. The runtime role receives only select/insert plus the decision and profile columns required by the service; delete access is withheld. The current implementation deliberately has no external LLM, API key, OCR, permanent raw-file storage, scoring/ranking, automated decision, or frontend workflow.

## Evolution

Future phases will introduce domain modules one at a time, with their API contracts, database migrations, security controls, tests, and documentation. The module boundaries are intended to make later extraction possible if independent scaling or ownership warrants it, without paying the cost of distributed transactions and messaging now.

Production work would additionally require managed secrets, TLS termination, database backups and connection pooling, observability, deployment automation, rate limiting, dependency scanning, and an operational RLS migration strategy.
