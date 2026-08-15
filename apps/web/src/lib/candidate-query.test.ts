import { describe, expect, it } from 'vitest';

import {
  candidateApiSearch,
  candidateListSearch,
  parseCandidateQuery,
} from './candidate-query';

describe('Candidate query state', () => {
  it('normalises supported filters and preserves them in list links', () => {
    const query = parseCandidateQuery({
      page: '3',
      search: '  ada  ',
      email: 'ADA@EXAMPLE.TEST',
      roleAppliedFor: '  engineer  ',
    });

    expect(query).toEqual({
      page: 3,
      pageSize: 20,
      search: 'ada',
      email: 'ada@example.test',
      roleAppliedFor: 'engineer',
    });
    expect(candidateListSearch(query)).toBe(
      '?search=ada&email=ada%40example.test&roleAppliedFor=engineer&page=3',
    );
    expect(candidateApiSearch(query)).toBe(
      'page=3&pageSize=20&search=ada&email=ada%40example.test&roleAppliedFor=engineer',
    );
  });

  it('falls back safely for malformed, duplicated and out-of-range values', () => {
    const query = parseCandidateQuery({
      page: '100001',
      search: ['first', 'second'],
      email: 'not-an-email',
      roleAppliedFor: 'x'.repeat(201),
      tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });

    expect(query).toEqual({ page: 1, pageSize: 20 });
    expect(candidateListSearch(query)).toBe('');
  });
});
