// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComplianceDocumentForm } from './compliance-document-form';

const candidateId = '40000000-0000-4000-8000-000000000001';
const attemptId = '50000000-0000-4000-8000-000000000001';
const document = {
  id: '60000000-0000-4000-8000-000000000001',
  candidateId,
  type: 'RIGHT_TO_WORK' as const,
  currentVersion: {
    id: '70000000-0000-4000-8000-000000000001',
    versionNumber: 1,
    issueDate: '2026-08-01',
    expiryDate: '2027-08-01',
    status: 'DRAFT' as const,
    createdAt: '2026-08-15T10:00:00.000Z',
  },
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillDates(issueDate = '2026-08-01', expiryDate = '2027-08-01') {
  fireEvent.change(screen.getByLabelText('Issue date (optional)'), {
    target: { value: issueDate },
  });
  fireEvent.change(screen.getByLabelText('Expiry date (optional)'), {
    target: { value: expiryDate },
  });
}

function form(): HTMLFormElement {
  return screen
    .getByRole('button', { name: 'Create document' })
    .closest('form')!;
}

describe('ComplianceDocumentForm', () => {
  it('associates invalid date order with the expiry field', () => {
    render(
      <ComplianceDocumentForm
        candidateId={candidateId}
        createAttemptId={() => attemptId}
      />,
    );
    fillDates('2027-08-01', '2026-08-01');

    fireEvent.submit(form());

    expect(
      screen
        .getByLabelText('Expiry date (optional)')
        .getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByText(/must not be earlier/i)).toBeTruthy();
  });

  it('prevents duplicate submission and sends only the bounded document envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(document, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    render(
      <ComplianceDocumentForm
        candidateId={candidateId}
        createAttemptId={() => attemptId}
        onCreated={onCreated}
      />,
    );
    fillDates();
    const documentForm = form();

    fireEvent.submit(documentForm);
    fireEvent.submit(documentForm);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(document));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `/api/candidates/${candidateId}/documents`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      attemptId,
      document: {
        type: 'RIGHT_TO_WORK',
        issueDate: '2026-08-01',
        expiryDate: '2027-08-01',
      },
    });
  });

  it('keeps values and the logical attempt stable across a recoverable retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 502,
            detail:
              'The service could not complete the request. Please try again.',
          },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json(document, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    render(
      <ComplianceDocumentForm
        candidateId={candidateId}
        createAttemptId={() => attemptId}
        onCreated={onCreated}
      />,
    );
    fillDates();

    fireEvent.submit(form());
    await screen.findByText(
      'The document could not be created. Please try again.',
    );
    expect(
      (screen.getByLabelText('Expiry date (optional)') as HTMLInputElement)
        .value,
    ).toBe('2027-08-01');

    fireEvent.submit(form());
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());

    const attempts = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1]!.body as string),
    );
    expect(attempts[0].attemptId).toBe(attemptId);
    expect(attempts[1].attemptId).toBe(attemptId);
  });

  it('maps safe field errors and preserves entered values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            detail: 'The request data is invalid.',
            errors: [
              {
                path: 'expiryDate',
                message: 'Expiry date is not acceptable.',
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    render(
      <ComplianceDocumentForm
        candidateId={candidateId}
        createAttemptId={() => attemptId}
      />,
    );
    fillDates();

    fireEvent.submit(form());

    expect(
      await screen.findByText('Expiry date is not acceptable.'),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Issue date (optional)') as HTMLInputElement)
        .value,
    ).toBe('2026-08-01');
  });

  it('uses the established session-loss transition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Your session is no longer valid. Please sign in again.',
          },
          { status: 401 },
        ),
      ),
    );
    const onSessionLost = vi.fn();
    render(
      <ComplianceDocumentForm
        candidateId={candidateId}
        createAttemptId={() => attemptId}
        onSessionLost={onSessionLost}
      />,
    );

    fireEvent.submit(form());

    await waitFor(() => expect(onSessionLost).toHaveBeenCalledOnce());
  });
});
