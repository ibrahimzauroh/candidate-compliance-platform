# Architecture decisions

This directory is the index for the significant decisions made while implementing
the Candidate Compliance Platform. The detailed rationale lives primarily in
[`../architecture.md`](../architecture.md), with API behaviour in
[`../api.md`](../api.md) and executable/manual verification guidance in
[`../manual-testing.md`](../manual-testing.md).

## Decision summary

- **Modular monolith first.** This is so we keep Candidate Compliance in one deployable unit
  while preserving explicit module/contracts boundaries; extract a service only
  when independent scale, ownership, or release cadence justifies the operational
  cost.
- **Validated tenant context before domain logic.** Authentication establishes the
  actor only. Tenant selection is separately validated against current
  memberships, then operation-specific permissions are applied.
- **Defence-in-depth tenancy.** Every tenant-owned query is explicitly scoped and
  executes inside a transaction that establishes PostgreSQL RLS tenant state.
  Compound tenant-aware foreign keys prevent cross-tenant relationships.
- **Least-privilege runtime database role.** Migrations/seeds use the owner
  connection; application and worker paths use restricted roles without
  `BYPASSRLS`.
- **Idempotency on writes.** Mutation input is fingerprinted and coordinated in
  the same transaction as domain writes and audit evidence. The web boundary
  derives raw API idempotency keys rather than exposing them to browser control.
- **Append-only audit evidence.** Sensitive reads and mutations record canonical
  before/after hashes without persisting raw PII/CV content in the ledger.
- **Immutable compliance history.** Approved versions cannot be overwritten.
  Corrections create a superseding `DRAFT` and preserve the approved version.
- **Transactional outbox for verification.** Verification request and work event
  commit together; the worker uses bounded retries and idempotent state
  transitions.
- **Governed AI, not automated decision-making.** CV extraction is validated,
  stored as `PROPOSED`, and requires explicit human confirmation or proposal-only
  rejection. AI never rejects a Candidate.
- **Focused Candidate-centred frontend.** The UI implements the highest-value
  Candidate/document/CV workflows and intentionally defers global Verification,
  Audit, Documents, and CV-review dashboards.
- **Production quality over feature breadth.** Under the take-home time constraint
  the implementation prioritises isolation, authorisation, auditability,
  versioning, retry safety, contracts, and tests over speculative infrastructure
  and UI breadth.

See [`../architecture.md`](../architecture.md) for scaling, service-extraction, and production-hardening details.
