import { retryRequest } from '../../../../src/handlers/retryHandler';

describe('retryRequest upstream tracing', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('correlates the final upstream host with the response', async () => {
    const result = await retryRequest(
      'https://models.relace.ai/v1/chat/completions?secret=redacted',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer secret-key' },
        body: '{"private":"payload"}',
      },
      0,
      [],
      null,
      async () => new Response('{}', { status: 200 }),
      false,
      { traceId: 'trace-123' }
    );

    expect(result.response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledTimes(2);

    const started = JSON.parse(infoSpy.mock.calls[0][0]);
    const completed = JSON.parse(infoSpy.mock.calls[1][0]);

    expect(started).toMatchObject({
      event: 'upstream_request_started',
      traceId: 'trace-123',
      upstreamHost: 'models.relace.ai',
      method: 'POST',
      attempt: 1,
    });
    expect(completed).toMatchObject({
      event: 'upstream_request_completed',
      traceId: 'trace-123',
      upstreamHost: 'models.relace.ai',
      method: 'POST',
      attempt: 1,
      status: 200,
    });
    expect(completed.durationMs).toEqual(expect.any(Number));

    const logs = infoSpy.mock.calls.flat().join('\n');
    expect(logs).not.toContain('/v1/chat/completions');
    expect(logs).not.toContain('secret-key');
    expect(logs).not.toContain('private');
  });

  it('logs failed outbound requests without leaking the URL', async () => {
    await retryRequest(
      'https://models.relace.ai/v1/chat/completions?api_key=secret',
      { method: 'POST' },
      0,
      [],
      null,
      async () => {
        throw new TypeError('network failure');
      },
      false,
      { traceId: 'trace-456' }
    );

    const failed = JSON.parse(infoSpy.mock.calls[1][0]);
    expect(failed).toMatchObject({
      event: 'upstream_request_failed',
      traceId: 'trace-456',
      upstreamHost: 'models.relace.ai',
      method: 'POST',
      attempt: 1,
      errorName: 'TypeError',
    });

    const logs = infoSpy.mock.calls.flat().join('\n');
    expect(logs).not.toContain('/v1/chat/completions');
    expect(logs).not.toContain('api_key');
  });
});
