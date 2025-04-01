import {
  PluginContext,
  PluginHandler,
  PluginParameters,
  HookEventType,
} from '../types';
import { createProtectionManager } from './createProtectionManager';

const protectionManager = createProtectionManager({
  desiredProtectionDurationInMins: 15,
  maintainProtectionPercentage: 10,
  refreshProtectionPercentage: 80,
  protectionAdjustIntervalInMs: 10 * 1000,
});

process.on('SIGTERM', () => {
  protectionManager.close();
});
process.on('SIGINT', () => {
  protectionManager.close();
});

export const handler: PluginHandler = async (
  _context: PluginContext,
  _parameters: PluginParameters,
  eventType: HookEventType
) => {
  let error = null;
  let verdict = false;
  let data = null;

  try {
    if (eventType === 'beforeRequestHook') {
      await protectionManager.acquireProtection();
      data = { message: 'Protection acquired' };
    } else if (eventType === 'afterRequestHook') {
      await protectionManager.releaseProtection();
      data = { message: 'Protection released' };
    }
    verdict = true;
  } catch (e: any) {
    delete e.stack;
    error = e;
  }

  return { error, verdict, data };
};
