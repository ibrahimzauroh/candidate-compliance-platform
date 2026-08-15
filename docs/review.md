# Code review

## Endpoint under review

The endpoint below was submitted in a pull request.

```js
app.get('/candidates', async (req, res) => {
  const tenantId = req.query.tenantId;
  const search = req.query.search;
  const sql = `SELECT * FROM candidates WHERE name LIKE '%${search}%'`;
  const rows = await db.raw(sql);
  console.log('Returned candidates', rows);
  res.json(rows);
});
```

I wouldn't approve this endpoint as it stands. The biggest issue for me is tenant isolation, the query doesn't scope the candidates to a tenant. There are also SQL injection, permission, logging and pagination problems that I would raise in review to be fixed before merging.

## 1. The query isn't tenant-scoped

`tenantId` is read from the request, but it is never used in the SQL query which makes it redundant.
Even if it was used, we can't trust the payload is returning the actual tenant they have access to.

Fix: I would authenticate the user first, validate that they have a current membership for the selected tenant, and then use that validated tenant context for the query. In this project I would also keep the PostgreSQL RLS policy in place as a second boundary, so an application-layer mistake doesn't automatically become a cross-tenant data leak.

## 2. The search is vulnerable to SQL injection

A malicious value could change the meaning of the query.

Fix: I would use a parameterised query instead of building the SQL from request input

## 3. There is no permission check

Fix: Before listing candidates I would require the permission for that operation, for example `candidate:read`. That also means roles such as ADMIN and RECRUITER go through the same permission policy rather than having special cases scattered through handlers.

## 4. The request isn't validated

Fix: I would validate the query before it reaches the service/database layer and put sensible bounds on the search value. Invalid input should return `400` response.

## 5. The list is unbounded

There is no pagination or result limit. As the tenant grows, this endpoint could return a very large result set.

Fix: I would add bounded `page`/`pageSize` pagination, a maximum page size and deterministic ordering. The response should include the pagination information the client needs.

## 6. `SELECT *` exposes the database shape

This makes it easy to accidentally expose fields that were never intended to be public, including tenant or other internal fields added later.

Fix: I would select the required fields and map them to the public Candidate response contract.

## 7. Candidate data shouldn't be logged directly

Fix: I would remove the record logging. If we need operational logging, I would log things such as the request/correlation ID, result count, status and duration rather than the candidate records themselves.

## 8. Error handling is missing

If the database query fails, the endpoint doesn't show how that failure is translated into the API's public error format and could cause confusion.

Fix: I would send failures through the same Problem Details handling as the rest of the API so callers get consistent responses without SQL errors or internal details leaking out.

## 9. The candidate read isn't audited

The assessment treats candidate reads as sensitive operations, but this endpoint doesn't create any audit evidence.

Fix: I would record the successful read against the validated tenant and actor without copying raw candidate data into the audit log. In my implementation I use the affected record identity and canonical state/response hashes.

## 10. database-level tenant protection

Keep keep the runtime database user restricted and enforce PostgreSQL RLS on tenant-owned candidate rows. The application check and database policy protect the same invariant independently

The corrected request flow should be:

```text
authenticate user
    ↓
validate selected tenant membership
    ↓
check candidate:read
    ↓
validate search/pagination
    ↓
run tenant-scoped, parameterised query
    ↓
PostgreSQL RLS applies independently
    ↓
map to the public Candidate response
    ↓
record the sensitive read
    ↓
return the paginated result
```

That addresses the immediate bugs in this endpoint while keeping tenant isolation enforced at more than one layer.