// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentCorrectionForm } from './document-correction-form';

const attemptId = '70000000-0000-4000-8000-000000000001';
const approvedDocument = {
  id: '50000000-0000-4000-8000-000000000001',
  candidateId: '40000000-0000-4000-8000-000000000001',
  type: 'RIGHT_TO_WORK' as const,
  currentVersion: {
    id: '60000000-0000-4000-8000-000000000001',
    versionNumber: 1,
    issueDate: '2026-08-01',
    expiryDate: '2027-08-01',
    status: 'APPROVED' as const,
    createdAt: '2026-08-15T10:00:00.000Z',
  },
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:05:00.000Z',
};
const correctedDocument = {
  ...approvedDocument,
  currentVersion: {
    ...approvedDocument.currentVersion,
    id: '60000000-0000-4000-8000-000000000002',
    versionNumber: 2,
    expiryDate: '2028-08-01',
    status: 'DRAFT' as const,
    createdAt: '2026-08-15T11:00:00.000Z',
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function form(): HTMLFormElement {
  return screen
    .getByRole('button', { name: 'Create new draft version' })
    .closest('form')!;
}

describe('DocumentCorrectionForm', () => {
  it('prefills authoritative values and associates invalid date order with expiry', () => {
    render(
      <DocumentCorrectionForm
        document={approvedDocument}
        onCancel={() => undefined}
        onCorrected={() => undefined}
      />,
    );

    expect(
      (screen.getByLabelText('Issue date') as HTMLInputElement).value,
    ).toBe('2026-08-01');
    fireEvent.change(screen.getByLabelText('Issue date'), {
      target: { value: '2028-09-01' },
    });
    fireEvent.submit(form());

    expect(
      screen.getByLabelText('Expiry date').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByText(/must not be earlier/i)).toBeTruthy();
  });

  it('prevents duplicates and submits a complete nullable correction envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(correctedDocument, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onCorrected = vi.fn();
    render(
      <DocumentCorrectionForm
        document={approvedDocument}
        createAttemptId={() => attemptId}
        onCancel={() => undefined}
        onCorrected={onCorrected}
      />,
    );
    fireEvent.change(screen.getByLabelText('Issue date'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Expiry date'), {
      target: { value: '2028-08-01' },
    });

    const correctionForm = form();
    fireEvent.submit(correctionForm);
    fireEvent.submit(correctionForm);

    await waitFor(() =>
      expect(onCorrected).toHaveBeenCalledWith(correctedDocument),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      attemptId,
      correction: { issueDate: null, expiryDate: '2028-08-01' },
    });
  });

  it('preserves input and attempt identity across a recoverable retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 502,
            detail: 'Internal diagnostic must not be shown.',
          },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json(correctedDocument, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onCorrected = vi.fn();
    render(
      <DocumentCorrectionForm
        document={approvedDocument}
        createAttemptId={() => attemptId}
        onCancel={() => undefined}
        onCorrected={onCorrected}
      />,
    );
    fireEvent.change(screen.getByLabelText('Expiry date'), {
      target: { value: '2028-08-01' },
    });

    fireEvent.submit(form());
    await screen.findByText(
      'The correction could not be created. Please try again.',
    );
    expect(
      (screen.getByLabelText('Expiry date') as HTMLInputElement).value,
    ).toBe('2028-08-01');
    fireEvent.submit(form());

    await waitFor(() => expect(onCorrected).toHaveBeenCalledOnce());
    const attempts = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1]!.body as string),
    );
    expect(attempts[0].attemptId).toBe(attemptId);
    expect(attempts[1].attemptId).toBe(attemptId);
  });
});
