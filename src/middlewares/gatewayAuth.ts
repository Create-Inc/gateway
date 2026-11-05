import { Context, Next } from 'hono';

/**
 * Shared-secret authentication for the gateway.
 *
 * When GATEWAY_AUTH_TOKEN is set, every request except the health check
 * (`GET`/`HEAD /`) must send a matching `x-portkey-gateway-token` header.
 * GATEWAY_AUTH_TOKEN may hold several comma-separated tokens so a token can
 * be rotated without downtime (add new, roll callers, remove old). When it is
 * unset nothing is enforced; start-server.ts logs a warning.
 *
 * The header is removed from the request after it is checked so it can never
 * be forwarded to an upstream provider (the proxy paths forward caller
 * headers).
 */
export const GATEWAY_TOKEN_HEADER = 'x-portkey-gateway-token';

export function parseGatewayTokens(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return new Uint8Array(digest);
}

/**
 * Constant-time check of `presented` against every configured token. Both
 * sides are hashed first so the comparison is always over 32 bytes,
 * independent of the presented length, and every token is compared even
 * after a match.
 */
export async function tokenMatches(
  presented: string,
  tokens: readonly string[]
): Promise<boolean> {
  const presentedDigest = await sha256(presented);
  let matched = 0;
  for (const token of tokens) {
    const tokenDigest = await sha256(token);
    let diff = 0;
    for (let i = 0; i < presentedDigest.length; i++) {
      diff |= presentedDigest[i] ^ tokenDigest[i];
    }
    // 1 when diff === 0, else 0, without branching on the secret.
    matched |= ((diff - 1) >>> 8) & 1;
  }
  return matched === 1;
}

function isHealthCheck(c: Context) {
  return (
    c.req.path === '/' && (c.req.method === 'GET' || c.req.method === 'HEAD')
  );
}

export function createGatewayAuthMiddleware(
  getTokens: (c: Context) => readonly string[]
) {
  return async (c: Context, next: Next) => {
    const tokens = getTokens(c);
    if (tokens.length === 0 || isHealthCheck(c)) {
      return next();
    }
    const presented = c.req.header(GATEWAY_TOKEN_HEADER);
    if (!presented || !(await tokenMatches(presented, tokens))) {
      return c.json({ status: 'failure', message: 'Unauthorized' }, 401);
    }
    try {
      c.req.raw.headers.delete(GATEWAY_TOKEN_HEADER);
    } catch (err) {
      // Runtimes with immutable request headers (workerd) can't strip it.
      console.warn('gatewayAuth: could not strip token header', err);
    }
    return next();
  };
}
