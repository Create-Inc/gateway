import { Hono } from 'hono';
import {
  createGatewayAuthMiddleware,
  GATEWAY_TOKEN_HEADER,
  parseGatewayTokens,
  tokenMatches,
} from './gatewayAuth';

function buildApp(rawTokens: string | undefined) {
  const app = new Hono();
  app.use(
    '*',
    createGatewayAuthMiddleware(() => parseGatewayTokens(rawTokens))
  );
  app.get('/', (c) => c.text('ok'));
  app.post('/v1/chat/completions', (c) =>
    c.json({ forwardedToken: c.req.header(GATEWAY_TOKEN_HEADER) ?? null })
  );
  return app;
}

const post = (app: Hono, headers: Record<string, string> = {}) =>
  app.request('/v1/chat/completions', { method: 'POST', headers });

describe('parseGatewayTokens', () => {
  test('splits, trims and drops empties', () => {
    expect(parseGatewayTokens(' a , b,,')).toEqual(['a', 'b']);
    expect(parseGatewayTokens(undefined)).toEqual([]);
    expect(parseGatewayTokens('')).toEqual([]);
  });
});

describe('tokenMatches', () => {
  test('matches any configured token', async () => {
    expect(await tokenMatches('new', ['old', 'new'])).toBe(true);
    expect(await tokenMatches('old', ['old', 'new'])).toBe(true);
  });

  test('rejects near misses and empty input', async () => {
    expect(await tokenMatches('ne', ['new'])).toBe(false);
    expect(await tokenMatches('new ', ['new'])).toBe(false);
    expect(await tokenMatches('', ['new'])).toBe(false);
    expect(await tokenMatches('new', [])).toBe(false);
  });
});

describe('gateway auth middleware', () => {
  test('does not enforce when no token is configured', async () => {
    const res = await post(buildApp(undefined));
    expect(res.status).toBe(200);
  });

  test('rejects a missing or wrong token', async () => {
    const app = buildApp('secret-1');
    expect((await post(app)).status).toBe(401);
    const wrong = await post(app, { [GATEWAY_TOKEN_HEADER]: 'secret-2' });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({
      status: 'failure',
      message: 'Unauthorized',
    });
  });

  test('accepts a matching token and strips it before the handler', async () => {
    const res = await post(buildApp('secret-1'), {
      [GATEWAY_TOKEN_HEADER]: 'secret-1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forwardedToken: null });
  });

  test('accepts either token during rotation', async () => {
    const app = buildApp('old-token,new-token');
    for (const token of ['old-token', 'new-token']) {
      const res = await post(app, { [GATEWAY_TOKEN_HEADER]: token });
      expect(res.status).toBe(200);
    }
  });

  test('leaves the health check open', async () => {
    const app = buildApp('secret-1');
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/', { method: 'POST' })).status).toBe(401);
  });
});
