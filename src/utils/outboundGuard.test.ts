import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent } from 'undici';
import {
  createGuardedAgent,
  createGuardedConnector,
  isPublicAddress,
} from './outboundGuard';

describe('isPublicAddress', () => {
  test.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'accepts public %s',
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    }
  );

  test.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '169.254.169.254', // IMDS
    '169.254.170.2', // ECS agent / task credentials
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00:ec2::254',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.170.2',
    '224.0.0.1',
    'not-an-ip',
  ])('rejects %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('guarded agent', () => {
  let server: http.Server;
  let port: number;
  let redirectTo = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: redirectTo });
        res.end();
        return;
      }
      res.end('ok');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const fetchVia = (dispatcher: Agent, url: string) =>
    fetch(url, { dispatcher } as RequestInit);

  test('blocks loopback IP literals', async () => {
    const agent = createGuardedAgent({ exemptHosts: new Set() });
    const err = await fetchVia(agent, `http://127.0.0.1:${port}/`).catch(
      (e) => e
    );
    expect(err.message).toBe('fetch failed');
    expect(String(err.cause?.message)).toMatch(/non-public address/);
    await agent.close();
  });

  test('blocks hostnames that resolve to loopback', async () => {
    const agent = createGuardedAgent({ exemptHosts: new Set() });
    const err = await fetchVia(agent, `http://localhost:${port}/`).catch(
      (e) => e
    );
    expect(String(err.cause?.message)).toMatch(/non-public address/);
    await agent.close();
  });

  test('blocks a public-looking name whose DNS answer is private (rebinding)', async () => {
    // Simulates attacker DNS: the name looks external but answers 127.0.0.1.
    const agent = new Agent({
      connect: createGuardedConnector({
        exemptHosts: new Set(),
        isAllowedAddress: isPublicAddress,
        resolve: (_hostname, _options, callback) =>
          callback(null, [
            { address: '93.184.215.14', family: 4 },
            { address: '127.0.0.1', family: 4 },
          ]),
      }),
    });
    const err = await fetchVia(
      agent,
      `http://rebind.attacker.example:${port}/`
    ).catch((e) => e);
    expect(String(err.cause?.message)).toMatch(/non-public address/);
    await agent.close();
  });

  test('blocks a redirect hop into a private address', async () => {
    // `public.example` stands in for an allowed public host (exempted so the
    // first hop can reach the local test server); the redirect it returns
    // points at loopback and must be refused.
    const exemptAgent = new Agent({
      connect: createGuardedConnector({
        exemptHosts: new Set(['public.example']),
        isAllowedAddress: isPublicAddress,
        resolve: (_hostname, _options, callback) =>
          callback(null, [{ address: '127.0.0.1', family: 4 }]),
      }),
    });
    redirectTo = `http://127.0.0.1:${port}/`;
    const err = await fetchVia(
      exemptAgent,
      `http://public.example:${port}/redirect`
    ).catch((e) => e);
    expect(String(err.cause?.message)).toMatch(
      /connection to non-public address 127\.0\.0\.1/
    );
    await exemptAgent.close();
  });

  test('allows exempt (TRUSTED_CUSTOM_HOSTS) hosts', async () => {
    const agent = createGuardedAgent({ exemptHosts: new Set(['localhost']) });
    const res = await fetchVia(agent, `http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    await agent.close();
  });
});
