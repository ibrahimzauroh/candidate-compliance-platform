import {
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  PrismaClient,
  TenantRole,
} from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});

const DEVELOPMENT_DEMO_PASSWORD = 'ComplianceDemo123';
const BCRYPT_COST_FACTOR = 10;

const SEED_IDS = {
  tenants: {
    zauroh: '10000000-0000-4000-8000-000000000001',
    khaleel: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    admin: '20000000-0000-4000-8000-000000000001',
    recruiter: '20000000-0000-4000-8000-000000000002',
    compliance: '20000000-0000-4000-8000-000000000003',
    shared: '20000000-0000-4000-8000-000000000004',
    khaleelAdmin: '20000000-0000-4000-8000-000000000005',
  },
  memberships: {
    zaurohAdmin: '30000000-0000-4000-8000-000000000001',
    zaurohRecruiter: '30000000-0000-4000-8000-000000000002',
    zaurohCompliance: '30000000-0000-4000-8000-000000000003',
    zaurohShared: '30000000-0000-4000-8000-000000000004',
    khaleelShared: '30000000-0000-4000-8000-000000000005',
    khaleelAdmin: '30000000-0000-4000-8000-000000000006',
  },
  candidates: {
    zaurohAlex: '40000000-0000-4000-8000-000000000001',
    zaurohMorgan: '40000000-0000-4000-8000-000000000002',
    khaleelAlex: '40000000-0000-4000-8000-000000000003',
    khaleelJordan: '40000000-0000-4000-8000-000000000004',
  },
  documents: {
    zaurohRightToWork: '50000000-0000-4000-8000-000000000001',
    khaleelBackgroundCheck: '50000000-0000-4000-8000-000000000002',
  },
  documentVersions: {
    zaurohRightToWorkV1: '60000000-0000-4000-8000-000000000001',
    khaleelBackgroundCheckV1: '60000000-0000-4000-8000-000000000002',
  },
} as const;

const TENANTS = [
  { id: SEED_IDS.tenants.zauroh, name: 'Zauroh Recruitment' },
  { id: SEED_IDS.tenants.khaleel, name: 'Khaleel Care Staffing' },
] as const;

const USERS = [
  {
    id: SEED_IDS.users.admin,
    email: 'admin@iza.com',
    displayName: 'Zauroh Administrator',
  },
  {
    id: SEED_IDS.users.recruiter,
    email: 'recruiter@iza.com',
    displayName: 'Zauroh Recruiter',
  },
  {
    id: SEED_IDS.users.compliance,
    email: 'compliance@iza.com',
    displayName: 'Compliance Reviewer',
  },
  {
    id: SEED_IDS.users.shared,
    email: 'shared@iza.com',
    displayName: 'Shared Demo User',
  },
  {
    id: SEED_IDS.users.khaleelAdmin,
    email: 'khaleel.admin@iza.com',
    displayName: 'Khaleel Administrator',
  },
] as const;

const MEMBERSHIPS = [
  {
    id: SEED_IDS.memberships.zaurohAdmin,
    tenantId: SEED_IDS.tenants.zauroh,
    userId: SEED_IDS.users.admin,
    role: TenantRole.ADMIN,
  },
  {
    id: SEED_IDS.memberships.zaurohRecruiter,
    tenantId: SEED_IDS.tenants.zauroh,
    userId: SEED_IDS.users.recruiter,
    role: TenantRole.RECRUITER,
  },
  {
    id: SEED_IDS.memberships.zaurohCompliance,
    tenantId: SEED_IDS.tenants.zauroh,
    userId: SEED_IDS.users.compliance,
    role: TenantRole.COMPLIANCE_OFFICER,
  },
  {
    id: SEED_IDS.memberships.zaurohShared,
    tenantId: SEED_IDS.tenants.zauroh,
    userId: SEED_IDS.users.shared,
    role: TenantRole.VIEWER,
  },
  {
    id: SEED_IDS.memberships.khaleelShared,
    tenantId: SEED_IDS.tenants.khaleel,
    userId: SEED_IDS.users.shared,
    role: TenantRole.RECRUITER,
  },
  {
    id: SEED_IDS.memberships.khaleelAdmin,
    tenantId: SEED_IDS.tenants.khaleel,
    userId: SEED_IDS.users.khaleelAdmin,
    role: TenantRole.ADMIN,
  },
] as const;

const CANDIDATES = [
  {
    id: SEED_IDS.candidates.zaurohAlex,
    tenantId: SEED_IDS.tenants.zauroh,
    fullName: 'Alex Candidate',
    email: 'alex.candidate@iza.com',
    roleAppliedFor: 'Software Engineer',
  },
  {
    id: SEED_IDS.candidates.zaurohMorgan,
    tenantId: SEED_IDS.tenants.zauroh,
    fullName: 'Morgan Applicant',
    email: 'morgan.applicant@iza.com',
    roleAppliedFor: 'Operations Coordinator',
  },
  {
    id: SEED_IDS.candidates.khaleelAlex,
    tenantId: SEED_IDS.tenants.khaleel,
    fullName: 'Alex Candidate',
    email: 'Alex.Candidate@iza.com',
    roleAppliedFor: 'Support Engineer',
  },
  {
    id: SEED_IDS.candidates.khaleelJordan,
    tenantId: SEED_IDS.tenants.khaleel,
    fullName: 'Jordan Applicant',
    email: 'jordan.applicant@iza.com',
    roleAppliedFor: 'Account Coordinator',
  },
] as const;

const DOCUMENTS = [
  {
    id: SEED_IDS.documents.zaurohRightToWork,
    tenantId: SEED_IDS.tenants.zauroh,
    candidateId: SEED_IDS.candidates.zaurohAlex,
    type: ComplianceDocumentType.RIGHT_TO_WORK,
    versionId: SEED_IDS.documentVersions.zaurohRightToWorkV1,
    createdBy: SEED_IDS.users.compliance,
    issueDate: new Date('2026-01-15T00:00:00.000Z'),
    expiryDate: new Date('2031-01-15T00:00:00.000Z'),
  },
  {
    id: SEED_IDS.documents.khaleelBackgroundCheck,
    tenantId: SEED_IDS.tenants.khaleel,
    candidateId: SEED_IDS.candidates.khaleelAlex,
    type: ComplianceDocumentType.BACKGROUND_CHECK,
    versionId: SEED_IDS.documentVersions.khaleelBackgroundCheckV1,
    createdBy: SEED_IDS.users.khaleelAdmin,
    issueDate: new Date('2026-02-01T00:00:00.000Z'),
    expiryDate: new Date('2031-02-01T00:00:00.000Z'),
  },
] as const;

async function seedDevelopmentData(): Promise<void> {
  const passwordHash = await bcrypt.hash(
    DEVELOPMENT_DEMO_PASSWORD,
    BCRYPT_COST_FACTOR,
  );

  await prisma.$transaction(async (transaction) => {
    for (const tenant of TENANTS) {
      await transaction.tenant.upsert({
        where: { id: tenant.id },
        create: tenant,
        update: { name: tenant.name },
      });
    }

    for (const user of USERS) {
      await transaction.user.upsert({
        where: { id: user.id },
        create: { ...user, passwordHash },
        update: {
          email: user.email,
          displayName: user.displayName,
        },
      });
    }

    for (const membership of MEMBERSHIPS) {
      await transaction.tenantMembership.upsert({
        where: {
          tenantId_userId: {
            tenantId: membership.tenantId,
            userId: membership.userId,
          },
        },
        create: membership,
        update: { role: membership.role },
      });
    }

    for (const candidate of CANDIDATES) {
      await transaction.candidate.upsert({
        where: { id: candidate.id },
        create: candidate,
        update: {
          fullName: candidate.fullName,
          email: candidate.email,
          roleAppliedFor: candidate.roleAppliedFor,
        },
      });
    }

    for (const document of DOCUMENTS) {
      await transaction.complianceDocument.upsert({
        where: { id: document.id },
        create: {
          id: document.id,
          tenantId: document.tenantId,
          candidateId: document.candidateId,
          type: document.type,
        },
        update: {
          candidateId: document.candidateId,
          type: document.type,
        },
      });

      await transaction.complianceDocumentVersion.upsert({
        where: { id: document.versionId },
        create: {
          id: document.versionId,
          tenantId: document.tenantId,
          documentId: document.id,
          versionNumber: 1,
          issueDate: document.issueDate,
          expiryDate: document.expiryDate,
          status: ComplianceDocumentStatus.APPROVED,
          createdBy: document.createdBy,
        },
        update: {
          issueDate: document.issueDate,
          expiryDate: document.expiryDate,
          status: ComplianceDocumentStatus.APPROVED,
          createdBy: document.createdBy,
        },
      });

      await transaction.complianceDocument.update({
        where: { id: document.id },
        data: { currentVersionId: document.versionId },
      });
    }
  });

  console.log('Development seed complete.');
  console.log(`Tenants: ${TENANTS.length}`);
  console.log(`Users: ${USERS.length}`);
  console.log(`Memberships: ${MEMBERSHIPS.length}`);
  console.log(`Candidates: ${CANDIDATES.length}`);
  console.log(`Documents: ${DOCUMENTS.length}`);
  console.log(`Document versions: ${DOCUMENTS.length}`);
  console.log(`Demo users: ${USERS.map((user) => user.email).join(', ')}`);
}

try {
  await seedDevelopmentData();
} finally {
  await prisma.$disconnect();
}
