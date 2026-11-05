import { Context } from 'hono';
import { constructConfigFromRequestHeaders } from './handlerUtils';
import WebSocket from 'ws';
import { ProviderAPIConfig } from '../providers/types';
import Providers from '../providers';
import { Options } from '../types/requestBody';
import { RealtimeLlmEventParser } from '../services/realtimeLlmEventParser';
import { WSContext, WSEvents } from 'hono/ws';
import { findOutboundTargetViolation } from '../utils/outboundTarget';
import { guardedSocketOptions } from '../utils/outboundGuard';
import { getTrustedCustomHosts } from '../middlewares/requestValidator';

export async function realTimeHandlerNode(
  c: Context
): Promise<WSEvents<unknown>> {
  try {
    let incomingWebsocket: WSContext<unknown> | null = null;
    const requestHeaders = Object.fromEntries(c.req.raw.headers);
    const camelCaseConfig = constructConfigFromRequestHeaders(requestHeaders);

    const provider = camelCaseConfig?.provider ?? '';
    const apiConfig: ProviderAPIConfig = Providers[provider].api;
    const providerOptions = camelCaseConfig as Options;
    const violation = findOutboundTargetViolation({
      customHost: providerOptions.customHost,
      providerOptions,
      c,
    });
    if (violation) {
      throw new Error(violation);
    }
    const baseUrl = apiConfig.getBaseURL({
      providerOptions,
      c,
      gatewayRequestURL: c.req.url,
    });
    const endpoint = apiConfig.getEndpoint({
      c,
      providerOptions,
      fn: 'realtime',
      gatewayRequestBodyJSON: {},
      gatewayRequestURL: c.req.url,
    });
    let url = `${baseUrl}${endpoint}`;
    url = url.replace('https://', 'wss://');
    const headers = await apiConfig.headers({
      c,
      providerOptions,
      fn: 'realtime',
      transformedRequestUrl: url,
      transformedRequestBody: {},
    });

    const sessionOptions = {
      id: crypto.randomUUID(),
      providerOptions: {
        ...providerOptions,
        requestURL: url,
        rubeusURL: 'realtime',
      },
      requestHeaders,
      requestParams: {},
    };

    // `ws` opens its own socket (not fetch), so apply the egress guard here:
    // non-public IP literals are rejected up front, DNS answers are checked
    // in the connection's lookup, and redirects are not followed.
    const outgoingWebSocket = new WebSocket(url, {
      headers,
      ...guardedSocketOptions(url, { exemptHosts: getTrustedCustomHosts(c) }),
    });
    const eventParser = new RealtimeLlmEventParser();

    outgoingWebSocket.addEventListener('message', (event) => {
      incomingWebsocket?.send(event.data as string);
      try {
        const parsedData = JSON.parse(event.data as string);
        eventParser.handleEvent(c, parsedData, sessionOptions);
      } catch (err: any) {
        console.error(`eventParser.handleEvent error: ${err.message}`);
      }
    });

    outgoingWebSocket.addEventListener('close', (event) => {
      incomingWebsocket?.close(event.code, event.reason);
    });

    outgoingWebSocket.addEventListener('error', (event) => {
      console.error(`outgoingWebSocket error: ${event.message}`);
      incomingWebsocket?.close();
    });

    // wait for the upstream websocket to be open
    const checkWebSocketOpen = new Promise((resolve, reject) => {
      outgoingWebSocket.addEventListener('open', () => {
        resolve(true);
      });
      // Without this a refused upstream (e.g. a blocked address) would leave
      // the upgrade hanging forever.
      outgoingWebSocket.addEventListener('error', (event) => {
        reject(new Error(event.message));
      });
    });

    await checkWebSocketOpen;

    return {
      onOpen(evt, ws) {
        incomingWebsocket = ws;
      },
      onMessage(event) {
        outgoingWebSocket?.send(event.data as string);
      },
      onError(evt) {
        console.error(`incomingWebsocket error: ${evt.type}`);
        outgoingWebSocket?.close();
      },
      onClose() {
        outgoingWebSocket?.close();
      },
    };
  } catch (err) {
    c.set('websocketError', true);
    return {
      onOpen() {},
      onMessage() {},
      onError() {},
      onClose() {},
    };
  }
}
