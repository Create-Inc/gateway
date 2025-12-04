import urljoin from 'url-join';
import { ANTHROPIC_STOP_REASON } from './anthropic/types';
import { FINISH_REASON, ErrorResponse, PROVIDER_FINISH_REASON } from './types';
import {
  AnthropicFinishReasonMap,
  finishReasonMap,
} from './utils/finishReasonMap';
import { ContentType, Message } from '../types/requestBody';
import { BEDROCK, GOOGLE_VERTEX_AI } from '../globals';
import { getModelAndProvider } from './google-vertex-ai/utils';

export const generateInvalidProviderResponseError: (
  response: Record<string, any>,
  provider: string
) => ErrorResponse = (response, provider) => {
  return {
    error: {
      message: `Invalid response received from ${provider}: ${JSON.stringify(
        response
      )}`,
      type: null,
      param: null,
      code: null,
    },
    provider: provider,
  } as ErrorResponse;
};

export const generateErrorResponse: (
  errorDetails: {
    message: string;
    type: string | null;
    param: string | null;
    code: string | null;
  },
  provider: string
) => ErrorResponse = ({ message, type, param, code }, provider) => {
  return {
    error: {
      message: `${provider} error: ${message}`,
      type: type ?? null,
      param: param ?? null,
      code: code ?? null,
    },
    provider: provider,
  } as ErrorResponse;
};

type SplitResult = {
  before: string;
  after: string;
};

export function splitString(input: string, separator: string): SplitResult {
  const sepIndex = input.indexOf(separator);

  if (sepIndex === -1) {
    return {
      before: input,
      after: '',
    };
  }

  return {
    before: input.substring(0, sepIndex),
    after: input.substring(sepIndex + 1),
  };
}

/*
  Transforms the finish reason from the provider to the finish reason used by the OpenAI API.
  If the finish reason is not found in the map, it will return the stop reason.
  If the strictOpenAiCompliance is true, it will return the finish reason from the map.
  If the strictOpenAiCompliance is false, it will return the finish reason from the provider.
  NOTE: this function always returns a finish reason
*/
export const transformFinishReason = (
  finishReason?: PROVIDER_FINISH_REASON,
  strictOpenAiCompliance?: boolean
): FINISH_REASON | PROVIDER_FINISH_REASON => {
  if (!finishReason) return FINISH_REASON.stop;
  if (!strictOpenAiCompliance) return finishReason;
  const transformedFinishReason = finishReasonMap.get(finishReason);
  if (!transformedFinishReason) {
    return FINISH_REASON.stop;
  }
  return transformedFinishReason;
};

/*
  Transforms the finish reason from the provider to the finish reason used by the Anthropic API.
  If the finish reason is not found in the map, it will return the stop reason.
  NOTE: this function always returns a finish reason
*/
export const transformToAnthropicStopReason = (
  finishReason?: PROVIDER_FINISH_REASON
): ANTHROPIC_STOP_REASON => {
  if (!finishReason) return ANTHROPIC_STOP_REASON.end_turn;
  const transformedFinishReason = AnthropicFinishReasonMap.get(finishReason);
  if (!transformedFinishReason) {
    return ANTHROPIC_STOP_REASON.end_turn;
  }
  return transformedFinishReason;
};

export function getFakeId() {
  // Some providers have a max length for the id, so we need to limit it
  return ('portkey-' + crypto.randomUUID()).slice(0, 40);
}

const imageURLToBase64 = async (url: string) => {
  const urlWithTransformation = url.startsWith('https://ucarecdn.com/')
    ? urljoin(url, '-/preview/')
    : url;

  try {
    const response = await fetch(urlWithTransformation, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch image. Status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type')?.split(';')[0];
    const base64String = buffer.toString('base64');
    const prefix = `data:${contentType};base64,`;
    return {
      prefix,
      base64String,
    };
  } catch (error) {
    console.error('Error trying to encode image url', error);
  }
};

export async function prefetchImageUrls(
  messages: Message[]
): Promise<Message[]> {
  for (const msg of messages) {
    const content: ContentType[] =
      msg.content_blocks ?? (Array.isArray(msg.content) ? msg.content : []);
    for (const item of content) {
      if (item.type === 'image_url' && item.image_url?.url) {
        const data = await imageURLToBase64(item.image_url.url);
        if (data) {
          const { prefix, base64String } = data;
          item.image_url.url = `${prefix}${base64String}`;
        }
      }
    }
  }
  return messages;
}

export function shouldPrefetchImageUrls({
  messages,
  model,
  provider,
}: {
  messages?: Message[];
  model?: string;
  provider: string;
}) {
  if (!messages || messages.length === 0 || !model) {
    return false;
  }
  switch (provider) {
    case GOOGLE_VERTEX_AI:
      return getModelAndProvider(model).provider === 'anthropic';
    case BEDROCK:
      return true;
    default:
      return false;
  }
}
