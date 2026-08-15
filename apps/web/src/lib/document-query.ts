const DEFAULT_DOCUMENT_PAGE = 1;
export const DOCUMENT_PAGE_SIZE = 10;

export interface DocumentSearchParams {
  documentPage?: string | string[];
  documentCreated?: string | string[];
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseDocumentPage(searchParams: DocumentSearchParams): number {
  const value = first(searchParams.documentPage);

  if (!value || !/^\d+$/.test(value)) {
    return DEFAULT_DOCUMENT_PAGE;
  }

  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000
    ? page
    : DEFAULT_DOCUMENT_PAGE;
}

export function documentApiSearch(page: number): string {
  return new URLSearchParams({
    page: String(page),
    pageSize: String(DOCUMENT_PAGE_SIZE),
  }).toString();
}

export function documentPageHref(candidateId: string, page: number): string {
  return `/candidates/${candidateId}?${new URLSearchParams({
    documentPage: String(page),
  })}`;
}
