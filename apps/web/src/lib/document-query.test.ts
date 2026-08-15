import { describe, expect, it } from 'vitest';

import {
  documentApiSearch,
  documentPageHref,
  parseDocumentPage,
} from './document-query';

describe('document query state', () => {
  it.each([undefined, '', '0', '-1', '1.5', 'abc', '100001'])(
    'falls back safely for malformed page %s',
    (documentPage) => {
      expect(parseDocumentPage({ documentPage })).toBe(1);
    },
  );

  it('uses the first bounded page value and builds server pagination', () => {
    expect(parseDocumentPage({ documentPage: ['3', '4'] })).toBe(3);
    expect(documentApiSearch(3)).toBe('page=3&pageSize=10');
    expect(documentPageHref('40000000-0000-4000-8000-000000000001', 2)).toBe(
      '/candidates/40000000-0000-4000-8000-000000000001?documentPage=2',
    );
  });
});
