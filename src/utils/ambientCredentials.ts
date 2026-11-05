/**
 * "Ambient" credentials are ones the gateway itself holds: the AWS keys/role
 * used for Bedrock `assumedRole` auth (AWS_ASSUME_ROLE_*), Azure managed
 * identity (instance metadata) and Azure workload identity (federated token
 * file). Any caller that can reach the gateway could otherwise make it mint
 * and use those credentials, so they are off unless the operator sets
 * ENABLE_GATEWAY_AMBIENT_CREDENTIALS=true.
 */
export const AMBIENT_CREDENTIALS_FLAG = 'ENABLE_GATEWAY_AMBIENT_CREDENTIALS';

export class AmbientCredentialsDisabledError extends Error {
  constructor(mode: string) {
    super(
      `${mode} uses the gateway's own credentials and is disabled (set ${AMBIENT_CREDENTIALS_FLAG}=true to allow it)`
    );
    this.name = 'AmbientCredentialsDisabledError';
  }
}

export function isAmbientCredentialsEnabled(
  env: Record<string, unknown> | undefined | null
): boolean {
  const fromEnv = env?.[AMBIENT_CREDENTIALS_FLAG];
  const fromProcess =
    typeof process !== 'undefined'
      ? process.env?.[AMBIENT_CREDENTIALS_FLAG]
      : undefined;
  return String(fromEnv ?? fromProcess ?? '').toLowerCase() === 'true';
}

export function assertAmbientCredentialsEnabled(
  env: Record<string, unknown> | undefined | null,
  mode: string
) {
  if (!isAmbientCredentialsEnabled(env)) {
    throw new AmbientCredentialsDisabledError(mode);
  }
}
