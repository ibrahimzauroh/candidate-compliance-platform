// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInForm } from './sign-in-form';

const user = {
  id: '20000000-0000-4000-8000-000000000001',
  email: 'admin@example.test',
  displayName: 'Demo Administrator',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockSessionReset(nextResponse?: Response) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  if (nextResponse) {
    fetchMock.mockResolvedValueOnce(nextResponse);
  }

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SignInForm', () => {
  it('associates validation errors with persistent labelled controls', async () => {
    mockSessionReset();
    render(<SignInForm />);

    await waitFor(() =>
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.submit(screen.getByRole('button').closest('form')!);

    expect(
      screen.getByLabelText('Email address').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Check the highlighted fields',
    );
  });

  it('prevents duplicate submission and transitions after success', async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = mockSessionReset(Response.json(user));
    render(<SignInForm onAuthenticated={onAuthenticated} />);

    await waitFor(() =>
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-password' },
    });
    const form = screen.getByRole('button').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a bounded authentication failure without exposing response internals', async () => {
    mockSessionReset(
      Response.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid email or password.',
        },
        { status: 401 },
      ),
    );
    render(<SignInForm />);

    await waitFor(() =>
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.submit(screen.getByRole('button').closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Email or password was not recognised.',
    );
  });
});
