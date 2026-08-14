# Candidate API Reference

This document describes the currently implemented Candidate API. It is a concise developer reference, not a replacement for the OpenAPI document planned for Sub-phase 2E.

## Protected-route headers

All Candidate routes require:

```http
Authorization: Bearer <token>
X-Tenant-Id: <tenant-uuid>
```

Writes also require `Content-Type: application/json`. The tenant header is validated against the authenticated actor's memberships; it is not accepted from a path, query parameter, or request body.

Protected routes can return RFC 9457-style Problem Details with content type `application/problem+json`. Common responses are `400 Bad Request` for a missing or invalid tenant header or invalid request data, `401 Unauthorized` for a missing or invalid access token, and `403 Forbidden` for an unavailable tenant context or missing operation permission.

```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to perform this operation."
}
```

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

Creates a candidate in the validated tenant. Requires `candidate:create`.

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

- `400 Bad Request` — invalid JSON, invalid fields, or unexpected fields.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `candidate:create` is denied.
- `409 Conflict` — the email already belongs to a candidate in the selected tenant.

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

Updates an existing candidate in the validated tenant. Requires `candidate:update`.

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

- `400 Bad Request` — the ID, JSON, or update fields are invalid, or no update field was supplied.
- `401 Unauthorized` — authentication failed.
- `403 Forbidden` — tenant context is unavailable or `candidate:update` is denied.
- `404 Not Found` — the candidate does not exist in the selected tenant or is not visible there.
- `409 Conflict` — the updated email already belongs to another candidate in the selected tenant.

## Deletion status

Candidate deletion is not implemented. The current surface is create, list, retrieve, and update, so Phase 2 is not yet fully aligned with the tenant-scoped CRUD requirement. The deletion policy, permissions, and behaviour require a deliberate decision after reviewing ComplianceDocument lifecycle and audit-history implications.
