import {
  isCustomHostAllowed,
  parseAllowedCustomHosts,
} from './customHostAllowlist';

describe('parseAllowedCustomHosts', () => {
  test('unset or empty allows nothing', () => {
    expect(parseAllowedCustomHosts(undefined).size).toBe(0);
    expect(parseAllowedCustomHosts('').size).toBe(0);
    expect(parseAllowedCustomHosts(' , ').size).toBe(0);
  });

  test('normalizes origins and bare hostnames', () => {
    expect([
      ...parseAllowedCustomHosts(
        ' https://API.Fireworks.ai/inference/v1 , openrouter.ai,http://localhost:8080 '
      ),
    ]).toEqual([
      'https://api.fireworks.ai',
      'https://openrouter.ai',
      'http://localhost:8080',
    ]);
  });

  test('accepts one origin per line with comments (file form)', () => {
    expect([
      ...parseAllowedCustomHosts(
        '# Fireworks\nhttps://api.fireworks.ai/inference/v1  # trailing\n\n  https://openrouter.ai\n'
      ),
    ]).toEqual(['https://api.fireworks.ai', 'https://openrouter.ai']);
  });

  test('drops invalid entries', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect([
      ...parseAllowedCustomHosts(
        'file:///etc/passwd,https://user:pw@x.example,/app/missing-file.txt,https://ok.example'
      ),
    ]).toEqual(['https://ok.example']);
    warn.mockRestore();
  });
});

describe('isCustomHostAllowed', () => {
  const allowed = parseAllowedCustomHosts(
    'https://api.fireworks.ai,https://api.moonshot.ai,https://openrouter.ai'
  );

  test.each([
    'https://api.fireworks.ai/inference/v1',
    'https://api.moonshot.ai',
    'https://openrouter.ai/api/v1',
    'https://API.FIREWORKS.AI:443/inference/v1',
  ])('allows %s', (host) => {
    expect(isCustomHostAllowed(host, allowed)).toBe(true);
  });

  test.each([
    // Prefix / suffix tricks that a string comparison would accept.
    'https://api.fireworks.ai.attacker.example/v1',
    'https://api.fireworks.ai@attacker.example/v1',
    'https://attacker.example/api.fireworks.ai',
    'https://evil-api.fireworks.ai/v1',
    // Scheme or port drift.
    'http://api.fireworks.ai/inference/v1',
    'https://api.fireworks.ai:8443/inference/v1',
    // Internal targets.
    'http://127.0.0.1:8787',
    'http://localhost',
    'http://169.254.170.2/v2/credentials',
    'not a url',
    '',
  ])('rejects %s', (host) => {
    expect(isCustomHostAllowed(host, allowed)).toBe(false);
  });

  test('rejects everything when the allowlist is empty', () => {
    expect(
      isCustomHostAllowed(
        'https://api.fireworks.ai/inference/v1',
        parseAllowedCustomHosts(undefined)
      )
    ).toBe(false);
  });
});
