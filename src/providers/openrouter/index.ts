import { ProviderConfigs } from '../types';
import OpenrouterAPIConfig from './api';
import {
  OpenrouterChatCompleteConfig,
  OpenrouterChatCompleteResponseTransform,
  OpenrouterChatCompleteStreamChunkTransform,
} from './chatComplete';
import {
  OpenrouterMessagesConfig,
  OpenrouterMessagesResponseTransform,
} from './messages';

const OpenrouterConfig: ProviderConfigs = {
  chatComplete: OpenrouterChatCompleteConfig,
  messages: OpenrouterMessagesConfig,
  api: OpenrouterAPIConfig,
  responseTransforms: {
    chatComplete: OpenrouterChatCompleteResponseTransform,
    messages: OpenrouterMessagesResponseTransform,
    'stream-chatComplete': OpenrouterChatCompleteStreamChunkTransform,
  },
};

export default OpenrouterConfig;
