# API Reference

This document is a concise developer guide to the implemented APIs. The canonical machine-readable contract is [openapi.json](openapi.json), which is validated as OpenAPI 3.1 and checked bidirectionally against the registered Express route/method inventory by `pnpm openapi:check`.

## Protected-route headers

Authenticated membership discovery occurs before tenant selection and requires only:

```http
Authorization: Bearer <token>
```

All tenant-scoped business routes require:

```http
Authorization: Bearer <token>
X-Tenant-Id: <tenant-uuid>
```

JSON writes require `Content-Type: application/json`. CV upload writes instead use a bounded raw `text/plain` or `application/pdf` body. The tenant header is validated against the authenticated actor's memberships; it is not accepted from a path, query parameter, or request body.

All mutation routes additionally require:

```http
Idempotency-Key: <opaque-client-generated-value>
```

Direct API clients provide this opaque key. For Candidate creation and compliance-document creation, approval, and correction through the web application, the browser supplies only a logical attempt nonce and the same-origin Next.js server derives the raw API key from authenticated session, actor, validated tenant, target aggregate, operation, attempt, and canonical payload context. The browser neither chooses nor receives that raw key.

Keys are trimmed, must contain 1 to 200 letters, digits, or supported opaque characters (`._~:/+-`), and are scoped to the validated tenant membership and operation. Repeating the same operation and validated input with the same key returns the stored response and original success status without executing the write again. Reusing that scoped key for materially different input returns `409 Conflict`:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "This Idempotency-Key has already been used for a different request."
}
```

Keys are independent across tenant memberships and operations. Production deployments require an operational retention and cleanup policy; this phase does not expire records automatically.

Protected routes can return RFC 9457-style Problem Details with content type `application/problem+json`. Common responses are `400 Bad Request` for a missing or invalid tenant header or invalid request data, `401 Unauthorized` for a missing or invalid access token, and `403 Forbidden` for an unavailable tenant context or missing operation permission.

```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to perform this operation."
}
```

## Membership discovery

`GET /api/v1/memberships`

Returns only the authenticated actor's current tenant-membership options for pre-selection UI. It requires Bearer authentication but does not require `X-Tenant-Id`, an idempotency key, or an operation-specific tenant permission. Query, path, body, and incidental tenant-header values are not used as identity selectors.

Success: `200 OK`.

```json
{
  "memberships": [
    {
      "membershipId": "30000000-0000-4000-8000-000000000001",
      "tenantId": "10000000-0000-4000-8000-000000000001",
      "tenantName": "Example Tenant",
      "role": "ADMIN"
    }
  ]
}
```

Results are ordered by tenant name and then tenant ID. An authenticated user without memberships receives `{ "memberships": [] }`. The response deliberately excludes permissions, other users, credentials, and tenant internals. Missing, malformed, forged, or expired authentication returns the existing generic `401 Unauthorized` Problem Details response.

## Audit behaviour

Successful candidate and compliance-document creates, updates, retention-safe removals, version creation, approval, correction, retrievals, list results, expiring-document results, verification transitions, and governed CV proposal decisions append tenant-scoped audit events. Creates have a null before hash and a canonical SHA-256 after hash. Updates, removals, and decisions hash the before and after public state, while reads have a null before hash and hash the returned state. A removal after-state adds the server-owned removal timestamp without storing raw fields in audit metadata.

Mutation events are written in the same tenant transaction as the domain mutation and idempotency result. Failed operations roll back without an event, and replaying an already committed idempotent mutation does not append a duplicate. List endpoints append one event per returned record, bounded by `pageSize <= 100`; an empty page has no record to audit and therefore appends no event.

The ledger stores tenant, actor, membership, action, record identity, hashes, timestamp, and minimal non-PII metadata where necessary. It does not store the public response, raw candidate/document fields, CV bytes, extracted CV text, prompts, or provider errors. There is no audit browsing or export endpoint.

## Candidate representation

Successful create, retrieve, and update responses use this shape:

```json
{
  "id": "30000000-0000-4000-8000-000000000101",
  "fullName": "Amina Yusuf",
  "email": "amina.yusuf@iza.com",
  "roleAppliedFor": "Care Coordinator",
  "createdAt": "2026-08-14T09:30:00.000Z",
  "updatedAt": "2026-08-14T09:30:00.000Z"
}
```

`tenantId` is deliberately omitted from the response.

## Create a candidate

`POST /api/v1/candidates`

Creates a candidate in the validated tenant. Requires `candidate:create` and `Idempotency-Key`.

Request body:

```json
{
  "fullName": "Amina Yusuf",
  "email": "amina.yusuf@iza.com",
  "roleAppliedFor": "Care Coordinator"
}
```

All fields are required. Unknown fields, including `tenantId`, are rejected. Email addresses are normalised to lowercase.

Success: `201 Created` with the Candidate representation above.

Relevant errors:

- `400 Bad Request` — `Idempotency-Key` is missing or invalid.
- `400 Bad Request` — invalid JSON, invalid fields, or unexpected fields.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `candidate:create` is denied.
- `409 Conflict` — the email already belongs to a candidate in the selected tenant.
- `409 Conflict` — the scoped idempotency key was already used for different input.

## List candidates

`GET /api/v1/candidates`

Lists candidates in the validated tenant. Requires `candidate:read`.

Query parameters:

| Parameter        | Behaviour                                                                |
| ---------------- | ------------------------------------------------------------------------ |
| `page`           | Positive integer; defaults to `1` and is capped at `100000`.             |
| `pageSize`       | Positive integer; defaults to `20` and is capped at `100`.               |
| `search`         | Case-insensitive partial match across name, email, and role applied for. |
| `email`          | Exact email match after lowercase normalisation.                         |
| `roleAppliedFor` | Case-insensitive partial role match.                                     |

Example: `GET /api/v1/candidates?page=1&pageSize=20&search=amina`

Success: `200 OK`.

```json
{
  "items": [
    {
      "id": "30000000-0000-4000-8000-000000000101",
      "fullName": "Amina Yusuf",
      "email": "amina.yusuf@iza.com",
      "roleAppliedFor": "Care Coordinator",
      "createdAt": "2026-08-14T09:30:00.000Z",
      "updatedAt": "2026-08-14T09:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

Relevant errors:

- `400 Bad Request` — an unsupported or invalid query parameter was supplied.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `candidate:read` is denied.

## Retrieve a candidate

`GET /api/v1/candidates/:candidateId`

Retrieves one candidate from the validated tenant. Requires `candidate:read`.

Path parameters:

- `candidateId` — required Candidate UUID.

Success: `200 OK` with the Candidate representation above.

Relevant errors:

- `400 Bad Request` — `candidateId` is not a valid UUID.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `candidate:read` is denied.
- `404 Not Found` — the candidate does not exist in the selected tenant or is not visible there.

## Update a candidate

`PATCH /api/v1/candidates/:candidateId`

Updates an existing candidate in the validated tenant. Requires `candidate:update` and `Idempotency-Key`.

Path parameters:

- `candidateId` — required Candidate UUID.

Request body:

```json
{
  "roleAppliedFor": "Senior Care Coordinator"
}
```

At least one of `fullName`, `email`, or `roleAppliedFor` is required. Unknown fields, including `tenantId`, are rejected.

Success: `200 OK` with the updated Candidate representation.

Relevant errors:

- `400 Bad Request` — `Idempotency-Key` is missing or invalid.
- `400 Bad Request` — the ID, JSON, or update fields are invalid, or no update field was supplied.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `candidate:update` is denied.
- `404 Not Found` — the candidate does not exist in the selected tenant or is not visible there.
- `409 Conflict` — the updated email already belongs to another candidate in the selected tenant.
- `409 Conflict` — the scoped idempotency key was already used for different input.

## Remove a candidate

`DELETE /api/v1/candidates/:candidateId`

Requires `candidate:remove` and `Idempotency-Key`. Success is `204 No Content` with no response body. The operation marks the logical Candidate inactive in the same tenant transaction as one `candidate:remove` audit event and the stored idempotency result. It does not physically delete or rewrite the Candidate's documents, versions, verification requests, outbox history, CV extractions, confirmed profile, or audit evidence.

Removed Candidates are excluded from Candidate reads and lists and fail closed for update, document, verification, CV extraction, profile, confirmation, and rejection paths. The database query excludes inactive rows before pagination. Restoration is not available through the runtime API, and tenant-scoped email uniqueness continues to include the retained inactive row.

Relevant errors:

- `400 Bad Request` — `candidateId` or `Idempotency-Key` is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `candidate:remove` is denied.
- `404 Not Found` — the Candidate is missing, belongs to another tenant, or is already inactive.
- `409 Conflict` — the scoped idempotency key was already used for a different Candidate.

An exact same-key retry authoritatively replays `204` without another update or audit event. A failed removal commits neither audit nor idempotency state.

## Compliance document representation

Document responses expose the stable logical record and its current version without tenant ownership or creator identifiers:

```json
{
  "id": "51000000-0000-4000-8000-000000000101",
  "candidateId": "40000000-0000-4000-8000-000000000101",
  "type": "RIGHT_TO_WORK",
  "currentVersion": {
    "id": "61000000-0000-4000-8000-000000000101",
    "versionNumber": 1,
    "issueDate": "2026-08-01",
    "expiryDate": "2027-08-01",
    "status": "DRAFT",
    "createdAt": "2026-08-14T10:00:00.000Z"
  },
  "createdAt": "2026-08-14T10:00:00.000Z",
  "updatedAt": "2026-08-14T10:00:00.000Z"
}
```

Dates use `YYYY-MM-DD`. `issueDate` and `expiryDate` may be omitted or `null`; when both are present, expiry cannot precede issue.

## Create a compliance document

`POST /api/v1/candidates/:candidateId/documents`

Creates a logical document and DRAFT version 1 atomically for a Candidate in the validated tenant. Requires `document:create` and `Idempotency-Key`.

Path parameters:

- `candidateId` — required Candidate UUID.

Request body:

```json
{
  "type": "RIGHT_TO_WORK",
  "issueDate": "2026-08-01",
  "expiryDate": "2027-08-01"
}
```

Supported types are `RIGHT_TO_WORK`, `BACKGROUND_CHECK`, `PROFESSIONAL_CERTIFICATION`, and `OTHER`. The server controls tenant and candidate ownership, creator membership, version number, status, current-version selection, and supersession fields. Unknown fields are rejected.

Success: `201 Created` with the Compliance document representation above.

Relevant errors:

- `400 Bad Request` — `Idempotency-Key` is missing or invalid.
- `400 Bad Request` — the Candidate ID, document type, dates, or body shape is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:create` is denied.
- `404 Not Found` — the Candidate is unavailable in the selected tenant.
- `409 Conflict` — the scoped idempotency key was already used for different input.

## List a candidate's compliance documents

`GET /api/v1/candidates/:candidateId/documents`

Lists the selected tenant's documents for one Candidate. Requires `document:read`.

Path parameters:

- `candidateId` — required Candidate UUID.

Query parameters:

| Parameter  | Behaviour                                                    |
| ---------- | ------------------------------------------------------------ |
| `page`     | Positive integer; defaults to `1` and is capped at `100000`. |
| `pageSize` | Positive integer; defaults to `20` and is capped at `100`.   |
| `type`     | Exact document-type filter.                                  |
| `status`   | Exact filter against the current version's lifecycle status. |

Success: `200 OK`.

```json
{
  "items": [
    {
      "id": "51000000-0000-4000-8000-000000000101",
      "candidateId": "40000000-0000-4000-8000-000000000101",
      "type": "RIGHT_TO_WORK",
      "currentVersion": {
        "id": "61000000-0000-4000-8000-000000000101",
        "versionNumber": 1,
        "issueDate": "2026-08-01",
        "expiryDate": "2027-08-01",
        "status": "DRAFT",
        "createdAt": "2026-08-14T10:00:00.000Z"
      },
      "createdAt": "2026-08-14T10:00:00.000Z",
      "updatedAt": "2026-08-14T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

Relevant errors:

- `400 Bad Request` — the Candidate ID or query parameters are invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:read` is denied.
- `404 Not Found` — the Candidate is unavailable in the selected tenant.

## Retrieve a compliance document

`GET /api/v1/documents/:documentId`

Retrieves a logical document and its current version. Requires `document:read`.

Path parameters:

- `documentId` — required ComplianceDocument UUID.

Success: `200 OK` with the Compliance document representation above.

Relevant errors:

- `400 Bad Request` — `documentId` is not a valid UUID.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:read` is denied.
- `404 Not Found` — the document is nonexistent or unavailable in the selected tenant.

## List compliance document version history

`GET /api/v1/documents/:documentId/versions`

Returns the complete persisted version history for one active logical document. Requires `document:read`. Results are ordered by version number ascending, and exactly one item is marked `isCurrent`. The response does not expose tenant IDs, creator membership IDs, supersession identifiers, or audit data.

This collection is intentionally unpaginated: version histories are append-only, scoped to one document, and expected to remain small. Pagination can be added later without exposing a broader query surface if production volume demonstrates the need.

Success: `200 OK`.

```json
{
  "items": [
    {
      "id": "61000000-0000-4000-8000-000000000120",
      "versionNumber": 1,
      "issueDate": "2026-07-01",
      "expiryDate": "2027-07-01",
      "status": "APPROVED",
      "createdAt": "2026-07-10T09:00:00.000Z",
      "isCurrent": false
    },
    {
      "id": "61000000-0000-4000-8000-000000000121",
      "versionNumber": 2,
      "issueDate": "2026-08-01",
      "expiryDate": "2027-08-01",
      "status": "DRAFT",
      "createdAt": "2026-08-14T10:00:00.000Z",
      "isCurrent": true
    }
  ]
}
```

The read runs inside the validated tenant transaction and appends one `document:read` audit event for the disclosed history. Nonexistent, cross-tenant, removed documents, and documents beneath removed Candidates share neutral `404` behaviour.

Relevant errors:

- `400 Bad Request` — `documentId` or tenant context is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:read` is denied.
- `404 Not Found` — the document is nonexistent, inactive, or unavailable in the selected tenant.
- `500 Internal Server Error` — an unexpected error occurred without exposing internal details.

## List documents expiring within 30 days

`GET /api/v1/documents/expiring`

Lists the active tenant's logical documents whose current version expires from the current UTC calendar date through 30 calendar days later, inclusive. Requires `document:read`.

Only the version selected by `currentVersion` is evaluated. An older version inside the window does not qualify a document when its current version is outside the window. Null expiry dates and dates before the current UTC date are excluded.

Query parameters:

| Parameter  | Behaviour                                                    |
| ---------- | ------------------------------------------------------------ |
| `page`     | Positive integer; defaults to `1` and is capped at `100000`. |
| `pageSize` | Positive integer; defaults to `20` and is capped at `100`.   |
| `type`     | Optional exact document-type filter.                         |
| `status`   | Optional exact filter against the current version.           |

Results are ordered by current expiry date ascending, then document ID ascending.

Success: `200 OK`.

```json
{
  "items": [
    {
      "id": "51000000-0000-4000-8000-000000000120",
      "candidateId": "40000000-0000-4000-8000-000000000101",
      "type": "RIGHT_TO_WORK",
      "currentVersion": {
        "id": "61000000-0000-4000-8000-000000000120",
        "versionNumber": 2,
        "issueDate": "2026-08-01",
        "expiryDate": "2026-08-20",
        "status": "DRAFT",
        "createdAt": "2026-08-14T10:00:00.000Z"
      },
      "createdAt": "2026-07-10T09:00:00.000Z",
      "updatedAt": "2026-08-14T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

An empty result remains successful:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

Relevant errors:

- `400 Bad Request` — pagination or filter values are invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:read` is denied.
- `500 Internal Server Error` — an unexpected error occurred without exposing internal details.

## Add a compliance document version

`POST /api/v1/documents/:documentId/versions`

Appends a DRAFT version and advances the logical document's current-version pointer atomically. Requires `document:create` and `Idempotency-Key`.

Path parameters:

- `documentId` — required ComplianceDocument UUID.

Request body:

```json
{
  "issueDate": "2026-09-01",
  "expiryDate": "2027-09-01"
}
```

Both dates are optional. The server assigns the next version number, records the active membership as creator, and references the previous current version as `supersedesVersionId`. These internal provenance fields are not returned publicly. This general operation cannot append a version when the current version is approved; use the correction operation so approved-history rules are enforced explicitly.

Success: `201 Created` with the logical document and its newly current version.

Relevant errors:

- `400 Bad Request` — `Idempotency-Key` is missing or invalid.
- `400 Bad Request` — the document ID, dates, or body shape is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:create` is denied.
- `404 Not Found` — the document is nonexistent or unavailable in the selected tenant.
- `409 Conflict` — concurrent requests selected the same next version number; the request may be retried.
- `409 Conflict` — the scoped idempotency key was already used for different input.

## Approve a compliance document version

`POST /api/v1/documents/:documentId/approve`

Approves the logical document's current version. Requires `document:approve` and `Idempotency-Key`. The request body must be an empty JSON object.

A current `DRAFT` or `PENDING_REVIEW` version transitions to `APPROVED`. An exact same-key retry is a transport replay that returns the stored response without another audit event. A new-key approval when the current version is already approved is a newly executed successful semantic no-op: it returns the same public state and appends one approval event with equal before/after hashes and bounded `ALREADY_APPROVED` outcome metadata, without updating the document or version. A `REJECTED` current version cannot be approved through this operation.

Success: `200 OK` with the logical document and its approved current version.

Relevant errors:

- `400 Bad Request` — `Idempotency-Key`, document ID, or request body is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:approve` is denied.
- `404 Not Found` — the document is nonexistent or unavailable in the selected tenant.
- `409 Conflict` — the current version cannot be approved from its current status.
- `409 Conflict` — the scoped idempotency key was already used for different input.

## Correct an approved compliance document version

`POST /api/v1/documents/:documentId/corrections`

Corrects only an `APPROVED` current version. Requires `document:correct` and `Idempotency-Key`.

Request body:

```json
{
  "issueDate": "2026-09-01",
  "expiryDate": "2027-09-01"
}
```

Both fields are required and nullable, so a correction supplies the complete corrected date state. Expiry cannot precede issue. The operation creates one new `DRAFT` version, links it to the approved current version through `supersedesVersionId`, and atomically advances the logical document's pointer. It never edits the approved row or its compliance values.

Success: `201 Created` with the logical document and its newly current corrected version.

Relevant errors:

- `400 Bad Request` — `Idempotency-Key`, document ID, dates, or request body is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:correct` is denied.
- `404 Not Found` — the document is nonexistent or unavailable in the selected tenant.
- `409 Conflict` — the current version is not approved.
- `409 Conflict` — the scoped idempotency key was already used for different input.

## Remove a compliance document

`DELETE /api/v1/documents/:documentId`

Requires `document:remove` and `Idempotency-Key`. Success is `204 No Content` with no response body. The operation marks only the stable logical document inactive in the same tenant transaction as one `document:remove` audit event and the idempotency result. It does not edit or delete any version, supersession link, verification request, outbox row, or audit event; approved version bytes and the current-version pointer remain unchanged.

Removed documents are excluded from retrieve, Candidate document-list, and expiring-within-30-days results. Version creation, approval, correction, new verification requests, and verification-status retrieval fail closed. Historical verification and outbox rows remain in PostgreSQL for evidence, but the public verification API no longer exposes them. Restoration is not available through the runtime API.

Relevant errors:

- `400 Bad Request` — `documentId` or `Idempotency-Key` is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `document:remove` is denied.
- `404 Not Found` — the document is missing, belongs to another tenant, has an inactive parent Candidate, or is already inactive.
- `409 Conflict` — the scoped idempotency key was already used for a different document.

An exact same-key retry authoritatively replays `204` without another update or audit event. A failed removal commits neither audit nor idempotency state.

## Request Right-to-Work verification

`POST /api/v1/documents/:documentId/verifications`

Creates an asynchronous verification request for the selected logical document's current version. Requires `verification:request` and `Idempotency-Key`. The request body must be an empty JSON object.

The document must be `RIGHT_TO_WORK`, its current version must be `APPROVED`, and the version must not already have a verification request. The request, one outbox event, creation audit event, and idempotency response are committed in one tenant transaction.

Success: `202 Accepted`.

```json
{
  "id": "70000000-0000-4000-8000-000000000001",
  "documentId": "50000000-0000-4000-8000-000000000001",
  "documentVersionId": "60000000-0000-4000-8000-000000000001",
  "status": "requested",
  "attemptCount": 0,
  "failureCode": null,
  "requestedAt": "2026-08-14T20:00:00.000Z",
  "startedAt": null,
  "completedAt": null,
  "updatedAt": "2026-08-14T20:00:00.000Z"
}
```

Relevant errors:

- `400 Bad Request` — `Idempotency-Key`, document ID, or request body is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `verification:request` is denied.
- `404 Not Found` — the document is nonexistent or unavailable in the selected tenant.
- `409 Conflict` — the current document version is not eligible.
- `409 Conflict` — the current version already has a verification request.
- `409 Conflict` — the scoped idempotency key was already used for different input.

An identical idempotent retry replays the original `202` response without creating another request, outbox event, or audit event.

## Retrieve verification status

`GET /api/v1/verifications/:verificationRequestId`

Returns one verification request visible to the validated tenant. Requires `verification:read`. A successful read appends a tenant-scoped sensitive-read audit event. A retained request whose logical document or parent Candidate has been removed returns the same neutral `404` as a missing or cross-tenant request.

Success: `200 OK` with the verification representation above. Status follows:

```text
requested -> pending -> verified | failed
```

`attemptCount` is capped at three. `failureCode` is null except for failed requests and contains only a bounded machine-readable code; provider exceptions and raw document data are not exposed.

Relevant errors:

- `400 Bad Request` — the verification request ID is invalid.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `verification:read` is denied.
- `404 Not Found` — the request is nonexistent or unavailable in the selected tenant.

## Verification worker behaviour

The separate local worker claims due outbox events with row locking and `SKIP LOCKED`, so concurrent workers cannot claim the same event. A narrow `SECURITY DEFINER` function returns only one due event's identifiers and does not accept a tenant selector, expose payload data, establish tenant state, or provide general RLS bypass access. Processing immediately returns to a normal tenant transaction using the claimed tenant identifier.

The deterministic local verifier returns `failed` when the approved version has no expiry date or is expired relative to the worker's UTC date; otherwise it returns `verified`. Unexpected verifier failures release the event for a bounded retry. After three unsuccessful attempts the request becomes `failed` with `MAX_ATTEMPTS_EXCEEDED`. An event whose final lease expired after a worker crash is reclaimed only to record that terminal state; it does not invoke the verifier again. Completed events have `processedAt` set and are not claimed again.

Request creation, transition to `pending`, and terminal transitions are audited with canonical before/after hashes. Outbox rows store identifiers, claim timestamps, attempt counts, and minimal failure codes only.

## CV extraction representation

CV extraction responses use this shape:

```json
{
  "id": "75000000-0000-4000-8000-000000000001",
  "candidateId": "40000000-0000-4000-8000-000000000001",
  "purpose": "CANDIDATE_PROFILE",
  "provider": "local-mock",
  "model": "deterministic-cv-extractor-v1",
  "status": "PROPOSED",
  "proposedOutput": {
    "fullName": "Alex Morgan",
    "skills": ["TypeScript", "PostgreSQL"],
    "yearsOfExperience": 7,
    "certifications": ["AWS Certified Developer"]
  },
  "confirmedOutput": null,
  "createdAt": "2026-08-14T23:00:00.000Z",
  "decidedAt": null,
  "updatedAt": "2026-08-14T23:00:00.000Z"
}
```

Lists contain at most 50 normalised, case-insensitively deduplicated entries. Names and certifications are limited to 200 characters, skills to 100 characters, and whole years of experience to 0 through 80. Provider output and recruiter edits use the same strict schema; unknown fields are rejected.

## Upload and extract a CV

`POST /api/v1/candidates/:candidateId/cv-extractions`

Requires `ai:extract` and `Idempotency-Key`. Send the CV as the raw request body with `Content-Type: text/plain` or `application/pdf`. The body is limited to 2 MiB, extracted text is limited to 100,000 characters, UTF-8 text must decode strictly, and PDF content must have a PDF signature and yield non-empty text.

The file is processed in memory and is not retained. The deterministic network-free provider treats all extracted text as untrusted input and returns `unknown`; persistence occurs only after strict contract validation. The candidate and any confirmed profile remain unchanged. Success is `201 Created` with status `PROPOSED`.

Relevant errors:

- `400 Bad Request` — upload type, size, content, candidate ID, or `Idempotency-Key` is invalid.
- `403 Forbidden` — tenant context is unavailable or `ai:extract` is denied.
- `404 Not Found` — the candidate is nonexistent or unavailable in the selected tenant.
- `409 Conflict` — the scoped idempotency key was already used for different content.
- `502 Bad Gateway` — the provider failed or returned invalid output; provider details are not exposed.

Identical retries replay the original proposal without re-running persistence or appending another extraction audit event. The fingerprint contains trusted operation scope plus candidate ID, media type, and a SHA-256 content hash rather than raw CV content.

## Retrieve a CV extraction

`GET /api/v1/cv-extractions/:extractionId`

Requires `ai:extract`. Returns `200 OK` with the extraction representation visible to the validated tenant and appends a sensitive-read audit event. Cross-tenant and nonexistent identifiers return the same `404 Not Found` shape.

## Confirm a CV extraction

`POST /api/v1/cv-extractions/:extractionId/confirm`

Requires `ai:confirm`, `Idempotency-Key`, and a complete profile body matching `proposedOutput`. Recruiter edits are allowed and are normalised and validated before use. Confirmation atomically transitions `PROPOSED` to `ACCEPTED`, stores the confirmed output separately, creates or replaces the candidate's tenant-owned profile, appends the decision audit event, and commits the idempotency result. The original proposal is retained unchanged.

Success is `200 OK`. An identical retry replays the response without another profile write or audit event. Invalid edits return `400 Bad Request`; a decided proposal or conflicting key reuse returns `409 Conflict`.

## Reject a CV extraction

`POST /api/v1/cv-extractions/:extractionId/reject`

Requires `ai:confirm`, `Idempotency-Key`, and an empty JSON object. Rejection atomically transitions `PROPOSED` to `REJECTED` and appends a decision audit event. It does not create a profile or change, score, rank, disable, or reject the Candidate record. Identical retries replay the original `200 OK`; a second semantic decision returns `409 Conflict`.

The database restricts runtime updates to decision/profile columns, applies forced tenant RLS, prevents a decided proposal from transitioning again, and rejects candidate profiles without matching accepted extraction evidence.

## Current versioning limitations

Earlier version rows are preserved and no destructive compliance-data update endpoint exists. Retention-safe `DELETE` marks only a logical aggregate inactive and does not erase evidence. The restricted runtime role can update only the explicitly granted aggregate, version, workflow, and AI columns; PostgreSQL prevents restoration, physical deletion, changes to approved rows, and unsupported approval transitions. Approval reasons/comments and a separate review-submission operation are not modelled; `PENDING_REVIEW` remains an allowed approval source for future workflows. Privileged retention/erasure operations and audit browsing/export remain deferred.
