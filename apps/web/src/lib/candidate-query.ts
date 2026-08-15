import {
  candidateListQuerySchema,
  type CandidateListQuery,
} from '@candidate-compliance/contracts';

export type CandidateSearchParams = Record<
  string,
  string | string[] | undefined
>;

export const CANDIDATE_PAGE_SIZE = 20;

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function boundedText(
  value: string | string[] | undefined,
  maximumLength: number,
): string | undefined {
  const text = singleValue(value)?.trim();
  return text && text.length <= maximumLength ? text : undefined;
}

function pageFrom(value: string | string[] | undefined): number {
  const text = singleValue(value);

  if (!text || !/^\d+$/.test(text)) {
    return 1;
  }

  const page = Number(text);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
}

export function parseCandidateQuery(
  searchParams: CandidateSearchParams,
): CandidateListQuery {
  const search = boundedText(searchParams.search, 200);
  const emailValue = boundedText(searchParams.email, 254);
  const roleAppliedFor = boundedText(searchParams.roleAppliedFor, 200);
  const emailResult = candidateListQuerySchema.safeParse({
    page: 1,
    pageSize: CANDIDATE_PAGE_SIZE,
    email: emailValue,
  });

  return candidateListQuerySchema.parse({
    page: pageFrom(searchParams.page),
    pageSize: CANDIDATE_PAGE_SIZE,
    search,
    email: emailResult.success ? emailResult.data.email : undefined,
    roleAppliedFor,
  });
}

export function candidateListSearch(query: CandidateListQuery): string {
  const params = new URLSearchParams();

  if (query.search) {
    params.set('search', query.search);
  }

  if (query.email) {
    params.set('email', query.email);
  }

  if (query.roleAppliedFor) {
    params.set('roleAppliedFor', query.roleAppliedFor);
  }

  if (query.page > 1) {
    params.set('page', String(query.page));
  }

  const value = params.toString();
  return value ? `?${value}` : '';
}

export function candidateApiSearch(query: CandidateListQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });

  if (query.search) {
    params.set('search', query.search);
  }

  if (query.email) {
    params.set('email', query.email);
  }

  if (query.roleAppliedFor) {
    params.set('roleAppliedFor', query.roleAppliedFor);
  }

  return params.toString();
}
