import { describe, expect, it, vi } from 'vitest';

import {
  assertDatabaseSafety,
  createUniqueKey,
  redactSecrets,
  requireResponseId,
  runSmokeCli,
  withCleanup,
} from '../../scripts/backend-e2e-smoke.js';

const LOCAL_ENVIRONMENT: NodeJS.ProcessEnv = {
  E2E_ALLOW_DATABASE_MUTATION: 'true',
  NODE_ENV: 'development',
  DATABASE_URL:
    'postgresql://runtime:secret@localhost:5432/candidate_compliance',
  DIRECT_DATABASE_URL:
    'postgresql://administrator:secret@localhost:5432/candidate_compliance',
};

describe('backend E2E smoke safety utilities', () => {
  it('accepts an opted-in local database and rejects unsafe targets', () => {
    expect(assertDatabaseSafety(LOCAL_ENVIRONMENT).runtime).toEqual({
      host: 'localhost',
      port: '5432',
      database: 'candidate_compliance',
    });
    expect(() =>
      assertDatabaseSafety({
        ...LOCAL_ENVIRONMENT,
        DATABASE_URL:
          'postgresql://runtime:secret@db.example.test:5432/candidate',
      }),
    ).toThrow(/local database host/i);
    expect(() =>
      assertDatabaseSafety({
        ...LOCAL_ENVIRONMENT,
        E2E_ALLOW_DATABASE_MUTATION: undefined,
      }),
    ).toThrow(/E2E_ALLOW_DATABASE_MUTATION=true/);
    expect(() =>
      assertDatabaseSafety({ ...LOCAL_ENVIRONMENT, NODE_ENV: 'production' }),
    ).toThrow(/prohibited environment mode/i);
  });

  it('redacts database credentials, JWTs, bearer tokens and explicit secrets', () => {
    const explicitSecret = 'demo-password-value';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';
    const value = [
      'postgresql://runtime:database-password@localhost:5432/candidate_compliance',
      `Bearer ${jwt}`,
      `password="${explicitSecret}"`,
      explicitSecret,
    ].join(' ');
    const redacted = redactSecrets(value, [explicitSecret]);

    expect(redacted).not.toContain('runtime');
    expect(redacted).not.toContain('database-password');
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toContain(explicitSecret);
    expect(redacted).toContain('[REDACTED]');
  });

  it('creates unique, header-safe idempotency keys', () => {
    const first = createUniqueKey('candidate create');
    const second = createUniqueKey('candidate create');

    expect(first).not.toBe(second);
    expect(first).toMatch(/^candidate-create-[0-9a-f-]{36}$/);
    expect(second).toMatch(/^candidate-create-[0-9a-f-]{36}$/);
  });

  it('fails when a required response id is absent or invalid', () => {
    expect(() => requireResponseId({}, 'Candidate')).toThrow(
      /Candidate response did not contain a valid id/,
    );
    expect(() => requireResponseId({ id: 'not-a-uuid' }, 'Candidate')).toThrow(
      /Candidate response did not contain a valid id/,
    );
  });
});

describe('backend E2E smoke lifecycle', () => {
  it('runs registered cleanup after success in reverse order', async () => {
    const calls: string[] = [];

    await expect(
      withCleanup(async (registerCleanup) => {
        registerCleanup(() => {
          calls.push('first');
        });
        registerCleanup(() => {
          calls.push('second');
        });
        return 'complete';
      }),
    ).resolves.toBe('complete');
    expect(calls).toEqual(['second', 'first']);
  });

  it('runs registered cleanup after failure and preserves the failure', async () => {
    const cleanup = vi.fn();

    await expect(
      withCleanup(async (registerCleanup) => {
        registerCleanup(cleanup);
        throw new Error('mandatory step failed');
      }),
    ).rejects.toThrow('mandatory step failed');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('returns nonzero and sanitises output after a mandatory-step failure', async () => {
    const output: string[] = [];
    const exitCode = await runSmokeCli(
      async () => {
        throw new Error(
          'Bearer smoke-token password="sensitive-value" caused the failure',
        );
      },
      (line) => output.push(line),
    );

    expect(exitCode).toBe(1);
    expect(output.join('\n')).not.toContain('smoke-token');
    expect(output.join('\n')).not.toContain('sensitive-value');
    expect(output.join('\n')).toContain('[REDACTED]');
  });
});
