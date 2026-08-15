# Backend manual testing

## Before running the smoke test

Run all commands from the repository root after completing the README
[local setup](../README.md#setup) and
[database setup](../README.md#database-setup). This includes installing the
locked dependencies, creating and configuring the local `.env`, starting the
documented PostgreSQL service, applying committed migrations, and running the
seed command so the documented local authentication fixtures exist.

The smoke command does not replace this environment setup and does not apply
migrations itself.

## Windows PowerShell

Run all commands from the repository root. Docker Desktop and the local
PostgreSQL service must be running.

Start the documented local services and confirm PostgreSQL is healthy:

```powershell
docker compose up -d
docker compose ps
```

Run the backend smoke test with explicit approval for local disposable database
mutation. The `finally` block removes the approval variable even when the smoke
test fails:

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

For the current Phase 7A smoke runner, a successful run ends with:

```text
27 passed, 0 failed, 0 skipped
```

Run the broader validation commands before submission:

```powershell
corepack pnpm test
corepack pnpm test:web
corepack pnpm openapi:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

## macOS and Linux

Run all commands from the repository root. Docker and the local PostgreSQL
service must be available.

Start the documented local services and confirm PostgreSQL is healthy:

```bash
docker compose up -d
docker compose ps
```

Use the process-scoped form when only the smoke command needs the opt-in:

```bash
E2E_ALLOW_DATABASE_MUTATION=true corepack pnpm e2e:smoke
```

If multiple commands must share the opt-in, group them in a subshell:

```bash
(
  export E2E_ALLOW_DATABASE_MUTATION=true
  corepack pnpm e2e:smoke
)
```

The variable is automatically discarded when the command process or subshell
finishes. For the current Phase 7A smoke runner, a successful run ends with:

```text
27 passed, 0 failed, 0 skipped
```

Run the broader validation commands before submission:

```bash
corepack pnpm test
corepack pnpm test:web
corepack pnpm openapi:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

The runner is supported by this documented Node and Docker workflow. This
documentation pass did not execute or platform-verify it on macOS or Linux.

## Shared smoke-test behaviour

`pnpm e2e:smoke` runs the real HTTP, PostgreSQL, and verification smoke journey.
`pnpm test` runs the full Vitest suite, while `pnpm test:web` runs the focused
frontend component and server-boundary tests. Run all three before submission;
the smoke test is not a replacement for the complete test suite. Rendered
browser acceptance remains separate and no `pnpm e2e:web` command is currently
implemented.

The smoke test mutates only the explicitly approved local disposable database.
Run-scoped Candidate and document records are logically removed but
intentionally retained with their workflow, CV, profile, and audit evidence. It
does not reset the database or delete Docker volumes, refuses non-local and
production-like database targets, and redacts JWTs and credentials.

## Implementation and troubleshooting guidance

The backend smoke runner exercises the real Express HTTP listener, PostgreSQL
tenant and privilege boundaries, and the real verification processing path. It
is intended for the disposable local database configured in `.env`.

Prerequisites:

- Docker Desktop and local PostgreSQL are running, and PostgreSQL is reachable
  through both configured database URLs;
- all committed migrations have already been applied;
- the configured JWT secret satisfies the normal API startup checks;
- dependencies have already been installed.

The explicit environment variable acknowledges that the command will mutate
test data. The runner refuses to continue when either database URL has a
non-local host, the URLs select different databases, a production-like database
name is selected, or the environment mode is production or staging. Its output
shows only the selected host, port, and database name; credentials, JWTs,
passwords, raw CV text, and database URLs are not printed.

The runner never resets the database, drops tables or schemas, deletes Docker
volumes, or applies migrations. If required local authentication fixtures are
absent, it reuses the existing idempotent development seed function. All domain
records and idempotency keys created by a run are unique. Candidate and document
removal is intentionally logical, so the run-scoped aggregate, workflow, CV,
profile, and audit evidence remains in the disposable database for retention
verification.

The journey covers health, role login, authenticated identity, validated tenant
context, Candidate creation and replay, reads, cross-tenant denial, document
creation and approval, semantic re-approval, 30-day expiry, verification worker
completion, governed text CV confirmation, retention-safe removal, audit
evidence, retained history, and restricted runtime write protections. Every
mandatory section prints `PASS`, `FAIL`, or `SKIP`; any failure produces a
nonzero exit code and a sanitised diagnostic.

The API uses an ephemeral loopback listener and the verification processor is
invoked in-process, so no detached API or worker process is left behind. The
listener and all database clients are registered for cleanup on success and
failure.
