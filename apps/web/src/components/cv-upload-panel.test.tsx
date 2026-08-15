// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CvUploadPanel } from './cv-upload-panel';

const candidateId = '40000000-0000-4000-8000-000000000001';
const extraction = {
  id: '50000000-0000-4000-8000-000000000001',
  candidateId,
  purpose: 'CANDIDATE_PROFILE' as const,
  provider: 'local-mock',
  model: 'deterministic-v1',
  status: 'PROPOSED' as const,
  proposedOutput: {
    fullName: 'Ada Candidate',
    skills: ['TypeScript'],
    yearsOfExperience: 6,
    certifications: [],
  },
  confirmedOutput: null,
  createdAt: '2026-08-15T10:00:00.000Z',
  decidedAt: null,
  updatedAt: '2026-08-15T10:00:00.000Z',
};
const initialAttemptId = '60000000-0000-4000-8000-000000000001';
const selectedAttemptId = '60000000-0000-4000-8000-000000000002';

function attemptFactory() {
  const attempts = [initialAttemptId, selectedAttemptId];
  return vi
    .fn()
    .mockImplementation(() => attempts.shift() ?? selectedAttemptId);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function uploadForm(): HTMLFormElement {
  return screen
    .getByRole('button', { name: 'Upload and review proposal' })
    .closest('form')!;
}

function select(file: File): void {
  fireEvent.change(screen.getByLabelText('CV file'), {
    target: { files: [file] },
  });
}

describe('CvUploadPanel', () => {
  it('validates supported content without logging or submitting raw data', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CvUploadPanel
        candidateId={candidateId}
        createAttemptId={() => initialAttemptId}
      />,
    );

    fireEvent.submit(uploadForm());
    expect(screen.getAllByText(/choose a UTF-8 text or PDF/i)).toHaveLength(2);

    select(new File(['content'], 'cv.docx', { type: 'application/msword' }));
    fireEvent.submit(uploadForm());
    expect(screen.getAllByText(/only UTF-8 text and PDF/i)).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prevents duplicates and sends the raw file with a browser logical attempt only', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(extraction, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    const createAttemptId = attemptFactory();
    render(
      <CvUploadPanel
        candidateId={candidateId}
        createAttemptId={createAttemptId}
        onCreated={onCreated}
      />,
    );
    const file = new File(['Ada CV'], 'ada.txt', { type: 'text/plain' });
    select(file);

    const form = uploadForm();
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(extraction));
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBe(file);
    expect(headers['Content-Type']).toBe('text/plain');
    expect(headers['X-CV-Attempt-Id']).toBe(selectedAttemptId);
    expect(headers).not.toHaveProperty('Idempotency-Key');
    expect(headers).not.toHaveProperty('X-Tenant-Id');
  });

  it('keeps the file and logical attempt across a recoverable retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 502,
            detail: 'Internal provider diagnostics.',
          },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json(extraction, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    const createAttemptId = attemptFactory();
    render(
      <CvUploadPanel
        candidateId={candidateId}
        createAttemptId={createAttemptId}
        onCreated={onCreated}
      />,
    );
    select(new File(['Ada CV'], 'ada.txt', { type: 'text/plain' }));

    fireEvent.submit(uploadForm());
    await waitFor(() =>
      expect(
        screen.getAllByText(
          'The CV proposal could not be created. Please try again.',
        ),
      ).toHaveLength(2),
    );
    fireEvent.submit(uploadForm());

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual(
      fetchMock.mock.calls[1]![1]!.headers,
    );
  });

  it('hands authentication loss to the established session transition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Your session is no longer valid.',
          },
          { status: 401 },
        ),
      ),
    );
    const onSessionLost = vi.fn();
    render(
      <CvUploadPanel
        candidateId={candidateId}
        createAttemptId={() => initialAttemptId}
        onSessionLost={onSessionLost}
      />,
    );
    select(new File(['Ada CV'], 'ada.txt', { type: 'text/plain' }));
    fireEvent.submit(uploadForm());

    await waitFor(() => expect(onSessionLost).toHaveBeenCalledOnce());
    expect(screen.getByRole('status').textContent).toContain(
      'session has expired',
    );
  });
});
