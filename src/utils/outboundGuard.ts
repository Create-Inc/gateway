/**
 * Node-only egress guard. Installed as undici's global dispatcher in
 * start-server.ts so EVERY `fetch` the gateway makes (provider calls, custom
 * hosts, redirect hops, image prefetch, guardrail webhooks, ...) can only
 * connect to public unicast addresses.
 *
 * The check runs inside the connection's own DNS lookup, so the addresses we
 * validate are exactly the ones the socket connects to: there is no second
 * resolution a rebinding DNS server could answer differently. Every record
 * must be public, so a mixed answer can't smuggle a private address in. IP
 * literals skip `lookup` in net/tls, so the connector checks those itself.
 *
 * Hosts listed in TRUSTED_CUSTOM_HOSTS are exempt (that variable is the
 * explicit opt-in for reaching private hosts such as a self-hosted Ollama).
 * Anything inside the gateway that must reach a private/link-local endpoint
 * has to pass its own `dispatcher` to fetch.
 */
import dns from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, buildConnector } from 'undici';

export class BlockedOutboundAddressError extends Error {
  code = 'EGRESS_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'BlockedOutboundAddressError';
  }
}

/**
 * True only for routable public ("unicast") addresses. Private, loopback,
 * link-local (incl. 169.254.169.254 IMDS and 169.254.170.2 ECS agent /
 * task-credentials), CGNAT, unique-local, multicast, reserved, 6to4/NAT64 etc.
 * are all rejected. IPv4-mapped IPv6 is unwrapped first.
 */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  return ipaddr.process(ip).range() === 'unicast';
}

type LookupAddress = { address: string; family: number };
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number
) => void;
type LookupAllFn = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: LookupAddress[]
  ) => void
) => void;

interface GuardOptions {
  /** Hostnames / IP literals (lowercase) exempt from the address check. */
  exemptHosts: ReadonlySet<string>;
  isAllowedAddress: (ip: string) => boolean;
  /** Injectable resolver for tests; defaults to dns.lookup. */
  resolve: LookupAllFn;
}

function normalizeHost(host: string) {
  return host.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

export function createGuardedLookup({
  exemptHosts,
  isAllowedAddress,
  resolve,
}: GuardOptions) {
  return (hostname: string, options: any, callback: LookupCallback) => {
    const opts = typeof options === 'object' && options ? options : {};
    resolve(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) {
        callback(err);
        return;
      }
      if (!exemptHosts.has(normalizeHost(hostname))) {
        const blocked = addresses.find((a) => !isAllowedAddress(a.address));
        if (blocked) {
          callback(
            new BlockedOutboundAddressError(
              `Blocked outbound connection: ${hostname} resolves to non-public address ${blocked.address}`
            )
          );
          return;
        }
      }
      const [first] = addresses;
      if (!first) {
        const notFound: NodeJS.ErrnoException = new Error(
          `getaddrinfo ENOTFOUND ${hostname}`
        );
        notFound.code = 'ENOTFOUND';
        callback(notFound);
        return;
      }
      if (opts.all) {
        callback(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
}

export function createGuardedConnector(options: GuardOptions) {
  const base = buildConnector({ lookup: createGuardedLookup(options) as any });
  const connector: buildConnector.connector = (opts, callback) => {
    const host = normalizeHost(opts.hostname);
    if (
      isIP(host) &&
      !options.exemptHosts.has(host) &&
      !options.isAllowedAddress(host)
    ) {
      callback(
        new BlockedOutboundAddressError(
          `Blocked outbound connection to non-public address ${host}`
        ),
        null
      );
      return;
    }
    return base(opts, callback);
  };
  return connector;
}

export function createGuardedAgent({
  exemptHosts,
}: {
  exemptHosts: ReadonlySet<string>;
}) {
  return new Agent({
    connect: createGuardedConnector({
      exemptHosts,
      isAllowedAddress: isPublicAddress,
      resolve: dns.lookup as unknown as LookupAllFn,
    }),
  });
}
