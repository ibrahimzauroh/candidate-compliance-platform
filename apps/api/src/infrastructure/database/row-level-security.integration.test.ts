import type { TenantContext } from '@candidate-compliance/contracts';
import {
  OutboxEventType,
  PrismaClient,
  TenantRole,
  VerificationStatus,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import { withTenantTransaction } from './with-tenant-transaction.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});

const jwtConfig = {
  secret: 'row-level-security-integration-test-secret',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma: runtimePrisma, jwtConfig });

const ids = {
  tenants: {
    zauroh: '10000000-0000-4000-8000-000000000001',
    khaleel: '10000000-0000-4000-8000-000000000002',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
  users: {
    admin: '20000000-0000-4000-8000-000000000001',
    shared: '20000000-0000-4000-8000-000000000004',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
  memberships: {
    zaurohAdmin: '30000000-0000-4000-8000-000000000001',
    zaurohShared: '30000000-0000-4000-8000-000000000004',
    khaleelShared: '30000000-0000-4000-8000-000000000005',
  },
  candidates: {
    zaurohAlex: '40000000-0000-4000-8000-000000000001',
    zaurohMorgan: '40000000-0000-4000-8000-000000000002',
    khaleelAlex: '40000000-0000-4000-8000-000000000003',
    khaleelJordan: '40000000-0000-4000-8000-000000000004',
    rejectedInsert: '70000000-0000-4000-8000-000000000001',
  },
  documents: {
    zaurohRightToWork: '50000000-0000-4000-8000-000000000001',
    khaleelBackgroundCheck: '50000000-0000-4000-8000-000000000002',
  },
  documentVersions: {
    zaurohRightToWorkV1: '60000000-0000-4000-8000-000000000001',
    khaleelBackgroundCheckV1: '60000000-0000-4000-8000-000000000002',
  },
  idempotencyRecords: {
    zauroh: '71000000-0000-4000-8000-000000000001',
    khaleel: '71000000-0000-4000-8000-000000000002',
    rejectedInsert: '71000000-0000-4000-8000-000000000003',
  },
  auditEvents: {
    zauroh: '72000000-0000-4000-8000-000000000001',
    khaleel: '72000000-0000-4000-8000-000000000002',
    acceptedInsert: '72000000-0000-4000-8000-000000000003',
    rejectedInsert: '72000000-0000-4000-8000-000000000004',
  },
  verificationRequests: {
    zauroh: '73000000-0000-4000-8000-000000000001',
    khaleel: '73000000-0000-4000-8000-000000000002',
    rejectedInsert: '73000000-0000-4000-8000-000000000003',
  },
  outboxEvents: {
    zauroh: '74000000-0000-4000-8000-000000000001',
    khaleel: '74000000-0000-4000-8000-000000000002',
  },
} as const;

const zaurohSeedCandidateIds = [
  ids.candidates.zaurohAlex,
  ids.candidates.zaurohMorgan,
] as const;

const seededCandidateIds = [
  ...zaurohSeedCandidateIds,
  ids.candidates.khaleelAlex,
  ids.candidates.khaleelJordan,
] as const;

const zaurohContext: TenantContext = {
  tenantId: ids.tenants.zauroh,
  userId: ids.users.shared,
  membershipId: ids.memberships.zaurohShared,
  role: TenantRole.VIEWER,
};

const khaleelContext: TenantContext = {
  tenantId: ids.tenants.khaleel,
  userId: ids.users.shared,
  membershipId: ids.memberships.khaleelShared,
  role: TenantRole.RECRUITER,
};

interface MembershipFunctionRow {
  membership_id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
}

async function validateMembership(
  userId: string | null,
  tenantId: string | null,
): Promise<MembershipFunctionRow[]> {
  return runtimePrisma.$queryRaw<MembershipFunctionRow[]>`
    SELECT membership_id, tenant_id, user_id, role
    FROM public.validate_tenant_membership(
      ${userId}::uuid,
      ${tenantId}::uuid
    )
  `;
}

beforeAll(async () => {
  const seedCounts = await adminPrisma.$queryRaw<
    Array<{ candidates: bigint; memberships: bigint; documents: bigint }>
  >`
    SELECT
      (
        SELECT count(*)
        FROM public.candidates
        WHERE id IN (
          ${ids.candidates.zaurohAlex}::uuid,
          ${ids.candidates.zaurohMorgan}::uuid,
          ${ids.candidates.khaleelAlex}::uuid,
          ${ids.candidates.khaleelJordan}::uuid
        )
      ) AS candidates,
      (SELECT count(*) FROM public.tenant_memberships) AS memberships,
      (
        SELECT count(*)
        FROM public.compliance_documents
        WHERE id IN (
          ${ids.documents.zaurohRightToWork}::uuid,
          ${ids.documents.khaleelBackgroundCheck}::uuid
        )
      ) AS documents
  `;

  if (
    seedCounts[0]?.candidates !== 4n ||
    seedCounts[0]?.memberships !== 6n ||
    seedCounts[0]?.documents !== 2n
  ) {
    throw new Error('Run pnpm db:seed before RLS integration tests.');
  }

  await adminPrisma.idempotencyRecord.createMany({
    data: [
      {
        id: ids.idempotencyRecords.zauroh,
        tenantId: ids.tenants.zauroh,
        membershipId: ids.memberships.zaurohAdmin,
        operation: 'security:test',
        key: 'rls-idempotency-zauroh',
        requestHash: 'a'.repeat(64),
        responseStatus: 200,
        responseBody: { result: 'zauroh' },
      },
      {
        id: ids.idempotencyRecords.khaleel,
        tenantId: ids.tenants.khaleel,
        membershipId: ids.memberships.khaleelShared,
        operation: 'security:test',
        key: 'rls-idempotency-khaleel',
        requestHash: 'b'.repeat(64),
        responseStatus: 200,
        responseBody: { result: 'khaleel' },
      },
    ],
    skipDuplicates: true,
  });
  await adminPrisma.auditEvent.createMany({
    data: [
      {
        id: ids.auditEvents.zauroh,
        tenantId: ids.tenants.zauroh,
        actorUserId: ids.users.admin,
        membershipId: ids.memberships.zaurohAdmin,
        action: 'candidate:read',
        recordType: 'candidate',
        recordId: ids.candidates.zaurohAlex,
        beforeHash: null,
        afterHash: 'd'.repeat(64),
      },
      {
        id: ids.auditEvents.khaleel,
        tenantId: ids.tenants.khaleel,
        actorUserId: ids.users.shared,
        membershipId: ids.memberships.khaleelShared,
        action: 'candidate:read',
        recordType: 'candidate',
        recordId: ids.candidates.khaleelAlex,
        beforeHash: null,
        afterHash: 'e'.repeat(64),
      },
    ],
    skipDuplicates: true,
  });
  const completedAt = new Date('2026-08-14T20:00:00.000Z');
  await adminPrisma.verificationRequest.createMany({
    data: [
      {
        id: ids.verificationRequests.zauroh,
        tenantId: ids.tenants.zauroh,
        documentId: ids.documents.zaurohRightToWork,
        documentVersionId: ids.documentVersions.zaurohRightToWorkV1,
        requestedByUserId: ids.users.admin,
        requestedByMembershipId: ids.memberships.zaurohAdmin,
        status: VerificationStatus.VERIFIED,
        attemptCount: 1,
        startedAt: completedAt,
        completedAt,
      },
      {
        id: ids.verificationRequests.khaleel,
        tenantId: ids.tenants.khaleel,
        documentId: ids.documents.khaleelBackgroundCheck,
        documentVersionId: ids.documentVersions.khaleelBackgroundCheckV1,
        requestedByUserId: ids.users.shared,
        requestedByMembershipId: ids.memberships.khaleelShared,
        status: VerificationStatus.VERIFIED,
        attemptCount: 1,
        startedAt: completedAt,
        completedAt,
      },
    ],
    skipDuplicates: true,
  });
  await adminPrisma.outboxEvent.createMany({
    data: [
      {
        id: ids.outboxEvents.zauroh,
        tenantId: ids.tenants.zauroh,
        type: OutboxEventType.RIGHT_TO_WORK_VERIFICATION_REQUESTED,
        verificationRequestId: ids.verificationRequests.zauroh,
        attempts: 1,
        processedAt: completedAt,
      },
      {
        id: ids.outboxEvents.khaleel,
        tenantId: ids.tenants.khaleel,
        type: OutboxEventType.RIGHT_TO_WORK_VERIFICATION_REQUESTED,
        verificationRequestId: ids.verificationRequests.khaleel,
        attempts: 1,
        processedAt: completedAt,
      },
    ],
    skipDuplicates: true,
  });
});

afterAll(async () => {
  await adminPrisma.outboxEvent.deleteMany({
    where: { id: { in: Object.values(ids.outboxEvents) } },
  });
  await adminPrisma.verificationRequest.deleteMany({
    where: { id: { in: Object.values(ids.verificationRequests) } },
  });
  await adminPrisma.auditEvent.deleteMany({
    where: { id: { in: Object.values(ids.auditEvents) } },
  });
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { id: { in: Object.values(ids.idempotencyRecords) } },
  });
  await adminPrisma.candidate.deleteMany({
    where: { id: ids.candidates.rejectedInsert },
  });
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('restricted runtime database role', () => {
  it('is a non-owner, non-superuser role without BYPASSRLS', async () => {
    const roles = await adminPrisma.$queryRaw<
      Array<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      }>
    >`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_catalog.pg_roles
      WHERE rolname = 'candidate_compliance_app'
    `;
    const tables = await adminPrisma.$queryRaw<
      Array<{ relname: string; owner: string }>
    >`
      SELECT class.relname, pg_catalog.pg_get_userbyid(class.relowner) AS owner
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relname IN (
          'tenant_memberships',
          'candidates',
          'compliance_documents',
          'compliance_document_versions',
          'idempotency_records',
          'audit_events',
          'verification_requests',
          'outbox_events'
        )
      ORDER BY class.relname
    `;

    expect(roles).toEqual([
      {
        rolname: 'candidate_compliance_app',
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
      },
    ]);
    expect(tables).toHaveLength(8);
    expect(
      tables.every((table) => table.owner === 'candidate_compliance'),
    ).toBe(true);
  });

  it('connects through Prisma as candidate_compliance_app', async () => {
    const identity = await runtimePrisma.$queryRaw<
      Array<{ current_user: string }>
    >`SELECT current_user`;

    expect(identity).toEqual([{ current_user: 'candidate_compliance_app' }]);
  });

  it('has only the required table privileges', async () => {
    const grants = await adminPrisma.$queryRaw<
      Array<{ table_name: string; privilege_type: string }>
    >`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'candidate_compliance_app'
        AND table_schema = 'public'
      ORDER BY table_name, privilege_type
    `;

    expect(grants).toEqual([
      { table_name: 'audit_events', privilege_type: 'INSERT' },
      { table_name: 'candidates', privilege_type: 'INSERT' },
      { table_name: 'candidates', privilege_type: 'SELECT' },
      { table_name: 'candidates', privilege_type: 'UPDATE' },
      {
        table_name: 'compliance_document_versions',
        privilege_type: 'INSERT',
      },
      {
        table_name: 'compliance_document_versions',
        privilege_type: 'SELECT',
      },
      { table_name: 'compliance_documents', privilege_type: 'INSERT' },
      { table_name: 'compliance_documents', privilege_type: 'SELECT' },
      { table_name: 'compliance_documents', privilege_type: 'UPDATE' },
      { table_name: 'idempotency_records', privilege_type: 'INSERT' },
      { table_name: 'idempotency_records', privilege_type: 'SELECT' },
      { table_name: 'outbox_events', privilege_type: 'INSERT' },
      { table_name: 'outbox_events', privilege_type: 'SELECT' },
      { table_name: 'tenant_memberships', privilege_type: 'SELECT' },
      { table_name: 'users', privilege_type: 'SELECT' },
      { table_name: 'verification_requests', privilege_type: 'INSERT' },
      { table_name: 'verification_requests', privilege_type: 'SELECT' },
    ]);

    const versionUpdateColumns = await adminPrisma.$queryRaw<
      Array<{ column_name: string; privilege_type: string }>
    >`
      SELECT column_name, privilege_type
      FROM information_schema.role_column_grants
      WHERE grantee = 'candidate_compliance_app'
        AND table_schema = 'public'
        AND table_name = 'compliance_document_versions'
        AND privilege_type = 'UPDATE'
      ORDER BY column_name
    `;

    expect(versionUpdateColumns).toEqual([
      { column_name: 'status', privilege_type: 'UPDATE' },
    ]);

    const workflowUpdateColumns = await adminPrisma.$queryRaw<
      Array<{ table_name: string; column_name: string }>
    >`
      SELECT table_name, column_name
      FROM information_schema.role_column_grants
      WHERE grantee = 'candidate_compliance_app'
        AND table_schema = 'public'
        AND table_name IN ('verification_requests', 'outbox_events')
        AND privilege_type = 'UPDATE'
      ORDER BY table_name, column_name
    `;

    expect(workflowUpdateColumns).toEqual([
      { table_name: 'outbox_events', column_name: 'available_at' },
      { table_name: 'outbox_events', column_name: 'last_error_code' },
      { table_name: 'outbox_events', column_name: 'locked_at' },
      { table_name: 'outbox_events', column_name: 'locked_by' },
      { table_name: 'outbox_events', column_name: 'locked_until' },
      { table_name: 'outbox_events', column_name: 'processed_at' },
      { table_name: 'verification_requests', column_name: 'attempt_count' },
      { table_name: 'verification_requests', column_name: 'completed_at' },
      { table_name: 'verification_requests', column_name: 'failure_code' },
      { table_name: 'verification_requests', column_name: 'started_at' },
      { table_name: 'verification_requests', column_name: 'status' },
      { table_name: 'verification_requests', column_name: 'updated_at' },
    ]);
  });

  it('enforces approved-version immutability for the runtime role', async () => {
    const trigger = await adminPrisma.$queryRaw<
      Array<{ trigger_name: string; function_name: string; enabled: string }>
    >`
      SELECT
        trigger.tgname AS trigger_name,
        procedure.proname AS function_name,
        trigger.tgenabled AS enabled
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = trigger.tgfoid
      JOIN pg_catalog.pg_class AS class
        ON class.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relname = 'compliance_document_versions'
        AND trigger.tgname = 'compliance_document_versions_runtime_transition'
        AND NOT trigger.tgisinternal
    `;
    const before =
      await adminPrisma.complianceDocumentVersion.findUniqueOrThrow({
        where: { id: ids.documentVersions.zaurohRightToWorkV1 },
      });

    expect(trigger).toEqual([
      {
        trigger_name: 'compliance_document_versions_runtime_transition',
        function_name: 'enforce_runtime_document_version_transition',
        enabled: 'O',
      },
    ]);
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.complianceDocumentVersion.update({
          where: { id: ids.documentVersions.zaurohRightToWorkV1 },
          data: { expiryDate: new Date('2040-01-01T00:00:00.000Z') },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.complianceDocumentVersion.update({
          where: { id: ids.documentVersions.zaurohRightToWorkV1 },
          data: { status: 'DRAFT' },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adminPrisma.complianceDocumentVersion.findUniqueOrThrow({
        where: { id: ids.documentVersions.zaurohRightToWorkV1 },
      }),
    ).resolves.toEqual(before);
  });
});

describe('validate_tenant_membership bootstrap function', () => {
  it('is SECURITY DEFINER, admin-owned, search-path restricted, and narrowly executable', async () => {
    const functions = await adminPrisma.$queryRaw<
      Array<{
        schema_name: string;
        function_name: string;
        owner: string;
        security_definer: boolean;
        argument_types: string;
        return_shape: string;
        settings: string[];
        public_execute: boolean;
        runtime_execute: boolean;
      }>
    >`
      SELECT
        namespace.nspname AS schema_name,
        procedure.proname AS function_name,
        pg_catalog.pg_get_userbyid(procedure.proowner) AS owner,
        procedure.prosecdef AS security_definer,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          AS argument_types,
        pg_catalog.pg_get_function_result(procedure.oid) AS return_shape,
        procedure.proconfig AS settings,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute,
        pg_catalog.has_function_privilege(
          'candidate_compliance_app',
          procedure.oid,
          'EXECUTE'
        ) AS runtime_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = 'validate_tenant_membership'
    `;

    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({
      schema_name: 'public',
      function_name: 'validate_tenant_membership',
      owner: 'candidate_compliance',
      security_definer: true,
      public_execute: false,
      runtime_execute: true,
    });
    expect(functions[0]?.argument_types).toBe(
      'authenticated_user_id uuid, requested_tenant_id uuid',
    );
    expect(functions[0]?.return_shape).toBe(
      'TABLE(membership_id uuid, tenant_id uuid, user_id uuid, role tenant_role)',
    );
    expect(functions[0]?.settings).toEqual(['search_path=pg_catalog, pg_temp']);
  });

  it('returns one exact matching membership for valid pairs', async () => {
    await expect(
      validateMembership(ids.users.shared, ids.tenants.zauroh),
    ).resolves.toEqual([
      {
        membership_id: ids.memberships.zaurohShared,
        tenant_id: ids.tenants.zauroh,
        user_id: ids.users.shared,
        role: TenantRole.VIEWER,
      },
    ]);
    await expect(
      validateMembership(ids.users.shared, ids.tenants.khaleel),
    ).resolves.toEqual([
      {
        membership_id: ids.memberships.khaleelShared,
        tenant_id: ids.tenants.khaleel,
        user_id: ids.users.shared,
        role: TenantRole.RECRUITER,
      },
    ]);
  });

  it('returns no row for a non-member or nonexistent identity', async () => {
    await expect(
      validateMembership(ids.users.admin, ids.tenants.khaleel),
    ).resolves.toEqual([]);
    await expect(
      validateMembership(ids.users.nonexistent, ids.tenants.zauroh),
    ).resolves.toEqual([]);
    await expect(
      validateMembership(ids.users.admin, ids.tenants.nonexistent),
    ).resolves.toEqual([]);
  });

  it('cannot broaden the query through null or malformed inputs', async () => {
    await expect(validateMembership(null, ids.tenants.zauroh)).resolves.toEqual(
      [],
    );
    await expect(validateMembership(ids.users.shared, null)).resolves.toEqual(
      [],
    );
    await expect(
      runtimePrisma.$queryRaw`
        SELECT *
        FROM public.validate_tenant_membership(
          ${'not-a-uuid'}::uuid,
          ${ids.tenants.zauroh}::uuid
        )
      `,
    ).rejects.toThrow();
  });

  it('returns only membership fields and cannot list all memberships', async () => {
    const result = await validateMembership(
      ids.users.shared,
      ids.tenants.zauroh,
    );

    expect(Object.keys(result[0] ?? {}).sort()).toEqual([
      'membership_id',
      'role',
      'tenant_id',
      'user_id',
    ]);
    await expect(
      runtimePrisma.$queryRaw`
        SELECT * FROM public.validate_tenant_membership()
      `,
    ).rejects.toThrow();
  });

  it('does not alter transaction or session tenant state', async () => {
    const settings = await runtimePrisma.$transaction(async (transaction) => {
      const before = await transaction.$queryRaw<
        Array<{ tenant: string | null }>
      >`
        SELECT NULLIF(
          pg_catalog.current_setting('app.current_tenant_id', true),
          ''
        ) AS tenant
      `;
      await transaction.$queryRaw`
        SELECT *
        FROM public.validate_tenant_membership(
          ${ids.users.shared}::uuid,
          ${ids.tenants.zauroh}::uuid
        )
      `;
      const after = await transaction.$queryRaw<
        Array<{ tenant: string | null }>
      >`
        SELECT NULLIF(
          pg_catalog.current_setting('app.current_tenant_id', true),
          ''
        ) AS tenant
      `;

      return { before, after };
    });

    expect(settings).toEqual({
      before: [{ tenant: null }],
      after: [{ tenant: null }],
    });
  });

  it('does not bypass ordinary membership RLS', async () => {
    await expect(runtimePrisma.tenantMembership.findMany()).resolves.toEqual(
      [],
    );

    const zaurohMemberships = await withTenantTransaction(
      runtimePrisma,
      zaurohContext,
      (transaction) => transaction.tenantMembership.findMany(),
    );

    expect(zaurohMemberships).toHaveLength(4);
    expect(
      zaurohMemberships.every(
        (membership) => membership.tenantId === ids.tenants.zauroh,
      ),
    ).toBe(true);
  });
});

describe('verification outbox claim function', () => {
  it('is narrowly executable, admin-owned, and search-path restricted', async () => {
    const functions = await adminPrisma.$queryRaw<
      Array<{
        owner: string;
        security_definer: boolean;
        argument_types: string;
        return_shape: string;
        settings: string[];
        public_execute: boolean;
        runtime_execute: boolean;
      }>
    >`
      SELECT
        pg_catalog.pg_get_userbyid(procedure.proowner) AS owner,
        procedure.prosecdef AS security_definer,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
          AS argument_types,
        pg_catalog.pg_get_function_result(procedure.oid) AS return_shape,
        procedure.proconfig AS settings,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute,
        pg_catalog.has_function_privilege(
          'candidate_compliance_app',
          procedure.oid,
          'EXECUTE'
        ) AS runtime_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = 'claim_next_verification_outbox_event'
    `;

    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({
      owner: 'candidate_compliance',
      security_definer: true,
      public_execute: false,
      runtime_execute: true,
      argument_types: 'worker_identifier text',
      settings: ['search_path=pg_catalog, pg_temp'],
    });
    expect(functions[0]?.return_shape).toBe(
      'TABLE(outbox_event_id uuid, tenant_id uuid, verification_request_id uuid, attempt_count integer, max_attempts integer, attempts_exhausted boolean)',
    );
  });

  it('rejects invalid worker identifiers and does not establish tenant state', async () => {
    const result = await runtimePrisma.$transaction(async (transaction) => {
      const claim = await transaction.$queryRaw`
        SELECT *
        FROM public.claim_next_verification_outbox_event(
          ${'invalid worker id'}
        )
      `;
      const setting = await transaction.$queryRaw<
        Array<{ tenant: string | null }>
      >`
        SELECT NULLIF(
          pg_catalog.current_setting('app.current_tenant_id', true),
          ''
        ) AS tenant
      `;

      return { claim, setting };
    });

    expect(result).toEqual({ claim: [], setting: [{ tenant: null }] });
  });
});

describe('forced tenant row-level security', () => {
  it('is enabled and forced with USING and WITH CHECK policies on every tenant table', async () => {
    const tables = await adminPrisma.$queryRaw<
      Array<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>
    >`
      SELECT class.relname, class.relrowsecurity, class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relname IN (
          'tenant_memberships',
          'candidates',
          'compliance_documents',
          'compliance_document_versions',
          'idempotency_records',
          'audit_events',
          'verification_requests',
          'outbox_events'
        )
      ORDER BY class.relname
    `;
    const policies = await adminPrisma.$queryRaw<
      Array<{
        tablename: string;
        policyname: string;
        cmd: string;
        qual: string;
        with_check: string;
      }>
    >`
      SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `;

    expect(tables).toHaveLength(8);
    expect(
      tables.every(
        (table) => table.relrowsecurity && table.relforcerowsecurity,
      ),
    ).toBe(true);
    expect(policies).toHaveLength(8);
    const auditPolicy = policies.find(
      (policy) => policy.tablename === 'audit_events',
    );
    expect(auditPolicy).toMatchObject({
      policyname: 'audit_events_tenant_insert',
      cmd: 'INSERT',
      qual: null,
    });
    expect(auditPolicy?.with_check).toContain('app.current_tenant_id');
    expect(
      policies
        .filter((policy) => policy.tablename !== 'audit_events')
        .every((policy) => policy.cmd === 'ALL'),
    ).toBe(true);
    expect(
      policies
        .filter((policy) => policy.tablename !== 'audit_events')
        .every(
          (policy) =>
            policy.qual.includes('app.current_tenant_id') &&
            policy.with_check.includes('app.current_tenant_id'),
        ),
    ).toBe(true);
  });

  it('fails closed without tenant context', async () => {
    await expect(runtimePrisma.candidate.findMany()).resolves.toEqual([]);
    await expect(runtimePrisma.complianceDocument.findMany()).resolves.toEqual(
      [],
    );
    await expect(
      runtimePrisma.complianceDocumentVersion.findMany(),
    ).resolves.toEqual([]);
    await expect(runtimePrisma.tenantMembership.findMany()).resolves.toEqual(
      [],
    );
    await expect(runtimePrisma.idempotencyRecord.findMany()).resolves.toEqual(
      [],
    );
    await expect(runtimePrisma.verificationRequest.findMany()).resolves.toEqual(
      [],
    );
    await expect(runtimePrisma.outboxEvent.findMany()).resolves.toEqual([]);
    await expect(runtimePrisma.auditEvent.findMany()).rejects.toThrow();
  });

  it('permits tenant-local audit inserts and rejects cross-tenant inserts', async () => {
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.auditEvent.createMany({
          data: [
            {
              id: ids.auditEvents.acceptedInsert,
              tenantId: ids.tenants.zauroh,
              actorUserId: zaurohContext.userId,
              membershipId: zaurohContext.membershipId,
              action: 'candidate:read',
              recordType: 'candidate',
              recordId: ids.candidates.zaurohMorgan,
              beforeHash: null,
              afterHash: 'f'.repeat(64),
            },
          ],
        }),
      ),
    ).resolves.toEqual({ count: 1 });

    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.auditEvent.createMany({
          data: [
            {
              id: ids.auditEvents.rejectedInsert,
              tenantId: ids.tenants.khaleel,
              actorUserId: zaurohContext.userId,
              membershipId: zaurohContext.membershipId,
              action: 'candidate:read',
              recordType: 'candidate',
              recordId: ids.candidates.khaleelAlex,
              beforeHash: null,
              afterHash: 'f'.repeat(64),
            },
          ],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adminPrisma.auditEvent.findUnique({
        where: { id: ids.auditEvents.rejectedInsert },
      }),
    ).resolves.toBeNull();
  });

  it('rejects runtime audit updates and deletes', async () => {
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.auditEvent.update({
          where: { id: ids.auditEvents.zauroh },
          data: { afterHash: '0'.repeat(64) },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.auditEvent.delete({
          where: { id: ids.auditEvents.zauroh },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adminPrisma.auditEvent.findUniqueOrThrow({
        where: { id: ids.auditEvents.zauroh },
      }),
    ).resolves.toMatchObject({ afterHash: 'd'.repeat(64) });
  });

  it('isolates idempotency records and rejects cross-tenant inserts', async () => {
    const [zaurohRecords, khaleelRecords] = await Promise.all([
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.idempotencyRecord.findMany({
          where: { id: { in: Object.values(ids.idempotencyRecords) } },
        }),
      ),
      withTenantTransaction(runtimePrisma, khaleelContext, (transaction) =>
        transaction.idempotencyRecord.findMany({
          where: { id: { in: Object.values(ids.idempotencyRecords) } },
        }),
      ),
    ]);

    expect(zaurohRecords.map(({ id }) => id)).toEqual([
      ids.idempotencyRecords.zauroh,
    ]);
    expect(khaleelRecords.map(({ id }) => id)).toEqual([
      ids.idempotencyRecords.khaleel,
    ]);

    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.idempotencyRecord.create({
          data: {
            id: ids.idempotencyRecords.rejectedInsert,
            tenantId: ids.tenants.khaleel,
            membershipId: ids.memberships.khaleelShared,
            operation: 'security:test',
            key: 'rejected-cross-tenant-insert',
            requestHash: 'c'.repeat(64),
            responseStatus: 200,
            responseBody: { result: 'rejected' },
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adminPrisma.idempotencyRecord.findUnique({
        where: { id: ids.idempotencyRecords.rejectedInsert },
      }),
    ).resolves.toBeNull();
  });

  it('isolates verification requests and outbox events by tenant', async () => {
    const [zauroh, khaleel] = await Promise.all([
      withTenantTransaction(
        runtimePrisma,
        zaurohContext,
        async (transaction) => ({
          requests: await transaction.verificationRequest.findMany({
            where: { id: { in: Object.values(ids.verificationRequests) } },
          }),
          events: await transaction.outboxEvent.findMany({
            where: { id: { in: Object.values(ids.outboxEvents) } },
          }),
        }),
      ),
      withTenantTransaction(
        runtimePrisma,
        khaleelContext,
        async (transaction) => ({
          requests: await transaction.verificationRequest.findMany({
            where: { id: { in: Object.values(ids.verificationRequests) } },
          }),
          events: await transaction.outboxEvent.findMany({
            where: { id: { in: Object.values(ids.outboxEvents) } },
          }),
        }),
      ),
    ]);

    expect(zauroh.requests.map(({ id }) => id)).toEqual([
      ids.verificationRequests.zauroh,
    ]);
    expect(zauroh.events.map(({ id }) => id)).toEqual([
      ids.outboxEvents.zauroh,
    ]);
    expect(khaleel.requests.map(({ id }) => id)).toEqual([
      ids.verificationRequests.khaleel,
    ]);
    expect(khaleel.events.map(({ id }) => id)).toEqual([
      ids.outboxEvents.khaleel,
    ]);

    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.verificationRequest.create({
          data: {
            id: ids.verificationRequests.rejectedInsert,
            tenantId: ids.tenants.khaleel,
            documentId: ids.documents.khaleelBackgroundCheck,
            documentVersionId: ids.documentVersions.khaleelBackgroundCheckV1,
            requestedByUserId: ids.users.shared,
            requestedByMembershipId: ids.memberships.khaleelShared,
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.verificationRequest.update({
          where: { id: ids.verificationRequests.khaleel },
          data: { attemptCount: 2 },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.outboxEvent.delete({
          where: { id: ids.outboxEvents.khaleel },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adminPrisma.verificationRequest.findUnique({
        where: { id: ids.verificationRequests.rejectedInsert },
      }),
    ).resolves.toBeNull();
  });

  it('limits unscoped candidate SELECT queries to the active tenant', async () => {
    const zaurohCandidates = await withTenantTransaction(
      runtimePrisma,
      zaurohContext,
      (transaction) =>
        transaction.candidate.findMany({
          where: { id: { in: [...seededCandidateIds] } },
          orderBy: { id: 'asc' },
        }),
    );
    const khaleelCandidates = await withTenantTransaction(
      runtimePrisma,
      khaleelContext,
      (transaction) =>
        transaction.candidate.findMany({
          where: { id: { in: [...seededCandidateIds] } },
          orderBy: { id: 'asc' },
        }),
    );

    expect(zaurohCandidates).toHaveLength(2);
    expect(
      zaurohCandidates.every(
        (candidate) => candidate.tenantId === ids.tenants.zauroh,
      ),
    ).toBe(true);
    expect(khaleelCandidates).toHaveLength(2);
    expect(
      khaleelCandidates.every(
        (candidate) => candidate.tenantId === ids.tenants.khaleel,
      ),
    ).toBe(true);
  });

  it('hides known cross-tenant candidate IDs in both directions', async () => {
    const [khaleelFromZauroh, zaurohFromKhaleel] = await Promise.all([
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.candidate.findUnique({
          where: { id: ids.candidates.khaleelAlex },
        }),
      ),
      withTenantTransaction(runtimePrisma, khaleelContext, (transaction) =>
        transaction.candidate.findUnique({
          where: { id: ids.candidates.zaurohAlex },
        }),
      ),
    ]);

    expect(khaleelFromZauroh).toBeNull();
    expect(zaurohFromKhaleel).toBeNull();
  });

  it('rejects a cross-tenant INSERT through WITH CHECK', async () => {
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.candidate.create({
          data: {
            id: ids.candidates.rejectedInsert,
            tenantId: ids.tenants.khaleel,
            fullName: 'Rejected Cross-Tenant Candidate',
            email: 'rejected.cross.tenant@iza.com',
            roleAppliedFor: 'Security Test',
          },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      adminPrisma.candidate.findUnique({
        where: { id: ids.candidates.rejectedInsert },
      }),
    ).resolves.toBeNull();
  });

  it('rejects moving an existing row to another tenant', async () => {
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.candidate.update({
          where: { id: ids.candidates.zaurohAlex },
          data: { tenantId: ids.tenants.khaleel },
        }),
      ),
    ).rejects.toThrow();

    const candidate = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.zaurohAlex },
    });
    expect(candidate.tenantId).toBe(ids.tenants.zauroh);
  });

  it('blocks updating a known candidate from another tenant', async () => {
    const before = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.khaleelAlex },
    });

    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.candidate.update({
          where: { id: ids.candidates.khaleelAlex },
          data: { fullName: 'Rejected Cross-Tenant Update' },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      adminPrisma.candidate.findUniqueOrThrow({
        where: { id: ids.candidates.khaleelAlex },
      }),
    ).resolves.toEqual(before);
  });

  it('blocks deleting a known candidate from another tenant', async () => {
    await expect(
      withTenantTransaction(runtimePrisma, zaurohContext, (transaction) =>
        transaction.candidate.delete({
          where: { id: ids.candidates.khaleelAlex },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      adminPrisma.candidate.findUnique({
        where: { id: ids.candidates.khaleelAlex },
      }),
    ).resolves.not.toBeNull();
  });

  it('isolates memberships, documents, and versions by active tenant', async () => {
    const [zauroh, khaleel] = await Promise.all([
      withTenantTransaction(
        runtimePrisma,
        zaurohContext,
        async (transaction) => ({
          memberships: await transaction.tenantMembership.findMany(),
          documents: await transaction.complianceDocument.findMany({
            where: { id: { in: Object.values(ids.documents) } },
          }),
          versions: await transaction.complianceDocumentVersion.findMany({
            where: { id: { in: Object.values(ids.documentVersions) } },
          }),
        }),
      ),
      withTenantTransaction(
        runtimePrisma,
        khaleelContext,
        async (transaction) => ({
          memberships: await transaction.tenantMembership.findMany(),
          documents: await transaction.complianceDocument.findMany({
            where: { id: { in: Object.values(ids.documents) } },
          }),
          versions: await transaction.complianceDocumentVersion.findMany({
            where: { id: { in: Object.values(ids.documentVersions) } },
          }),
        }),
      ),
    ]);

    expect(zauroh.memberships).toHaveLength(4);
    expect(zauroh.documents).toHaveLength(1);
    expect(zauroh.versions).toHaveLength(1);
    expect(
      [...zauroh.memberships, ...zauroh.documents, ...zauroh.versions].every(
        (row) => row.tenantId === ids.tenants.zauroh,
      ),
    ).toBe(true);
    expect(khaleel.memberships).toHaveLength(2);
    expect(khaleel.documents).toHaveLength(1);
    expect(khaleel.versions).toHaveLength(1);
    expect(
      [...khaleel.memberships, ...khaleel.documents, ...khaleel.versions].every(
        (row) => row.tenantId === ids.tenants.khaleel,
      ),
    ).toBe(true);
  });
});

describe('transaction-local tenant setting', () => {
  it('does not leak between sequential transactions', async () => {
    const zaurohCount = await withTenantTransaction(
      runtimePrisma,
      zaurohContext,
      (transaction) =>
        transaction.candidate.count({
          where: { id: { in: [...seededCandidateIds] } },
        }),
    );
    const withoutContext = await runtimePrisma.candidate.count();
    const khaleelCount = await withTenantTransaction(
      runtimePrisma,
      khaleelContext,
      (transaction) =>
        transaction.candidate.count({
          where: { id: { in: [...seededCandidateIds] } },
        }),
    );

    expect(zaurohCount).toBe(2);
    expect(withoutContext).toBe(0);
    expect(khaleelCount).toBe(2);
  });

  it('does not leak after transaction rollback', async () => {
    await expect(
      withTenantTransaction(
        runtimePrisma,
        zaurohContext,
        async (transaction) => {
          expect(
            await transaction.candidate.count({
              where: { id: { in: [...zaurohSeedCandidateIds] } },
            }),
          ).toBe(2);
          throw new Error('intentional rollback');
        },
      ),
    ).rejects.toThrow('intentional rollback');

    await expect(
      runtimePrisma.candidate.count({
        where: { id: { in: [...zaurohSeedCandidateIds] } },
      }),
    ).resolves.toBe(0);
  });

  it('does not leak idempotency-record context after transaction completion', async () => {
    const visible = await withTenantTransaction(
      runtimePrisma,
      zaurohContext,
      (transaction) =>
        transaction.idempotencyRecord.findMany({
          where: { id: ids.idempotencyRecords.zauroh },
        }),
    );

    expect(visible).toHaveLength(1);
    await expect(runtimePrisma.idempotencyRecord.findMany()).resolves.toEqual(
      [],
    );
  });

  it('isolates concurrent transactions with different tenants', async () => {
    const [zaurohTenantIds, khaleelTenantIds] = await Promise.all([
      withTenantTransaction(
        runtimePrisma,
        zaurohContext,
        async (transaction) => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          const rows = await transaction.candidate.findMany({
            where: { id: { in: [...seededCandidateIds] } },
          });
          return rows.map((row) => row.tenantId);
        },
      ),
      withTenantTransaction(
        runtimePrisma,
        khaleelContext,
        async (transaction) => {
          const rows = await transaction.candidate.findMany({
            where: { id: { in: [...seededCandidateIds] } },
          });
          await new Promise((resolve) => setTimeout(resolve, 25));
          return rows.map((row) => row.tenantId);
        },
      ),
    ]);

    expect(zaurohTenantIds).toEqual([ids.tenants.zauroh, ids.tenants.zauroh]);
    expect(khaleelTenantIds).toEqual([
      ids.tenants.khaleel,
      ids.tenants.khaleel,
    ]);
  });
});

describe('authentication and tenant-context regressions', () => {
  it('authenticates through the runtime role using the global users table', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@iza.com',
      password: 'ComplianceDemo123',
    });

    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('admin@iza.com');
  });

  it('validates membership through the bootstrap function and establishes context', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'shared@iza.com',
      password: 'ComplianceDemo123',
    });
    const context = await request(app)
      .get('/api/v1/context')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('X-Tenant-Id', ids.tenants.khaleel);

    expect(context.status).toBe(200);
    expect(context.body).toEqual({
      tenantId: ids.tenants.khaleel,
      userId: ids.users.shared,
      membershipId: ids.memberships.khaleelShared,
      role: TenantRole.RECRUITER,
    });
  });
});
