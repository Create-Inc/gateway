// requestContext.ts

import { Context } from 'hono';
import {
  CacheSettings,
  Options,
  Params,
  RetrySettings,
} from '../../types/requestBody';
import { endpointStrings } from '../../providers/types';
import { HEADER_KEYS, RETRY_STATUS_CODES } from '../../globals';
import { HookObject } from '../../middlewares/hooks/types';
import { HooksManager } from '../../middlewares/hooks';
import { transformToProviderRequest } from '../../services/transformToProviderRequest';

export class RequestContext {
  private _params: Params | null = null;
  private _transformedRequestBody: any;
  public readonly providerOption: Options;
  private _requestURL: string = ''; // Is set at the beginning of tryPost()

  constructor(
    public readonly honoContext: Context,
    providerOption: Options,
    public readonly endpoint: endpointStrings,
    public readonly requestHeaders: Record<string, string>,
    public readonly requestBody:
      | Params
      | FormData
      | ReadableStream
      | ArrayBuffer,
    public readonly method: string = 'POST',
    public readonly index: number | string
  ) {
    this.providerOption = providerOption;
    this.providerOption.retry = this.normalizeRetryConfig(providerOption.retry);
  }

  get requestURL(): string {
    return this._requestURL;
  }

  set requestURL(requestURL: string) {
    this._requestURL = requestURL;
  }

  get overrideParams(): Params {
    return this.providerOption?.overrideParams ?? {};
  }

  get params(): Params {
    if (this._params !== null) {
      return this._params;
    }
    if (
      this.requestBody instanceof ReadableStream ||
      this.requestBody instanceof FormData ||
      !this.requestBody
    ) {
      return {};
    }
    // Merge override_params over the request body. A null override value is a
    // DELETE: the key is removed from the merged params entirely, rather than
    // forwarded as a literal null (which providers reject — e.g. Anthropic's
    // `thinking: Input should be an object`). Callers that hold an opaque,
    // unparsed request body need deletion to normalize legacy keys away
    // (strip `thinking` when `output_config.effort` replaces it) without
    // rewriting the body itself.
    const merged: Params = { ...this.requestBody, ...this.overrideParams };
    for (const [key, value] of Object.entries(this.overrideParams)) {
      if (value === null) {
        delete merged[key as keyof Params];
      }
    }
    return merged;
  }

  set params(params: Params) {
    this._params = params;
  }

  set transformedRequestBody(transformedRequestBody: any) {
    this._transformedRequestBody = transformedRequestBody;
  }

  get transformedRequestBody(): any {
    return this._transformedRequestBody;
  }

  getHeader(key: string): string {
    if (key == HEADER_KEYS.CONTENT_TYPE) {
      return (
        this.requestHeaders[HEADER_KEYS.CONTENT_TYPE.toLowerCase()]?.split(
          ';'
        )[0] ?? ''
      );
    }
    return this.requestHeaders[key] ?? '';
  }

  get traceId(): string {
    return this.requestHeaders[HEADER_KEYS.TRACE_ID] ?? '';
  }

  get isStreaming(): boolean {
    if (
      (this.endpoint === 'imageEdit' ||
        this.endpoint === 'createTranscription') &&
      this.requestBody instanceof FormData
    )
      return this.requestBody.get('stream') === 'true';
    return this.params.stream === true;
  }

  get strictOpenAiCompliance(): boolean {
    const headerKey = HEADER_KEYS.STRICT_OPEN_AI_COMPLIANCE;
    if (
      this.requestHeaders[headerKey] === 'false' ||
      this.providerOption.strictOpenAiCompliance === false
    ) {
      return false;
    }
    return true;
  }

  get metadata(): Record<string, string> {
    try {
      return JSON.parse(this.requestHeaders[HEADER_KEYS.METADATA] ?? '{}');
    } catch (error) {
      return {};
    }
  }

  get forwardHeaders(): string[] {
    const headerKey = HEADER_KEYS.FORWARD_HEADERS;
    return (
      this.requestHeaders[headerKey]?.split(',').map((h) => h.trim()) ||
      this.providerOption.forwardHeaders ||
      []
    );
  }

  get customHost(): string {
    return (
      this.requestHeaders[HEADER_KEYS.CUSTOM_HOST] ||
      this.providerOption.customHost ||
      ''
    );
  }

  get requestTimeout(): number | null {
    const headerKey = HEADER_KEYS.REQUEST_TIMEOUT;
    return (
      Number(this.requestHeaders[headerKey]) ||
      this.providerOption.requestTimeout ||
      null
    );
  }

  get provider(): string {
    return this.providerOption?.provider ?? '';
  }

  private normalizeRetryConfig(retry?: RetrySettings): RetrySettings {
    return {
      attempts: retry?.attempts ?? 0,
      onStatusCodes: retry?.attempts
        ? retry?.onStatusCodes ?? RETRY_STATUS_CODES
        : [],
      useRetryAfterHeader: retry?.useRetryAfterHeader,
    };
  }

  get retryConfig(): RetrySettings {
    return this.providerOption.retry!;
  }

  get cacheConfig(): CacheSettings & { cacheStatus: string } {
    const cacheConfig = this.providerOption?.cache;
    let cacheStatus = 'DISABLED';
    if (typeof cacheConfig === 'object' && cacheConfig?.mode) {
      cacheStatus = cacheConfig.mode === 'DISABLED' ? 'DISABLED' : 'MISS';
      return {
        mode: cacheConfig.mode,
        maxAge: cacheConfig.maxAge
          ? parseInt(cacheConfig.maxAge.toString())
          : undefined,
        cacheStatus,
      };
    } else if (typeof cacheConfig === 'string') {
      return {
        mode: cacheConfig,
        maxAge: undefined,
        cacheStatus: cacheConfig === 'DISABLED' ? 'DISABLED' : 'MISS',
      };
    }
    return { mode: 'DISABLED', maxAge: undefined, cacheStatus };
  }

  hasRetries(): boolean {
    return this.retryConfig?.attempts > 0;
  }

  get beforeRequestHooks(): HookObject[] {
    return [
      ...(this.providerOption?.beforeRequestHooks || []),
      ...(this.providerOption?.defaultInputGuardrails || []),
    ];
  }

  get afterRequestHooks(): HookObject[] {
    return [
      ...(this.providerOption?.afterRequestHooks || []),
      ...(this.providerOption?.defaultOutputGuardrails || []),
    ];
  }

  get hooksManager(): HooksManager {
    return this.honoContext.get('hooksManager');
  }

  /**
   * Transforms the request body to the provider request body and
   * sets the transformed request body to the request context.
   * @returns The transformed request body.
   */
  transformToProviderRequestAndSave() {
    if (this.method !== 'POST') {
      this.transformedRequestBody = this.requestBody;
      return;
    }
    this.transformedRequestBody = transformToProviderRequest(
      this.provider,
      this.params,
      this.requestBody,
      this.endpoint,
      this.requestHeaders,
      this.providerOption
    );
    this.logImageContentParts();
  }

  private logImageContentParts() {
    const body = this.transformedRequestBody;
    if (!body || typeof body !== 'object' || !('messages' in body)) {
      return;
    }
    const messages = (body as Record<string, unknown>).messages;
    if (!Array.isArray(messages)) {
      return;
    }
    const imageSummary: Array<{
      messageIndex: number;
      role: string;
      type: string;
      sourceType?: string;
      mediaType?: string;
      dataLength?: number;
    }> = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg?.content || !Array.isArray(msg.content)) {
        continue;
      }
      for (const part of msg.content) {
        if (part?.type === 'image' && part?.source) {
          imageSummary.push({
            messageIndex: i,
            role: msg.role,
            type: part.type,
            sourceType: part.source.type,
            mediaType: part.source.media_type,
            dataLength:
              part.source.type === 'base64'
                ? part.source.data?.length
                : undefined,
          });
        } else if (part?.type === 'image_url' && part?.image_url) {
          const url = part.image_url.url ?? '';
          imageSummary.push({
            messageIndex: i,
            role: msg.role,
            type: part.type,
            sourceType: url.startsWith('data:') ? 'base64-datauri' : 'url',
            dataLength: url.length,
          });
        }
      }
    }
    if (imageSummary.length > 0) {
      console.log(
        JSON.stringify({
          msg: 'Image content parts in transformed request',
          provider: this.provider,
          endpoint: this.endpoint,
          imageCount: imageSummary.length,
          images: imageSummary,
        })
      );
    }
  }

  get requestOptions(): any[] {
    return this.honoContext.get('requestOptions') ?? [];
  }

  appendRequestOptions(requestOptions: any) {
    this.honoContext.set('requestOptions', [
      ...this.requestOptions,
      requestOptions,
    ]);
  }

  updateModelPricingConfig(modelPricingConfig: Record<string, any>) {
    this.providerOption.modelPricingConfig = modelPricingConfig;
  }
}
