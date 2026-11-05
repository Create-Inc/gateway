import { Context } from 'hono';
import { isValidCustomHost } from '../middlewares/requestValidator';
import { Environment } from './env';
import { findProviderOptionsViolation } from './providerOptionsPolicy';

/**
 * Every check on where a provider request may go, for one target: the
 * custom host allowlist plus the hostname-forming provider options and
 * ambient-credential auth modes. Returns a client-facing message or null.
 *
 * Called from ProviderContext.getFullURL (all HTTP routes, including those
 * that skip requestValidator and nested/inherited targets) and from both
 * realtime handlers.
 */
export function findOutboundTargetViolation({
  customHost,
  providerOptions,
  c,
}: {
  customHost: string | undefined | null;
  providerOptions: object;
  c: Context | undefined;
}): string | null {
  if (customHost && !isValidCustomHost(customHost, c)) {
    return 'Invalid custom host';
  }
  return findProviderOptionsViolation({
    options: providerOptions as Record<string, unknown>,
    env: Environment(c),
    isAllowedUrl: (url) => isValidCustomHost(url, c),
  });
}
