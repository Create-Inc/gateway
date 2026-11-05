import {
  findProviderOptionsViolation,
  hasUserInfo,
} from './providerOptionsPolicy';

const allowedUrls = new Set(['https://allowed.example/v1']);
const check = (
  options: Record<string, unknown>,
  env: Record<string, unknown> = {}
) =>
  findProviderOptionsViolation({
    options,
    env,
    isAllowedUrl: (url) => allowedUrls.has(url),
  });

describe('findProviderOptionsViolation', () => {
  const savedFlag = process.env.ENABLE_GATEWAY_AMBIENT_CREDENTIALS;
  beforeEach(() => {
    delete process.env.ENABLE_GATEWAY_AMBIENT_CREDENTIALS;
  });
  afterAll(() => {
    if (savedFlag === undefined) {
      delete process.env.ENABLE_GATEWAY_AMBIENT_CREDENTIALS;
    } else {
      process.env.ENABLE_GATEWAY_AMBIENT_CREDENTIALS = savedFlag;
    }
  });

  test('accepts the options our callers send', () => {
    expect(check({ provider: 'bedrock', awsRegion: 'us-east-2' })).toBeNull();
    expect(
      check({ provider: 'vertex-ai', vertexRegion: 'us-east5' })
    ).toBeNull();
    expect(check({ provider: 'vertex-ai', vertexRegion: 'global' })).toBeNull();
    expect(
      check({ provider: 'azure-openai', resourceName: 'my-resource-01' })
    ).toBeNull();
    expect(check({ provider: 'openai' })).toBeNull();
  });

  test.each([
    ['awsRegion', 'x@127.0.0.1:8787/#'],
    ['awsRegion', 'attacker.example/x'],
    ['awsRegion', 'us-east-1.attacker.example'],
    ['vertexRegion', 'evil.example#'],
    ['oracleRegion', 'a?b'],
    ['resourceName', 'evil.example/'],
    ['resourceName', 'a b'],
    ['awsS3Bucket', 'bucket@169.254.169.254'],
    ['snowflakeAccount', 'acct/../x'],
  ])('rejects host-steering %s=%s', (field, value) => {
    expect(check({ [field]: value })).toBe(`Invalid ${field}`);
  });

  test('accepts dotted S3 bucket and Snowflake account hostnames', () => {
    expect(check({ awsS3Bucket: 'my.bucket-1' })).toBeNull();
    expect(check({ snowflakeAccount: 'org-acct.us-east-1' })).toBeNull();
  });

  test('base-URL fields go through the custom-host allowlist', () => {
    expect(check({ azureFoundryUrl: 'https://allowed.example/v1' })).toBeNull();
    expect(check({ azureFoundryUrl: 'http://169.254.169.254/' })).toBe(
      'Invalid azureFoundryUrl'
    );
    expect(check({ huggingfaceBaseUrl: 'https://evil.example' })).toBe(
      'Invalid huggingfaceBaseUrl'
    );
  });

  test('gateway-held credential modes are off by default', () => {
    expect(check({ awsAuthType: 'assumedRole' })).toMatch(/disabled/);
    expect(check({ azureAuthMode: 'managed' })).toMatch(/disabled/);
    expect(check({ azureAuthMode: 'workload' })).toMatch(/disabled/);
    // Caller-supplied credentials are unaffected.
    expect(check({ azureAuthMode: 'entra' })).toBeNull();
    expect(check({ awsAuthType: 'accessKey' })).toBeNull();
  });

  test('gateway-held credential modes can be enabled explicitly', () => {
    const env = { ENABLE_GATEWAY_AMBIENT_CREDENTIALS: 'true' };
    expect(check({ awsAuthType: 'assumedRole' }, env)).toBeNull();
    expect(check({ azureAuthMode: 'managed' }, env)).toBeNull();
  });
});

describe('hasUserInfo', () => {
  test('flags credentials in a built URL', () => {
    expect(hasUserInfo('https://a@127.0.0.1/x')).toBe(true);
    expect(
      hasUserInfo('https://bedrock-runtime.us-east-1.amazonaws.com/x')
    ).toBe(false);
    expect(hasUserInfo('/relative')).toBe(false);
  });
});
