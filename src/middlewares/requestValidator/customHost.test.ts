// utils/env has a top-level await the jest ts-config cannot parse.
const mockEnv: Record<string, string | undefined> = {};
jest.mock('../../utils/env', () => ({ Environment: () => mockEnv }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requestValidator, isValidCustomHost } =
  require('./index') as typeof import('./index');

const ALLOWED =
  'https://api.fireworks.ai,https://api.moonshot.ai,https://openrouter.ai';

async function validate(headers: Record<string, string>) {
  const c = {
    req: {
      raw: new Request('https://gateway.example/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      }),
    },
  };
  const next = jest.fn(() => 'next');
  const result = await requestValidator(c as any, next);
  if (result === 'next') return { status: 'passed' as const };
  return {
    status: (result as Response).status,
    body: (await (result as Response).json()) as Record<string, unknown>,
  };
}

beforeEach(() => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  mockEnv.ALLOWED_CUSTOM_HOSTS = ALLOWED;
});

describe('isValidCustomHost', () => {
  test('accepts allowlisted origins with any path', () => {
    expect(isValidCustomHost('https://api.fireworks.ai/inference/v1')).toBe(
      true
    );
    expect(isValidCustomHost('https://openrouter.ai/api/v1')).toBe(true);
  });

  test('rejects public hosts that are not allowlisted', () => {
    expect(isValidCustomHost('https://example.com/v1')).toBe(false);
  });

  test('rejects everything when ALLOWED_CUSTOM_HOSTS is unset', () => {
    delete mockEnv.ALLOWED_CUSTOM_HOSTS;
    expect(isValidCustomHost('https://api.fireworks.ai/inference/v1')).toBe(
      false
    );
  });

  test('no longer trusts loopback by default', () => {
    expect(isValidCustomHost('http://localhost:8787')).toBe(false);
    expect(isValidCustomHost('http://127.0.0.1:8787')).toBe(false);
    expect(isValidCustomHost('http://host.docker.internal')).toBe(false);
  });

  test('an allowlisted private host still needs TRUSTED_CUSTOM_HOSTS', () => {
    mockEnv.ALLOWED_CUSTOM_HOSTS = 'http://10.0.0.5:11434';
    expect(isValidCustomHost('http://10.0.0.5:11434')).toBe(false);
    mockEnv.TRUSTED_CUSTOM_HOSTS = '10.0.0.5';
    expect(isValidCustomHost('http://10.0.0.5:11434')).toBe(true);
  });
});

describe('requestValidator custom host enforcement', () => {
  test('rejects a non-allowlisted x-portkey-custom-host header', async () => {
    const result = await validate({
      'x-portkey-provider': 'openai',
      'x-portkey-custom-host': 'http://169.254.170.2/v2/credentials',
    });
    expect(result).toEqual({
      status: 400,
      body: { status: 'failure', message: 'Invalid custom host' },
    });
  });

  test('accepts an allowlisted x-portkey-custom-host header', async () => {
    const result = await validate({
      'x-portkey-provider': 'openai',
      'x-portkey-custom-host': 'https://api.fireworks.ai/inference/v1',
    });
    expect(result).toEqual({ status: 'passed' });
  });

  test('rejects a non-allowlisted custom_host in a nested fallback target', async () => {
    const config = {
      strategy: { mode: 'fallback' },
      targets: [
        {
          provider: 'openai',
          api_key: 'k',
          custom_host: 'https://api.fireworks.ai/inference/v1',
        },
        {
          strategy: { mode: 'loadbalance' },
          targets: [
            {
              provider: 'openai',
              api_key: 'k',
              custom_host: 'https://attacker.example/v1',
            },
          ],
        },
      ],
    };
    const result = await validate({
      'x-portkey-config': JSON.stringify(config),
    });
    expect(result.status).toBe(400);
    expect(result.body?.message).toBe('Invalid config passed');
  });

  test('accepts a config whose targets only use allowlisted hosts', async () => {
    const config = {
      strategy: { mode: 'fallback' },
      targets: [
        {
          provider: 'openai',
          api_key: 'k',
          custom_host: 'https://openrouter.ai/api/v1',
        },
        { provider: 'anthropic', api_key: 'k' },
      ],
    };
    const result = await validate({
      'x-portkey-config': JSON.stringify(config),
    });
    expect(result).toEqual({ status: 'passed' });
  });
});
