import type {
  AnthropicChatCompleteResponse,
  AnthropicChatCompleteStreamResponse,
} from '../anthropic/chatComplete';

export const transformAnthropicUsageMetadata = (
  usageMetadata:
    | AnthropicChatCompleteResponse['usage']
    | NonNullable<AnthropicChatCompleteStreamResponse['usage']>
) => {
  const {
    input_tokens = 0,
    output_tokens = 0,
    cache_creation_input_tokens = 0,
    cache_read_input_tokens = 0,
  } = usageMetadata;

  const shouldSendCacheUsage =
    cache_creation_input_tokens || cache_read_input_tokens;

  return {
    prompt_tokens:
      input_tokens + cache_creation_input_tokens + cache_read_input_tokens,
    completion_tokens: output_tokens,
    total_tokens:
      input_tokens +
      output_tokens +
      cache_creation_input_tokens +
      cache_read_input_tokens,
    ...(shouldSendCacheUsage && {
      prompt_tokens_details: {
        cached_tokens: cache_read_input_tokens,
      },
    }),
    ...(shouldSendCacheUsage && {
      cache_read_input_tokens: cache_read_input_tokens,
      cache_creation_input_tokens: cache_creation_input_tokens,
    }),
  };
};
