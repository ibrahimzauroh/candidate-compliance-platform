// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CvProposalReview } from './cv-proposal-review';

const candidateId = '40000000-0000-4000-8000-000000000001';
const extractionId = '50000000-0000-4000-8000-000000000001';
const confirmAttemptId = '60000000-0000-4000-8000-000000000001';
const rejectAttemptId = '60000000-0000-4000-8000-000000000002';
const proposedOutput = {
  fullName: 'Ada Candidate',
  skills: ['TypeScript', 'PostgreSQL'],
  yearsOfExperience: 6,
  certifications: ['Right to Work'],
};
const proposed = {
  id: extractionId,
  candidateId,
  purpose: 'CANDIDATE_PROFILE' as const,
  provider: 'local-mock',
  model: 'deterministic-v1',
  status: 'PROPOSED' as const,
  proposedOutput,
  confirmedOutput: null,
  createdAt: '2026-08-15T10:00:00.000Z',
  decidedAt: null,
  updatedAt: '2026-08-15T10:00:00.000Z',
};
const accepted = {
  ...proposed,
  status: 'ACCEPTED' as const,
  confirmedOutput: {
    ...proposedOutput,
    fullName: 'Ada Z. Candidate',
    yearsOfExperience: 7,
  },
  decidedAt: '2026-08-15T10:05:00.000Z',
  updatedAt: '2026-08-15T10:05:00.000Z',
};
const rejected = {
  ...proposed,
  status: 'REJECTED' as const,
  decidedAt: '2026-08-15T10:05:00.000Z',
  updatedAt: '2026-08-15T10:05:00.000Z',
};

function attemptFactory(): () => string {
  const values = [confirmAttemptId, rejectAttemptId];
  return () => values.shift() ?? rejectAttemptId;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function reviewForm(): HTMLFormElement {
  return screen
    .getByRole('button', { name: 'Review confirmation' })
    .closest('form')!;
}

describe('CvProposalReview', () => {
  it('labels proposed values as non-authoritative and prefills separate recruiter fields', () => {
    render(
      <CvProposalReview
        candidateId={candidateId}
        extraction={proposed}
        createAttemptId={attemptFactory()}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Review CV proposal',
    );
    expect(screen.getByText('Proposal is not authoritative')).toBeTruthy();
    expect(screen.getByText('AI-proposed values')).toBeTruthy();
    expect(
      (screen.getByLabelText('Confirmed name') as HTMLInputElement).value,
    ).toBe('Ada Candidate');
    expect(screen.queryByText('local-mock')).toBeNull();
    expect(screen.queryByText('deterministic-v1')).toBeNull();
  });

  it('associates shared-contract validation errors with recruiter fields', () => {
    render(
      <CvProposalReview
        candidateId={candidateId}
        extraction={proposed}
        createAttemptId={attemptFactory()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Confirmed name'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Confirmed years of experience'), {
      target: { value: '81' },
    });
    fireEvent.submit(reviewForm());

    expect(
      screen.getByLabelText('Confirmed name').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen
        .getByLabelText('Confirmed years of experience')
        .getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain(
      'Check the highlighted recruiter-confirmed values',
    );
  });

  it('requires explicit confirmation and renders the authoritative backend response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(accepted));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CvProposalReview
        candidateId={candidateId}
        extraction={proposed}
        createAttemptId={attemptFactory()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Confirmed name'), {
      target: { value: 'Ada Z. Candidate' },
    });
    fireEvent.change(screen.getByLabelText('Confirmed years of experience'), {
      target: { value: '7' },
    });
    fireEvent.submit(reviewForm());

    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm profile' }));

    await screen.findByText('Recruiter-confirmed profile');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      attemptId: confirmAttemptId,
      profile: accepted.confirmedOutput,
    });
    expect(screen.getByText('Confirmed (ACCEPTED)')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Confirm profile' }),
    ).toBeNull();
    expect(screen.getAllByText('Ada Z. Candidate')).toHaveLength(1);
  });

  it('preserves edits and logical identity across a recoverable confirmation retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 502,
            detail: 'Provider diagnostic must not reach the UI.',
          },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json(accepted));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CvProposalReview
        candidateId={candidateId}
        extraction={proposed}
        createAttemptId={attemptFactory()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Confirmed name'), {
      target: { value: 'Ada Z. Candidate' },
    });
    fireEvent.change(screen.getByLabelText('Confirmed years of experience'), {
      target: { value: '7' },
    });
    fireEvent.submit(reviewForm());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm profile' }));
    await screen.findByText(
      'The proposal could not be confirmed. Please try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm profile' }));

    await screen.findByText('Recruiter-confirmed profile');
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1]!.body as string),
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0].attemptId).toBe(confirmAttemptId);
  });

  it('uses explicit proposal-only rejection and never represents the Candidate as rejected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(rejected));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <CvProposalReview
        candidateId={candidateId}
        extraction={proposed}
        createAttemptId={attemptFactory()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reject AI proposal' }));

    expect(screen.getByText('Reject this AI proposal only?')).toBeTruthy();
    expect(
      screen.getByText(/does not reject, score, rank, remove/i),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reject proposal only' }),
    );

    await screen.findByText('AI proposal rejected');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      attemptId: rejectAttemptId,
    });
    expect(screen.getByText(/Candidate record was not rejected/i)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /confirm profile/i }),
    ).toBeNull();
  });

  it('renders terminal accepted and rejected states as read-only', () => {
    const first = render(
      <CvProposalReview candidateId={candidateId} extraction={accepted} />,
    );
    expect(screen.getByText('Recruiter-confirmed profile')).toBeTruthy();
    expect(screen.queryByLabelText('Confirmed name')).toBeNull();

    first.unmount();
    render(
      <CvProposalReview candidateId={candidateId} extraction={rejected} />,
    );
    expect(screen.getByText('AI proposal rejected')).toBeTruthy();
    expect(screen.queryByLabelText('Confirmed name')).toBeNull();
  });

  it('hands session loss to the established transition', async () => {
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
      <CvProposalReview
        candidateId={candidateId}
        extraction={proposed}
        createAttemptId={attemptFactory()}
        onSessionLost={onSessionLost}
      />,
    );
    fireEvent.submit(reviewForm());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm profile' }));

    await waitFor(() => expect(onSessionLost).toHaveBeenCalledOnce());
    expect(screen.getByText('Your session has expired.')).toBeTruthy();
  });
});
