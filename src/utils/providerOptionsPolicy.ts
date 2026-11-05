/**
 * Validation for caller-supplied provider options that end up in the
 * outbound URL's hostname (e.g. `https://bedrock-runtime.${awsRegion}...`,
 * `https://${resourceName}.openai.azure.com`). Without a strict format a
 * value like `x@attacker.example/#` would move the request to another host.
 *
 * Pure: no env access, so it can be unit tested and used from any handler.
 */
import { isAmbientCredentialsEnabled } from './ambientCredentials';

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** True for a single DNS label (regions, Azure resource names). */
export const isDnsLabel = (value: unknown): value is string =>
  typeof value === 'string' && DNS_LABEL.test(value);
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Single DNS label: regions and Azure resource names. */
const LABEL_FIELDS = [
  'awsRegion',
  'vertexRegion',
  'oracleRegion',
  'resourceName',
] as const;

/** Dotted hostnames interpolated into a host (S3 buckets, Snowflake). */
const HOSTNAME_FIELDS = ['awsS3Bucket', 'snowflakeAccount'] as const;

/** Full URLs that replace the provider base URL: same rules as custom_host. */
export const URL_FIELDS = ['azureFoundryUrl', 'huggingfaceBaseUrl'] as const;

const AMBIENT_AZURE_AUTH_MODES = new Set(['managed', 'workload']);

export interface ProviderOptionsPolicyInput {
  options: Record<string, unknown>;
  env: Record<string, unknown> | undefined | null;
  isAllowedUrl: (url: string) => boolean;
}

/** Returns a client-facing error message, or null when the options are OK. */
export function findProviderOptionsViolation({
  options,
  env,
  isAllowedUrl,
}: ProviderOptionsPolicyInput): string | null {
  for (const field of LABEL_FIELDS) {
    const value = options[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !DNS_LABEL.test(value)) {
      return `Invalid ${field}`;
    }
  }
  for (const field of HOSTNAME_FIELDS) {
    const value = options[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !HOSTNAME.test(value)) {
      return `Invalid ${field}`;
    }
  }
  for (const field of URL_FIELDS) {
    const value = options[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !isAllowedUrl(value)) {
      return `Invalid ${field}`;
    }
  }

  const ambientAllowed = isAmbientCredentialsEnabled(env);
  if (!ambientAllowed && options.awsAuthType === 'assumedRole') {
    return 'aws_auth_type "assumedRole" is disabled on this gateway';
  }
  if (
    !ambientAllowed &&
    typeof options.azureAuthMode === 'string' &&
    AMBIENT_AZURE_AUTH_MODES.has(options.azureAuthMode)
  ) {
    return `azure_auth_mode "${options.azureAuthMode}" is disabled on this gateway`;
  }
  return null;
}

/** Credentials or other user-info in a built provider URL is never valid. */
export function hasUserInfo(url: string): boolean {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.username || parsed.password);
  } catch {
    // Not an absolute URL (e.g. providers served by a request handler).
    return false;
  }
}
