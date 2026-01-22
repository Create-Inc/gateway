import * as Sentry from '@sentry/cloudflare';

// Re-export Sentry functions for use throughout the app
export const captureException = Sentry.captureException;
export const setTag = Sentry.setTag;
export const setContext = Sentry.setContext;
export const withScope = Sentry.withScope;

export { Sentry };
