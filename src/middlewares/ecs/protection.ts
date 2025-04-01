import { Context } from 'hono';
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

export const protection = () => {
  return async (_c: Context, next: any) => {
    await protectionManager.acquireProtection();
    await next();
    await protectionManager.releaseProtection();
  };
};
