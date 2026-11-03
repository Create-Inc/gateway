/**
 * Allowlist for caller-supplied custom hosts (`x-portkey-custom-host` and
 * `custom_host` in `x-portkey-config`, at any target depth).
 *
 * Configured with ALLOWED_CUSTOM_HOSTS: a list of origins separated by commas
 * and/or whitespace, e.g. `https://api.fireworks.ai,https://openrouter.ai`.
 * Like other env vars here it may be a path to a file (see
 * getValueOrFileContents); in that form one origin per line works and `#`
 * starts a comment. A bare hostname
 * (`api.fireworks.ai`) is shorthand for its https origin. Matching is on the
 * parsed origin (scheme + hostname + port), never on a string prefix, so
 * `https://api.fireworks.ai.attacker.example` or
 * `https://api.fireworks.ai@attacker.example` do not match. Any path is
 * allowed under an allowed origin.
 *
 * Unset or empty means NO custom host is allowed (fail closed).
 */

const parsedCache = new Map<string, ReadonlySet<string>>();

function toOrigin(entry: string): string | null {
  const value = entry.trim();
  if (!value) return null;
  // An unreadable file path is passed through verbatim by
  // getValueOrFileContents; never let it parse as a hostname.
  if (value.startsWith('/') || value.startsWith('.')) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseAllowedCustomHosts(
  raw: string | undefined | null
): ReadonlySet<string> {
  const key = raw ?? '';
  const cached = parsedCache.get(key);
  if (cached) return cached;

  const origins = new Set<string>();
  const entries = key
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join(',')
    .split(/[\s,]+/);
  for (const entry of entries) {
    if (!entry.trim()) continue;
    const origin = toOrigin(entry);
    if (origin === null) {
      console.warn(
        `ALLOWED_CUSTOM_HOSTS: ignoring invalid entry ${JSON.stringify(entry.trim())}`
      );
      continue;
    }
    origins.add(origin);
  }
  parsedCache.set(key, origins);
  return origins;
}

export function isCustomHostAllowed(
  customHost: string,
  allowedOrigins: ReadonlySet<string>
): boolean {
  if (allowedOrigins.size === 0) return false;
  let url: URL;
  try {
    url = new URL(customHost.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  return allowedOrigins.has(url.origin);
}
