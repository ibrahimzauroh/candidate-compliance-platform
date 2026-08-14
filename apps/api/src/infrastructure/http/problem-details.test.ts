import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { problemDetailsHandler } from './problem-details.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('problemDetailsHandler', () => {
  it('does not log unexpected error details', async () => {
    const sensitiveDetail =
      'postgresql://user:password@database.example/candidate-data';
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const app = express();

    app.get('/test/unexpected-error', () => {
      throw new Error(sensitiveDetail);
    });
    app.use(problemDetailsHandler);

    const response = await request(app).get('/test/unexpected-error');

    expect(response.status).toBe(500);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith('Unexpected request error');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      sensitiveDetail,
    );
  });
});
