// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentApprovalControl } from './document-approval-control';

const documentId = '50000000-0000-4000-8000-000000000001';
const attemptId = '70000000-0000-4000-8000-000000000001';
const approvedDocument = {
  id: documentId,
  candidateId: '40000000-0000-4000-8000-000000000001',
  type: 'RIGHT_TO_WORK' as const,
  currentVersion: {
    id: '60000000-0000-4000-8000-000000000001',
    versionNumber: 1,
    issueDate: null,
    expiryDate: null,
    status: 'APPROVED' as const,
    createdAt: '2026-08-15T10:00:00.000Z',
  },
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:05:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentApprovalControl', () => {
  it('requires explicit confirmation, prevents duplicate submission and sends only an attempt nonce', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(approvedDocument));
    vi.stubGlobal('fetch', fetchMock);
    const onApproved = vi.fn();
    render(
      <DocumentApprovalControl
        documentId={documentId}
        createAttemptId={() => attemptId}
        onApproved={onApproved}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Approve current version' }),
    );
    const confirm = screen.getByRole('button', { name: 'Confirm approval' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(onApproved).toHaveBeenCalledWith(approvedDocument),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `/api/documents/${documentId}/approve`,
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      attemptId,
    });
  });

  it('supports Escape cancellation and restores focus to its trigger', async () => {
    render(
      <DocumentApprovalControl
        documentId={documentId}
        onApproved={() => undefined}
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Approve current version',
    });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Approve current version' }),
      ),
    );
  });

  it('uses the established session-loss transition and shows safe failures', async () => {
    const onSessionLost = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Authentication is required.',
          },
          { status: 401 },
        ),
      ),
    );
    render(
      <DocumentApprovalControl
        documentId={documentId}
        onApproved={() => undefined}
        onSessionLost={onSessionLost}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Approve current version' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => expect(onSessionLost).toHaveBeenCalledOnce());
  });

  it('keeps one logical attempt across a recoverable retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 502,
            detail: 'The service could not complete the request.',
          },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json(approvedDocument));
    vi.stubGlobal('fetch', fetchMock);
    const onApproved = vi.fn();
    render(
      <DocumentApprovalControl
        documentId={documentId}
        createAttemptId={() => attemptId}
        onApproved={onApproved}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Approve current version' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText(
      'The document could not be approved. Please try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

    await waitFor(() => expect(onApproved).toHaveBeenCalledOnce());
    const attempts = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1]!.body as string),
    );
    expect(attempts).toEqual([{ attemptId }, { attemptId }]);
  });
});
