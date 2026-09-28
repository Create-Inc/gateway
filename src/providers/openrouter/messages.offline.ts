import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import OpenrouterConfig from './index';
import { transformToProviderRequest } from '../../services/transformToProviderRequest';
import {
  handleNonStreamingMode,
  handleStreamingMode,
} from '../../handlers/streamHandler';
import { Params } from '../../types/requestBody';
import { Options } from '../../types/requestBody';

const options = { provider: 'openrouter', apiKey: 'test-key' } as Options;
const api = OpenrouterConfig.api;
const messages = [
  { role: 'user', content: 'Run a tool' },
  {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tool_1', name: 'lookup', input: { query: 'x' } },
    ],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'found' }],
  },
];
const request = {
  model: 'anthropic/claude-sonnet-4',
  messages,
  max_tokens: 256,
  stream: true,
  system: [
    { type: 'text', text: 'Be brief', cache_control: { type: 'ephemeral' } },
  ],
  thinking: { type: 'enabled', budget_tokens: 128 },
  output_config: { effort: 'medium' },
  tools: [
    {
      name: 'lookup',
      description: 'Look up',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  tool_choice: { type: 'auto' },
  provider: { data_collection: 'deny', zdr: true, allow_fallbacks: false },
} as unknown as Params;

const encodeRequest = (params: Params) =>
  JSON.parse(
    JSON.stringify(
      transformToProviderRequest(
        'openrouter',
        params,
        params,
        'messages',
        {},
        options
      )
    )
  );

const response = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'anthropic/claude-sonnet-4',
  content: [
    { type: 'thinking', thinking: 'reason', signature: 'signature' },
    {
      type: 'tool_use',
      id: 'tool_2',
      name: 'lookup',
      input: { query: 'next' },
    },
  ],
  stop_reason: 'tool_use',
  stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 10 },
};

describe('OpenRouter native Messages', () => {
  it('emits the documented Messages URL and bearer auth, not chat completions', () => {
    assert.equal(
      `${api.getBaseURL({ providerOptions: options } as any)}${api.getEndpoint({ fn: 'messages' } as any)}`,
      'https://openrouter.ai/api/v1/messages'
    );
    assert.equal(
      (
        api.headers({ providerOptions: options } as any) as Record<
          string,
          string
        >
      ).Authorization,
      'Bearer test-key'
    );
  });

  it('emits Anthropic tool calls, tool replay, thinking and privacy preferences unchanged', () => {
    assert.deepEqual(encodeRequest(request), request);
    assert.equal(encodeRequest({ ...request, stream: false }).stream, false);
  });

  it('does not forward unsupported Anthropic-only request fields', () => {
    const output = encodeRequest({
      ...request,
      container: { id: 'container_1' },
      mcp_servers: [],
    } as Params);
    assert.equal(output.container, undefined);
    assert.equal(output.mcp_servers, undefined);
  });

  it('preserves a native tool/thinking response and rejects a malformed success', async () => {
    const transformer = OpenrouterConfig.responseTransforms.messages;
    const valid = await handleNonStreamingMode(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      transformer,
      false,
      '/v1/messages',
      request,
      false
    );
    assert.deepEqual(valid.json, response);
    assert.equal(transformer({ model: 'only-a-model' }, 200).error.type, null);
  });

  it('maps native rate-limit errors without losing the error type', async () => {
    const error = {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
      request_id: 'gen_1',
    };
    const result = await handleNonStreamingMode(
      new Response(JSON.stringify(error), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
      OpenrouterConfig.responseTransforms.messages,
      false,
      '/v1/messages',
      request,
      false
    );
    assert.equal(result.response.status, 429);
    assert.equal(result.json?.provider, 'openrouter');
    assert.deepEqual(result.json?.error, {
      type: 'rate_limit_error',
      message: 'openrouter error: Rate limit exceeded',
      param: null,
      code: null,
    });
    assert.equal(
      OpenrouterConfig.responseTransforms.messages({ error: 'bad' }, 429).error
        .type,
      null
    );
    const overloaded = OpenrouterConfig.responseTransforms.messages(
      {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Provider overloaded' },
      },
      503
    );
    assert.equal(overloaded.error.type, 'overloaded_error');
    assert.equal(
      overloaded.error.message,
      'openrouter error: Provider overloaded'
    );
  });

  it('forwards native SSE event frames, including thinking and tool input deltas', async () => {
    const frames = [
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: { ...response, content: [], stop_reason: null },
        },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'reason' },
        },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'tool_2',
            name: 'lookup',
            input: {},
          },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"query":"next"}' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'signed' },
        },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 10 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ];
    const payload = frames
      .map(
        ({ event, data }) =>
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      )
      .join('');
    const source = new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(payload);
        controller.enqueue(bytes.slice(0, 37));
        controller.enqueue(bytes.slice(37));
        controller.close();
      },
    });
    const streamed = handleStreamingMode(
      new Response(source, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
      'openrouter',
      undefined,
      'https://openrouter.ai/api/v1/messages',
      false,
      request,
      'messages',
      { beforeRequestHooksResult: [], afterRequestHooksResult: [] } as any
    );
    assert.equal(streamed.headers.get('content-type'), 'text/event-stream');
    assert.equal(await streamed.text(), payload);
  });
});
