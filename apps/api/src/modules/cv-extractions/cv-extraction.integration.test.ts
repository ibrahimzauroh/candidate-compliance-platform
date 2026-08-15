import type { CvProfile } from '@candidate-compliance/contracts';
import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import type { CvExtractionProvider } from './cv-extraction.provider.js';
import { CV_UPLOAD_MAX_BYTES } from './cv-upload.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const jwtConfig = {
  secret: 'governed-cv-extraction-integration-test-secret',
  expiresIn: '15m' as const,
};
const decidedAt = new Date('2026-08-14T23:30:00.000Z');

const malformedProvider: CvExtractionProvider = {
  provider: 'malformed-test-provider',
  model: 'malformed-output-v1',
  async extract() {
    return {
      fullName: '',
      skills: ['TypeScript'],
      yearsOfExperience: 2,
      certifications: [],
      candidateScore: 99,
    };
  },
};
const throwingProvider: CvExtractionProvider = {
  provider: 'throwing-test-provider',
  model: 'throwing-output-v1',
  async extract() {
    throw new Error('SECRET_PROVIDER_EXCEPTION');
  },
};

const app = createApp({
  prisma: runtimePrisma,
  jwtConfig,
  now: () => decidedAt,
});
const malformedProviderApp = createApp({
  prisma: runtimePrisma,
  jwtConfig,
  cvExtractionProvider: malformedProvider,
  now: () => decidedAt,
});
const throwingProviderApp = createApp({
  prisma: runtimePrisma,
  jwtConfig,
  cvExtractionProvider: throwingProvider,
  now: () => decidedAt,
});

const ids = {
  tenants: {
    zauroh: '10000000-0000-4000-8000-000000000001',
    khaleel: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    recruiter: '20000000-0000-4000-8000-000000000002',
    compliance: '20000000-0000-4000-8000-000000000003',
    shared: '20000000-0000-4000-8000-000000000004',
  },
  candidates: {
    zauroh: '47000000-0000-4000-8000-000000000001',
    khaleel: '47000000-0000-4000-8000-000000000002',
  },
} as const;

const forbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'You do not have permission to perform this operation.',
};
const invalidUploadProblem = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail:
    'CV upload must contain one non-empty PDF or UTF-8 plain-text file no larger than 2 MB.',
};
const extractionNotFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'CV extraction was not found.',
};
const candidateNotFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'Candidate was not found.',
};
const decisionConflictProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail: 'This CV extraction proposal has already been decided.',
};
const idempotencyConflictProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail: 'This Idempotency-Key has already been used for a different request.',
};

let keySequence = 0;

function nextKey(label: string): string {
  keySequence += 1;
  return `phase5-${label}-${keySequence}`;
}

function tokenFor(userId: string): string {
  return jwt.sign({}, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn: jwtConfig.expiresIn,
    subject: userId,
  });
}

function textCv(name = 'Alex Morgan', marker?: string): Buffer {
  return Buffer.from(
    [
      `Name: ${name}`,
      'Skills: TypeScript, typescript, PostgreSQL',
      'Years of Experience: 7',
      'Certifications: AWS Certified Developer, aws certified developer',
      marker,
    ]
      .filter(Boolean)
      .join('\n'),
    'utf8',
  );
}

function pdfCv(): Buffer {
  const lines = [
    'Name: PDF Candidate',
    'Skills: TypeScript, PostgreSQL',
    'Years of Experience: 6',
    'Certifications: AWS Certified Developer',
  ];
  const stream = [
    'BT',
    '/F1 12 Tf',
    '72 720 Td',
    ...lines.flatMap((line, index) => [
      ...(index === 0 ? [] : ['0 -20 Td']),
      `(${line}) Tj`,
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'ascii');
}

function extractionRequest(
  targetApp: Express,
  candidateId: string,
  body: Buffer,
  contentType: string,
  key: string | null = nextKey('extract'),
  userId: string = ids.users.recruiter,
  tenantId: string = ids.tenants.zauroh,
) {
  const pending = request(targetApp)
    .post(`/api/v1/candidates/${candidateId}/cv-extractions`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId)
    .set('Content-Type', contentType);

  if (key !== null) {
    pending.set('Idempotency-Key', key);
  }

  return pending.send(body);
}

function readRequest(
  extractionId: string,
  userId: string = ids.users.recruiter,
  tenantId: string = ids.tenants.zauroh,
) {
  return request(app)
    .get(`/api/v1/cv-extractions/${extractionId}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

function confirmRequest(
  extractionId: string,
  body: CvProfile,
  key: string = nextKey('confirm'),
  userId: string = ids.users.recruiter,
  tenantId: string = ids.tenants.zauroh,
) {
  return request(app)
    .post(`/api/v1/cv-extractions/${extractionId}/confirm`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId)
    .set('Idempotency-Key', key)
    .send(body);
}

function rejectRequest(
  extractionId: string,
  key: string = nextKey('reject'),
  userId: string = ids.users.recruiter,
  tenantId: string = ids.tenants.zauroh,
) {
  return request(app)
    .post(`/api/v1/cv-extractions/${extractionId}/reject`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId)
    .set('Idempotency-Key', key)
    .send({});
}

const editedProfile: CvProfile = {
  fullName: 'Alex Morgan Reviewed',
  skills: ['TypeScript', 'PostgreSQL', 'Security'],
  yearsOfExperience: 8,
  certifications: ['AWS Certified Developer'],
};

async function createProposal(name = 'Alex Morgan') {
  return extractionRequest(
    app,
    ids.candidates.zauroh,
    textCv(name),
    'text/plain; charset=utf-8',
  );
}

async function cleanPhaseFiveRows(): Promise<void> {
  await adminPrisma.candidateProfile.deleteMany({
    where: { candidateId: { in: Object.values(ids.candidates) } },
  });
  await adminPrisma.cvExtraction.deleteMany({
    where: { candidateId: { in: Object.values(ids.candidates) } },
  });
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase5-' } },
  });
}

beforeAll(async () => {
  await cleanPhaseFiveRows();
  await adminPrisma.candidate.deleteMany({
    where: { id: { in: Object.values(ids.candidates) } },
  });
  await adminPrisma.candidate.createMany({
    data: [
      {
        id: ids.candidates.zauroh,
        tenantId: ids.tenants.zauroh,
        fullName: 'Phase Five Zauroh Candidate',
        email: 'zauroh@phase5.test',
        roleAppliedFor: 'Security Engineer',
      },
      {
        id: ids.candidates.khaleel,
        tenantId: ids.tenants.khaleel,
        fullName: 'Phase Five Khaleel Candidate',
        email: 'khaleel@phase5.test',
        roleAppliedFor: 'Platform Engineer',
      },
    ],
  });
});

beforeEach(async () => {
  await cleanPhaseFiveRows();
});

afterAll(async () => {
  await cleanPhaseFiveRows();
  await adminPrisma.candidate.deleteMany({
    where: { id: { in: Object.values(ids.candidates) } },
  });
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('governed CV upload and proposal creation', () => {
  it('creates a normalised PROPOSED result from a bounded plain-text CV', async () => {
    const response = await extractionRequest(
      app,
      ids.candidates.zauroh,
      textCv('Alex Text'),
      'text/plain; charset=utf-8',
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      candidateId: ids.candidates.zauroh,
      purpose: 'CANDIDATE_PROFILE',
      provider: 'local-mock',
      model: 'deterministic-cv-extractor-v1',
      status: 'PROPOSED',
      proposedOutput: {
        fullName: 'Alex Text',
        skills: ['TypeScript', 'PostgreSQL'],
        yearsOfExperience: 7,
        certifications: ['AWS Certified Developer'],
      },
      confirmedOutput: null,
      decidedAt: null,
    });
    await expect(adminPrisma.candidateProfile.count()).resolves.toBe(0);
  });

  it('extracts a PDF in memory and creates a PROPOSED result', async () => {
    const response = await extractionRequest(
      app,
      ids.candidates.zauroh,
      pdfCv(),
      'application/pdf',
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'PROPOSED',
      proposedOutput: {
        fullName: 'PDF Candidate',
        skills: ['TypeScript', 'PostgreSQL'],
        yearsOfExperience: 6,
        certifications: ['AWS Certified Developer'],
      },
    });
  });

  it('rejects unsupported, empty, oversized, and malformed PDF uploads', async () => {
    const unsupported = await extractionRequest(
      app,
      ids.candidates.zauroh,
      Buffer.from('{}'),
      'application/json',
    );
    const empty = await extractionRequest(
      app,
      ids.candidates.zauroh,
      Buffer.alloc(0),
      'text/plain',
    );
    const oversized = await extractionRequest(
      app,
      ids.candidates.zauroh,
      Buffer.alloc(CV_UPLOAD_MAX_BYTES + 1, 'a'),
      'text/plain',
    );
    const malformedPdf = await extractionRequest(
      app,
      ids.candidates.zauroh,
      Buffer.from('not a pdf'),
      'application/pdf',
    );

    for (const response of [unsupported, empty, oversized, malformedPdf]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual(invalidUploadProblem);
    }
    await expect(adminPrisma.cvExtraction.count()).resolves.toBe(0);
  });

  it('requires an Idempotency-Key for extraction writes', async () => {
    const response = await extractionRequest(
      app,
      ids.candidates.zauroh,
      textCv(),
      'text/plain',
      null,
    );

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe('Idempotency-Key header is required.');
    await expect(adminPrisma.cvExtraction.count()).resolves.toBe(0);
  });

  it('rejects malformed output and provider failures without persisting details', async () => {
    const auditCountBefore = await adminPrisma.auditEvent.count({
      where: { action: 'ai:extract' },
    });
    const malformed = await extractionRequest(
      malformedProviderApp,
      ids.candidates.zauroh,
      textCv(),
      'text/plain',
    );
    const failed = await extractionRequest(
      throwingProviderApp,
      ids.candidates.zauroh,
      textCv(),
      'text/plain',
    );

    expect(malformed.status).toBe(502);
    expect(malformed.body.detail).toBe(
      'The CV extraction provider returned an invalid response.',
    );
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain(
      'SECRET_PROVIDER_EXCEPTION',
    );
    expect(failed.body.detail).toBe('CV extraction could not be completed.');
    await expect(adminPrisma.cvExtraction.count()).resolves.toBe(0);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key: { startsWith: 'phase5-' } },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.auditEvent.count({ where: { action: 'ai:extract' } }),
    ).resolves.toBe(auditCountBefore);
  });

  it('replays identical concurrent extraction without duplicate proposals or audit events', async () => {
    const key = nextKey('concurrent-extract');
    const [first, second] = await Promise.all([
      extractionRequest(
        app,
        ids.candidates.zauroh,
        textCv('Concurrent Extract'),
        'text/plain',
        key,
      ),
      extractionRequest(
        app,
        ids.candidates.zauroh,
        textCv('Concurrent Extract'),
        'text/plain',
        key,
      ),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    await expect(adminPrisma.cvExtraction.count()).resolves.toBe(1);
    await expect(
      adminPrisma.auditEvent.count({
        where: { action: 'ai:extract', recordId: first.body.id },
      }),
    ).resolves.toBe(1);
  });
});

describe('tenant and permission boundary', () => {
  it('returns 403 when the validated membership lacks AI permissions', async () => {
    const extract = await extractionRequest(
      app,
      ids.candidates.zauroh,
      textCv(),
      'text/plain',
      nextKey('forbidden-extract'),
      ids.users.compliance,
    );
    const proposal = await createProposal();
    const confirm = await confirmRequest(
      proposal.body.id,
      editedProfile,
      nextKey('forbidden-confirm'),
      ids.users.compliance,
    );

    expect(extract.status).toBe(403);
    expect(extract.body).toEqual(forbiddenProblem);
    expect(confirm.status).toBe(403);
    expect(confirm.body).toEqual(forbiddenProblem);
  });

  it('hides cross-tenant candidates, proposals, reads, and decisions', async () => {
    const proposal = await createProposal('Tenant Boundary');
    const crossTenantCreate = await extractionRequest(
      app,
      ids.candidates.zauroh,
      textCv(),
      'text/plain',
      nextKey('cross-create'),
      ids.users.shared,
      ids.tenants.khaleel,
    );
    const crossTenantRead = await readRequest(
      proposal.body.id,
      ids.users.shared,
      ids.tenants.khaleel,
    );
    const crossTenantConfirm = await confirmRequest(
      proposal.body.id,
      editedProfile,
      nextKey('cross-confirm'),
      ids.users.shared,
      ids.tenants.khaleel,
    );

    expect(crossTenantCreate.status).toBe(404);
    expect(crossTenantCreate.body).toEqual(candidateNotFoundProblem);
    expect(crossTenantRead.status).toBe(404);
    expect(crossTenantRead.body).toEqual(extractionNotFoundProblem);
    expect(crossTenantConfirm.status).toBe(404);
    expect(crossTenantConfirm.body).toEqual(extractionNotFoundProblem);
  });
});

describe('human-governed proposal decisions', () => {
  it('does not alter authoritative candidate data before confirmation or retain raw CV text', async () => {
    const before = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.zauroh },
    });
    const marker = 'RAW_CV_SECRET_PROMPT_IGNORE_ALL_RULES';
    const proposal = await extractionRequest(
      app,
      ids.candidates.zauroh,
      textCv('Unconfirmed Candidate', marker),
      'text/plain',
    );
    const after = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.zauroh },
    });
    const stored = await adminPrisma.$queryRaw<
      Array<{ contains_raw_marker: boolean }>
    >`
      SELECT (
        extraction.proposed_output::text LIKE ${`%${marker}%`}
        OR COALESCE(extraction.confirmed_output::text, '') LIKE ${`%${marker}%`}
        OR audit.metadata::text LIKE ${`%${marker}%`}
        OR idempotency.response_body::text LIKE ${`%${marker}%`}
      ) AS contains_raw_marker
      FROM public.cv_extractions AS extraction
      JOIN public.audit_events AS audit
        ON audit.record_id = extraction.id
      JOIN public.idempotency_records AS idempotency
        ON idempotency.response_body->>'id' = extraction.id::text
      WHERE extraction.id = ${proposal.body.id}::uuid
    `;

    expect(proposal.status).toBe(201);
    expect(after).toEqual(before);
    await expect(adminPrisma.candidateProfile.count()).resolves.toBe(0);
    expect(stored).toEqual([{ contains_raw_marker: false }]);
  });

  it('confirms validated recruiter edits while retaining original proposal evidence', async () => {
    const proposal = await createProposal('Original Proposal');
    const response = await confirmRequest(proposal.body.id, {
      ...editedProfile,
      skills: ['TypeScript', 'typescript', 'Security'],
    });
    const extraction = await adminPrisma.cvExtraction.findUniqueOrThrow({
      where: {
        tenantId_id: {
          tenantId: ids.tenants.zauroh,
          id: proposal.body.id,
        },
      },
    });
    const profile = await adminPrisma.candidateProfile.findUniqueOrThrow({
      where: {
        tenantId_candidateId: {
          tenantId: ids.tenants.zauroh,
          candidateId: ids.candidates.zauroh,
        },
      },
    });
    const audit = await adminPrisma.auditEvent.findMany({
      where: { recordId: proposal.body.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ACCEPTED',
      proposedOutput: { fullName: 'Original Proposal' },
      confirmedOutput: {
        fullName: editedProfile.fullName,
        skills: ['TypeScript', 'Security'],
      },
      decidedAt: decidedAt.toISOString(),
    });
    expect(extraction.proposedOutput).not.toEqual(extraction.confirmedOutput);
    expect(profile).toMatchObject({
      sourceExtractionId: proposal.body.id,
      fullName: editedProfile.fullName,
      skills: ['TypeScript', 'Security'],
      yearsOfExperience: editedProfile.yearsOfExperience,
    });
    expect(audit.map(({ action }) => action)).toEqual([
      'ai:extract',
      'ai:confirm',
    ]);
    expect(audit[0]?.metadata).toEqual({
      purpose: 'CANDIDATE_PROFILE',
      provider: 'local-mock',
      model: 'deterministic-cv-extractor-v1',
    });
    expect(audit[1]).toMatchObject({
      action: 'ai:confirm',
      metadata: { decision: 'ACCEPTED' },
    });
    expect(audit[1]?.beforeHash).not.toBe(audit[1]?.afterHash);
  });

  it('rejects invalid confirmation edits before changing proposal or profile state', async () => {
    const proposal = await createProposal('Invalid Confirmation');
    const response = await request(app)
      .post(`/api/v1/cv-extractions/${proposal.body.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(ids.users.recruiter)}`)
      .set('X-Tenant-Id', ids.tenants.zauroh)
      .set('Idempotency-Key', nextKey('invalid-confirm'))
      .send({ ...editedProfile, yearsOfExperience: 100 });
    const extraction = await adminPrisma.cvExtraction.findUniqueOrThrow({
      where: { id: proposal.body.id },
    });

    expect(response.status).toBe(400);
    expect(extraction.status).toBe('PROPOSED');
    await expect(adminPrisma.candidateProfile.count()).resolves.toBe(0);
  });

  it('requires an Idempotency-Key for confirmation and rejection decisions', async () => {
    const proposal = await createProposal('Missing Decision Key');
    const authentication = `Bearer ${tokenFor(ids.users.recruiter)}`;
    const confirm = await request(app)
      .post(`/api/v1/cv-extractions/${proposal.body.id}/confirm`)
      .set('Authorization', authentication)
      .set('X-Tenant-Id', ids.tenants.zauroh)
      .send(editedProfile);
    const reject = await request(app)
      .post(`/api/v1/cv-extractions/${proposal.body.id}/reject`)
      .set('Authorization', authentication)
      .set('X-Tenant-Id', ids.tenants.zauroh)
      .send({});
    const extraction = await adminPrisma.cvExtraction.findUniqueOrThrow({
      where: { id: proposal.body.id },
    });

    expect(confirm.status).toBe(400);
    expect(confirm.body.detail).toBe('Idempotency-Key header is required.');
    expect(reject.status).toBe(400);
    expect(reject.body.detail).toBe('Idempotency-Key header is required.');
    expect(extraction.status).toBe('PROPOSED');
  });

  it('rejects a proposal without mutating or rejecting the candidate and permits no second decision', async () => {
    const before = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.zauroh },
    });
    const proposal = await createProposal('Rejected Proposal');
    const rejectionKey = nextKey('rejection-replay');
    const rejected = await rejectRequest(proposal.body.id, rejectionKey);
    const replayed = await rejectRequest(proposal.body.id, rejectionKey);
    const secondDecision = await confirmRequest(
      proposal.body.id,
      editedProfile,
    );
    const after = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.zauroh },
    });

    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      confirmedOutput: null,
    });
    expect(replayed.status).toBe(200);
    expect(replayed.body).toEqual(rejected.body);
    expect(secondDecision.status).toBe(409);
    expect(secondDecision.body).toEqual(decisionConflictProblem);
    expect(after).toEqual(before);
    await expect(adminPrisma.candidateProfile.count()).resolves.toBe(0);
    await expect(
      adminPrisma.auditEvent.count({
        where: { recordId: proposal.body.id, action: 'ai:reject' },
      }),
    ).resolves.toBe(1);
  });

  it('replays concurrent identical confirmation without duplicate profile or audit work', async () => {
    const proposal = await createProposal('Concurrent Confirmation');
    const key = nextKey('concurrent-confirm');
    const [first, second] = await Promise.all([
      confirmRequest(proposal.body.id, editedProfile, key),
      confirmRequest(proposal.body.id, editedProfile, key),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    await expect(adminPrisma.candidateProfile.count()).resolves.toBe(1);
    await expect(
      adminPrisma.auditEvent.count({
        where: { recordId: proposal.body.id, action: 'ai:confirm' },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key, operation: 'ai:confirm' },
      }),
    ).resolves.toBe(1);
  });

  it('returns 409 when a decision key is reused with materially different edits', async () => {
    const proposal = await createProposal('Conflicting Confirmation');
    const key = nextKey('conflicting-confirm');
    const accepted = await confirmRequest(proposal.body.id, editedProfile, key);
    const conflict = await confirmRequest(
      proposal.body.id,
      { ...editedProfile, fullName: 'Different Confirmed Name' },
      key,
    );
    const profile = await adminPrisma.candidateProfile.findUniqueOrThrow({
      where: {
        tenantId_candidateId: {
          tenantId: ids.tenants.zauroh,
          candidateId: ids.candidates.zauroh,
        },
      },
    });

    expect(accepted.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(idempotencyConflictProblem);
    expect(profile.fullName).toBe(editedProfile.fullName);
  });

  it('audits authorised proposal reads without exposing raw source text', async () => {
    const proposal = await createProposal('Sensitive Read');
    const response = await readRequest(proposal.body.id);
    const readAudit = await adminPrisma.auditEvent.findFirst({
      where: { recordId: proposal.body.id, action: 'ai:read' },
    });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(proposal.body.id);
    expect(readAudit).toMatchObject({
      beforeHash: null,
      metadata: {},
    });
    expect(readAudit?.afterHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
