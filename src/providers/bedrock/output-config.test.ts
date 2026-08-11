import { getMessagesConfig } from '../anthropic-base/messages';

// bedrock/utils transitively imports src/utils/env.ts, whose top-level await
// the jest ts-config cannot parse; the transform under test never touches it.
jest.mock('../../utils/env', () => ({ getEnv: () => undefined }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { transformAnthropicAdditionalModelRequestFields } =
  require('./utils') as typeof import('./utils');

describe('output_config forwarding (ANY-5194 fork patch)', () => {
  test('anthropic-base messages config maps output_config verbatim', () => {
    const config = getMessagesConfig({});
    expect(config.output_config).toEqual({
      param: 'output_config',
      required: false,
    });
  });

  test('bedrock additional-fields transform carries output_config', () => {
    const fields = transformAnthropicAdditionalModelRequestFields({
      model: 'anthropic.claude-3',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'disabled' },
      output_config: { effort: 'high' },
    } as any);
    expect(fields.output_config).toEqual({ effort: 'high' });
    expect(fields.thinking).toEqual({ type: 'disabled' });
  });

  test('output_config stays absent when the request does not carry one', () => {
    const fields = transformAnthropicAdditionalModelRequestFields({
      model: 'anthropic.claude-3',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    } as any);
    expect(fields.output_config).toBeUndefined();
  });
});
