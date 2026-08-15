// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidateForm } from './candidate-form';

const attemptId = '40000000-0000-4000-8000-000000000001';
const candidate = {
  id: '50000000-0000-4000-8000-000000000001',
  fullName: 'Ada Candidate',
  email: 'ada@example.test',
  roleAppliedFor: 'Compliance Engineer',
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillValidForm(): void {
  fireEvent.change(screen.getByLabelText('Full name'), {
    target: { value: '  Ada Candidate  ' },
  });
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'ADA@EXAMPLE.TEST' },
  });
  fireEvent.change(screen.getByLabelText('Role applied for'), {
    target: { value: '  Compliance Engineer  ' },
  });
}

describe('CandidateForm', () => {
  it('associates shared-contract validation errors with persistent labels', () => {
    render(<CandidateForm createAttemptId={() => attemptId} />);

    fireEvent.submit(
      screen.getByRole('button', { name: 'Create candidate' }).closest('form')!,
    );

    expect(
      screen.getByLabelText('Full name').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByLabelText('Email address').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByLabelText('Role applied for').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain(
      'Check the highlighted fields',
    );
  });

  it('prevents duplicate submission and returns the validated Candidate', async () => {
    const onCreated = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(candidate, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CandidateForm createAttemptId={() => attemptId} onCreated={onCreated} />,
    );
    fillValidForm();
    const form = screen
      .getByRole('button', { name: 'Create candidate' })
      .closest('form')!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(candidate));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      attemptId,
      candidate: {
        fullName: 'Ada Candidate',
        email: 'ada@example.test',
        roleAppliedFor: 'Compliance Engineer',
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
      .mockResolvedValueOnce(Response.json(candidate, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    render(
      <CandidateForm createAttemptId={() => attemptId} onCreated={onCreated} />,
    );
    fillValidForm();
    const form = screen
      .getByRole('button', { name: 'Create candidate' })
      .closest('form')!;

    fireEvent.submit(form);
    await screen.findByText(
      'The candidate could not be created. Please try again.',
    );
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe(
      '  Ada Candidate  ',
    );

    fireEvent.submit(form);
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());

    const attempts = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1]!.body as string),
    );
    expect(attempts[0].attemptId).toBe(attemptId);
    expect(attempts[1].attemptId).toBe(attemptId);
  });

  it('maps bounded server validation errors without clearing user input', async () => {
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
              { path: 'email', message: 'Enter a valid email address.' },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    render(<CandidateForm createAttemptId={() => attemptId} />);
    fillValidForm();

    fireEvent.submit(
      screen.getByRole('button', { name: 'Create candidate' }).closest('form')!,
    );

    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Email address') as HTMLInputElement).value,
    ).toBe('ADA@EXAMPLE.TEST');
  });

  it('hands session loss to the established re-authentication transition', async () => {
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
      <CandidateForm
        createAttemptId={() => attemptId}
        onSessionLost={onSessionLost}
      />,
    );
    fillValidForm();

    fireEvent.submit(
      screen.getByRole('button', { name: 'Create candidate' }).closest('form')!,
    );

    await waitFor(() => expect(onSessionLost).toHaveBeenCalledOnce());
    expect(screen.getByRole('status').textContent).toContain(
      'session has expired',
    );
  });
});
