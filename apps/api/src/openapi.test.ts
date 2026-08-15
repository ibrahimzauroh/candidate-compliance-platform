import { readFileSync } from 'node:fs';

import type { PrismaClient } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

interface Reference {
  $ref: string;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
}

interface ResponseObject {
  description?: string;
  content?: Record<string, unknown>;
}

interface Operation {
  operationId?: string;
  security?: Array<Record<string, unknown>>;
  parameters?: Array<Reference | Parameter>;
  requestBody?: {
    content?: Record<string, unknown>;
  };
  responses?: Record<string, Reference | ResponseObject>;
  'x-required-permission'?: string | null;
}

type PathItem = Partial<Record<HttpMethod, Operation>> & {
  parameters?: Array<Reference | Parameter>;
};

interface OpenApiDocument {
  openapi?: string;
  jsonSchemaDialect?: string;
  paths?: Record<string, PathItem>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    parameters?: Record<string, Parameter>;
    schemas?: Record<string, unknown>;
  };
}

interface ExpressRouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
  handle?: {
    stack?: ExpressRouteLayer[];
  };
}

interface ExpressAppWithRouter {
  router: {
    stack: ExpressRouteLayer[];
  };
}

interface DocumentedOperation {
  key: string;
  path: string;
  method: HttpMethod;
  operation: Operation;
  pathItem: PathItem;
}

const expectedOperationIds: Record<string, string> = {
  'GET /health': 'getHealth',
  'POST /api/v1/auth/login': 'login',
  'GET /api/v1/auth/me': 'getCurrentUser',
  'GET /api/v1/memberships': 'listMyMemberships',
  'GET /api/v1/context': 'getTenantContext',
  'POST /api/v1/candidates': 'createCandidate',
  'GET /api/v1/candidates': 'listCandidates',
  'GET /api/v1/candidates/{candidateId}': 'getCandidate',
  'PATCH /api/v1/candidates/{candidateId}': 'updateCandidate',
  'DELETE /api/v1/candidates/{candidateId}': 'removeCandidate',
  'POST /api/v1/candidates/{candidateId}/documents': 'createComplianceDocument',
  'GET /api/v1/candidates/{candidateId}/documents':
    'listCandidateComplianceDocuments',
  'GET /api/v1/documents/expiring': 'listExpiringComplianceDocuments',
  'GET /api/v1/documents/{documentId}': 'getComplianceDocument',
  'GET /api/v1/documents/{documentId}/versions':
    'listComplianceDocumentVersions',
  'POST /api/v1/documents/{documentId}/versions':
    'createComplianceDocumentVersion',
  'POST /api/v1/documents/{documentId}/approve': 'approveComplianceDocument',
  'POST /api/v1/documents/{documentId}/corrections':
    'correctComplianceDocument',
  'DELETE /api/v1/documents/{documentId}': 'removeComplianceDocument',
  'POST /api/v1/documents/{documentId}/verifications':
    'requestRightToWorkVerification',
  'GET /api/v1/verifications/{verificationRequestId}': 'getVerificationRequest',
  'POST /api/v1/candidates/{candidateId}/cv-extractions': 'createCvExtraction',
  'GET /api/v1/cv-extractions/{extractionId}': 'getCvExtraction',
  'POST /api/v1/cv-extractions/{extractionId}/confirm': 'confirmCvExtraction',
  'POST /api/v1/cv-extractions/{extractionId}/reject': 'rejectCvExtraction',
};

const expectedPermissions: Record<string, string | null> = {
  'GET /health': null,
  'POST /api/v1/auth/login': null,
  'GET /api/v1/auth/me': null,
  'GET /api/v1/memberships': null,
  'GET /api/v1/context': null,
  'POST /api/v1/candidates': 'candidate:create',
  'GET /api/v1/candidates': 'candidate:read',
  'GET /api/v1/candidates/{candidateId}': 'candidate:read',
  'PATCH /api/v1/candidates/{candidateId}': 'candidate:update',
  'DELETE /api/v1/candidates/{candidateId}': 'candidate:remove',
  'POST /api/v1/candidates/{candidateId}/documents': 'document:create',
  'GET /api/v1/candidates/{candidateId}/documents': 'document:read',
  'GET /api/v1/documents/expiring': 'document:read',
  'GET /api/v1/documents/{documentId}': 'document:read',
  'GET /api/v1/documents/{documentId}/versions': 'document:read',
  'POST /api/v1/documents/{documentId}/versions': 'document:create',
  'POST /api/v1/documents/{documentId}/approve': 'document:approve',
  'POST /api/v1/documents/{documentId}/corrections': 'document:correct',
  'DELETE /api/v1/documents/{documentId}': 'document:remove',
  'POST /api/v1/documents/{documentId}/verifications': 'verification:request',
  'GET /api/v1/verifications/{verificationRequestId}': 'verification:read',
  'POST /api/v1/candidates/{candidateId}/cv-extractions': 'ai:extract',
  'GET /api/v1/cv-extractions/{extractionId}': 'ai:extract',
  'POST /api/v1/cv-extractions/{extractionId}/confirm': 'ai:confirm',
  'POST /api/v1/cv-extractions/{extractionId}/reject': 'ai:confirm',
};

const expectedSuccessStatuses: Record<string, string> = {
  'GET /health': '200',
  'POST /api/v1/auth/login': '200',
  'GET /api/v1/auth/me': '200',
  'GET /api/v1/memberships': '200',
  'GET /api/v1/context': '200',
  'POST /api/v1/candidates': '201',
  'GET /api/v1/candidates': '200',
  'GET /api/v1/candidates/{candidateId}': '200',
  'PATCH /api/v1/candidates/{candidateId}': '200',
  'DELETE /api/v1/candidates/{candidateId}': '204',
  'POST /api/v1/candidates/{candidateId}/documents': '201',
  'GET /api/v1/candidates/{candidateId}/documents': '200',
  'GET /api/v1/documents/expiring': '200',
  'GET /api/v1/documents/{documentId}': '200',
  'GET /api/v1/documents/{documentId}/versions': '200',
  'POST /api/v1/documents/{documentId}/versions': '201',
  'POST /api/v1/documents/{documentId}/approve': '200',
  'POST /api/v1/documents/{documentId}/corrections': '201',
  'DELETE /api/v1/documents/{documentId}': '204',
  'POST /api/v1/documents/{documentId}/verifications': '202',
  'GET /api/v1/verifications/{verificationRequestId}': '200',
  'POST /api/v1/candidates/{candidateId}/cv-extractions': '201',
  'GET /api/v1/cv-extractions/{extractionId}': '200',
  'POST /api/v1/cv-extractions/{extractionId}/confirm': '200',
  'POST /api/v1/cv-extractions/{extractionId}/reject': '200',
};

const tenantScopedOperations = new Set(
  Object.keys(expectedOperationIds).filter(
    (key) =>
      key !== 'GET /health' &&
      key !== 'POST /api/v1/auth/login' &&
      key !== 'GET /api/v1/auth/me' &&
      key !== 'GET /api/v1/memberships',
  ),
);

const idempotentMutations = new Set([
  'POST /api/v1/candidates',
  'PATCH /api/v1/candidates/{candidateId}',
  'DELETE /api/v1/candidates/{candidateId}',
  'POST /api/v1/candidates/{candidateId}/documents',
  'POST /api/v1/documents/{documentId}/versions',
  'POST /api/v1/documents/{documentId}/approve',
  'POST /api/v1/documents/{documentId}/corrections',
  'DELETE /api/v1/documents/{documentId}',
  'POST /api/v1/documents/{documentId}/verifications',
  'POST /api/v1/candidates/{candidateId}/cv-extractions',
  'POST /api/v1/cv-extractions/{extractionId}/confirm',
  'POST /api/v1/cv-extractions/{extractionId}/reject',
]);

let specification: OpenApiDocument;
let operations: DocumentedOperation[];

function documentedOperations(
  document: OpenApiDocument,
): DocumentedOperation[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method];

      return operation
        ? [
            {
              key: `${method.toUpperCase()} ${path}`,
              path,
              method,
              operation,
              pathItem,
            },
          ]
        : [];
    }),
  );
}

function registeredOperations(): string[] {
  const app = createApp({
    prisma: {} as PrismaClient,
    jwtConfig: {
      secret: 'x'.repeat(32),
      expiresIn: '1h',
    },
  }) as unknown as ExpressAppWithRouter;
  const appSource = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
  const mountedRouterPrefixes = Array.from(
    appSource.matchAll(/app\.use\(\s*['"]([^'"]+)['"]/g),
    (match) => match[1] ?? '',
  );
  const mountedRouters = app.router.stack.filter(
    (layer) => layer.handle?.stack,
  );

  expect(mountedRouters).toHaveLength(mountedRouterPrefixes.length);

  const directOperations = app.router.stack.flatMap((layer) =>
    layer.route
      ? Object.entries(layer.route.methods)
          .filter(([, enabled]) => enabled)
          .map(
            ([method]) =>
              `${method.toUpperCase()} ${expressPathToOpenApi(layer.route?.path ?? '')}`,
          )
      : [],
  );
  const nestedOperations = mountedRouters.flatMap((layer, index) => {
    const prefix = mountedRouterPrefixes[index] ?? '';

    return (layer.handle?.stack ?? []).flatMap((nestedLayer) =>
      nestedLayer.route
        ? Object.entries(nestedLayer.route.methods)
            .filter(([, enabled]) => enabled)
            .map(([method]) => {
              const nestedPath =
                nestedLayer.route?.path === '/' ? '' : nestedLayer.route?.path;

              return `${method.toUpperCase()} ${expressPathToOpenApi(`${prefix}${nestedPath ?? ''}`)}`;
            })
        : [],
    );
  });

  return [...directOperations, ...nestedOperations].sort();
}

function expressPathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function parameterName(referenceOrParameter: Reference | Parameter): string {
  if ('$ref' in referenceOrParameter) {
    const componentName = referenceOrParameter.$ref.split('/').at(-1);
    const parameter = componentName
      ? specification.components?.parameters?.[componentName]
      : undefined;

    if (!parameter) {
      throw new Error(
        `Unresolved parameter reference: ${referenceOrParameter.$ref}`,
      );
    }

    return parameter.name;
  }

  return referenceOrParameter.name;
}

function allParameterNames({
  operation,
  pathItem,
}: DocumentedOperation): string[] {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(
    parameterName,
  );
}

beforeAll(() => {
  specification = JSON.parse(
    readFileSync(
      new URL('../../../docs/openapi.json', import.meta.url),
      'utf8',
    ),
  ) as OpenApiDocument;
  operations = documentedOperations(specification);
});

describe('canonical OpenAPI specification', () => {
  it('parses as one OpenAPI 3.1 document with reusable components', () => {
    expect(specification.openapi).toBe('3.1.0');
    expect(specification.jsonSchemaDialect).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(specification.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(specification.components?.schemas?.ProblemDetails).toBeDefined();
    expect(operations).toHaveLength(25);
  });

  it('matches every registered public Express route and no nonexistent route', () => {
    expect(operations.map(({ key }) => key).sort()).toEqual(
      registeredOperations(),
    );
  });

  it('uses the expected method and one stable unique operationId per route', () => {
    expect(Object.keys(expectedOperationIds).sort()).toEqual(
      registeredOperations(),
    );
    expect(
      operations.map(({ operation }) => operation.operationId),
    ).toHaveLength(
      new Set(operations.map(({ operation }) => operation.operationId)).size,
    );

    for (const { key, operation } of operations) {
      expect(operation.operationId, key).toBe(expectedOperationIds[key]);
    }
  });

  it('declares authentication, tenant selection, and exact operation permissions', () => {
    for (const documentedOperation of operations) {
      const { key, operation } = documentedOperation;

      if (key === 'GET /health' || key === 'POST /api/v1/auth/login') {
        expect(operation.security, key).toEqual([]);
      } else {
        expect(operation.security, key).toContainEqual({ bearerAuth: [] });
      }

      if (tenantScopedOperations.has(key)) {
        expect(allParameterNames(documentedOperation), key).toContain(
          'X-Tenant-Id',
        );
      }

      expect(operation['x-required-permission'], key).toBe(
        expectedPermissions[key],
      );
    }
  });

  it('requires idempotency keys for every idempotent mutation', () => {
    for (const documentedOperation of operations) {
      if (idempotentMutations.has(documentedOperation.key)) {
        expect(
          allParameterNames(documentedOperation),
          documentedOperation.key,
        ).toContain('Idempotency-Key');
      }
    }
  });

  it('keeps authenticated membership discovery independent of tenant selection', () => {
    const discovery = operations.find(
      ({ key }) => key === 'GET /api/v1/memberships',
    );

    expect(discovery).toBeDefined();
    expect(allParameterNames(discovery!)).not.toContain('X-Tenant-Id');
    expect(allParameterNames(discovery!)).not.toContain('Idempotency-Key');
    expect(discovery?.operation.security).toContainEqual({ bearerAuth: [] });
    expect(discovery?.operation['x-required-permission']).toBeNull();
  });

  it('documents version history as a tenant-scoped read without idempotency', () => {
    const history = operations.find(
      ({ key }) => key === 'GET /api/v1/documents/{documentId}/versions',
    );

    expect(history).toBeDefined();
    expect(allParameterNames(history!)).toContain('X-Tenant-Id');
    expect(allParameterNames(history!)).not.toContain('Idempotency-Key');
    expect(history?.operation['x-required-permission']).toBe('document:read');
    expect(history?.operation.responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/ComplianceDocumentVersionHistoryResponse',
          },
        },
      },
    });
  });

  it('declares each expected success and at least one Problem Details response', () => {
    for (const { key, operation } of operations) {
      const responses = operation.responses ?? {};
      const errorResponses = Object.entries(responses).filter(
        ([status]) => Number(status) >= 400,
      );

      expect(responses[expectedSuccessStatuses[key] ?? ''], key).toBeDefined();
      expect(errorResponses.length, key).toBeGreaterThan(0);
      expect(
        errorResponses.every(
          ([, response]) =>
            '$ref' in response &&
            response.$ref.startsWith('#/components/responses/'),
        ),
        key,
      ).toBe(true);
    }
  });

  it('documents both supported raw CV upload media types', () => {
    const upload = operations.find(
      ({ key }) =>
        key === 'POST /api/v1/candidates/{candidateId}/cv-extractions',
    );
    const content = upload?.operation.requestBody?.content;

    expect(Object.keys(content ?? {}).sort()).toEqual([
      'application/pdf',
      'text/plain',
    ]);
  });

  it('documents retention-safe DELETE responses as bodyless 204', () => {
    const deleteOperations = operations.filter(
      ({ method }) => method === 'delete',
    );

    expect(deleteOperations).toHaveLength(2);
    for (const { key, operation } of deleteOperations) {
      const response = operation.responses?.['204'];

      expect(response, key).toBeDefined();
      expect(
        response && 'content' in response ? response.content : undefined,
        key,
      ).toBeUndefined();
    }
  });
});
