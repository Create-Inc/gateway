import { OPENROUTER } from '../../globals';
import { MessagesResponse } from '../../types/messagesResponse';
import { getMessagesConfig } from '../anthropic-base/messages';
import { AnthropicErrorResponse } from '../anthropic/types';
import { AnthropicErrorResponseTransform } from '../anthropic/utils';
import { ErrorResponse, ProviderConfig } from '../types';
import { generateInvalidProviderResponseError } from '../utils';

const openrouterMessagesExtra: ProviderConfig = {
  provider: { param: 'provider' },
  output_config: { param: 'output_config' },
  models: { param: 'models' },
  fallbacks: { param: 'fallbacks' },
  cache_control: { param: 'cache_control' },
  context_management: { param: 'context_management' },
  plugins: { param: 'plugins' },
  safeguards: { param: 'safeguards' },
  session_id: { param: 'session_id' },
  speed: { param: 'speed' },
  stop_server_tools_when: { param: 'stop_server_tools_when' },
};

export const OpenrouterMessagesConfig = getMessagesConfig({
  exclude: ['container', 'mcp_servers'],
  extra: openrouterMessagesExtra,
});

export const OpenrouterMessagesResponseTransform = (
  response: MessagesResponse | AnthropicErrorResponse | unknown,
  responseStatus: number
): MessagesResponse | ErrorResponse => {
  if (!response || typeof response !== 'object') {
    return generateInvalidProviderResponseError(
      response as Record<string, any>,
      OPENROUTER
    );
  }

  if (responseStatus !== 200) {
    if (
      'error' in response &&
      response.error &&
      typeof response.error === 'object' &&
      'message' in response.error &&
      typeof response.error.message === 'string'
    ) {
      return AnthropicErrorResponseTransform(
        response as AnthropicErrorResponse,
        OPENROUTER
      );
    }
    return generateInvalidProviderResponseError(
      response as Record<string, any>,
      OPENROUTER
    );
  }

  if (
    'type' in response &&
    response.type === 'message' &&
    'role' in response &&
    response.role === 'assistant' &&
    'id' in response &&
    typeof response.id === 'string' &&
    'model' in response &&
    typeof response.model === 'string' &&
    'content' in response &&
    Array.isArray(response.content) &&
    'usage' in response &&
    response.usage &&
    typeof response.usage === 'object'
  ) {
    return response as MessagesResponse;
  }

  return generateInvalidProviderResponseError(
    response as Record<string, any>,
    OPENROUTER
  );
};
