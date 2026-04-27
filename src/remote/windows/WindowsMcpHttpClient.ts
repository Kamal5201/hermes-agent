import { randomUUID } from 'crypto';
import type {
  WindowsMcpCallOptions,
  WindowsMcpClient,
  WindowsMcpClientInfo,
  WindowsMcpInitializeParams,
  WindowsMcpInitializeResult,
  WindowsMcpToolDescriptor,
} from '../adapters/WindowsMcpAdapter';

export type WindowsMcpErrorCategory =
  | 'transport_timeout'
  | 'http_error'
  | 'session_missing'
  | 'invalid_response'
  | 'tool_call_failed'
  | 'interactive_desktop_blocked'
  | 'transport_error';

export interface WindowsMcpClientOptions {
  baseUrl: string;
  protocolVersion?: string;
  clientInfo?: WindowsMcpClientInfo;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface WindowsMcpRpcErrorShape {
  code?: number;
  message?: string;
  data?: unknown;
}

interface WindowsMcpRpcEnvelope<TResult = unknown> {
  id?: string | number | null;
  jsonrpc?: string;
  result?: TResult;
  error?: WindowsMcpRpcErrorShape;
}

interface WindowsMcpRequestOptions {
  requireSession?: boolean;
  signal?: AbortSignal;
}

interface WindowsMcpParsedResponse<TResult = unknown> {
  sessionId?: string;
  rpc: WindowsMcpRpcEnvelope<TResult>;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 350;
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_CLIENT_INFO: WindowsMcpClientInfo = {
  name: 'hermes-companion',
  version: '1.0.0',
};
const SESSION_HEADER = 'mcp-session-id';

export class WindowsMcpClientError extends Error {
  public readonly category: WindowsMcpErrorCategory;
  public readonly retryable: boolean;
  public readonly cause?: unknown;
  public readonly responseSnippet?: string;
  public readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      category: WindowsMcpErrorCategory;
      retryable?: boolean;
      cause?: unknown;
      responseSnippet?: string;
      statusCode?: number;
    },
  ) {
    super(message);
    this.name = 'WindowsMcpClientError';
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
    this.responseSnippet = options.responseSnippet;
    this.statusCode = options.statusCode;
  }
}

export class WindowsMcpHttpClient implements WindowsMcpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly protocolVersion: string;
  private readonly clientInfo: WindowsMcpClientInfo;
  private sessionId?: string;

  constructor(options: WindowsMcpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
  }

  public getSessionId(): string | undefined {
    return this.sessionId;
  }

  public clearSession(): void {
    this.sessionId = undefined;
  }

  public async initialize(
    params: WindowsMcpInitializeParams = {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: this.clientInfo,
    },
  ): Promise<WindowsMcpInitializeResult> {
    const response = await this.sendRpc<WindowsMcpInitializeResult>(
      'initialize',
      {
        protocolVersion: params.protocolVersion,
        capabilities: params.capabilities ?? {},
        clientInfo: params.clientInfo,
      },
      { requireSession: false },
    );

    const result = response.rpc.result;
    if (!result || typeof result !== 'object') {
      throw new WindowsMcpClientError('Windows MCP initialize returned an invalid payload.', {
        category: 'invalid_response',
        responseSnippet: response.text,
      });
    }

    this.sessionId = response.sessionId ?? result.sessionId ?? this.sessionId;
    return {
      sessionId: this.sessionId,
      protocolVersion: result.protocolVersion,
      serverInfo: result.serverInfo,
    };
  }

  public async listTools(): Promise<WindowsMcpToolDescriptor[]> {
    const response = await this.sendRpc<{ tools?: WindowsMcpToolDescriptor[] }>('tools/list', undefined, { requireSession: true });
    const tools = response.rpc.result?.tools;

    if (!Array.isArray(tools)) {
      throw new WindowsMcpClientError('Windows MCP tools/list returned no tools array.', {
        category: 'invalid_response',
        responseSnippet: response.text,
      });
    }

    return tools
      .filter((tool): tool is WindowsMcpToolDescriptor => Boolean(tool && typeof tool.name === 'string'))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
      }));
  }

  public async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options: WindowsMcpCallOptions = {},
  ): Promise<unknown> {
    const response = await this.sendRpc<unknown>('tools/call', {
      name,
      arguments: args,
    }, {
      requireSession: true,
      signal: options.signal,
    });

    const result = response.rpc.result;
    this.assertToolResult(name, result, response.text);
    return result;
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) {
      return;
    }

    await this.initialize({
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: this.clientInfo,
    });
  }

  private async sendRpc<TResult>(
    method: string,
    params: Record<string, unknown> | undefined,
    options: WindowsMcpRequestOptions,
  ): Promise<WindowsMcpParsedResponse<TResult>> {
    let attempt = 0;
    let lastError: WindowsMcpClientError | undefined;

    while (attempt <= this.maxRetries) {
      try {
        if (options.signal?.aborted) {
          throw createCallerAbortError(options.signal.reason);
        }

        if (options.requireSession) {
          await this.ensureSession();
        }

        if (options.signal?.aborted) {
          throw createCallerAbortError(options.signal.reason);
        }

        const payload = {
          jsonrpc: '2.0',
          id: randomUUID(),
          method,
          params,
        };
        const response = await this.fetchWithTimeout(payload, options.signal);
        const text = await response.text();
        const parsed = parseWindowsMcpResponse<TResult>(text);
        const nextSessionId = response.headers.get(SESSION_HEADER)
          ?? getSessionIdFromUnknown(parsed.rpc.result)
          ?? this.sessionId;
        if (nextSessionId) {
          this.sessionId = nextSessionId;
        }

        if (!response.ok) {
          throw this.createHttpError(method, response.status, text);
        }

        if (parsed.rpc.error) {
          throw this.createRpcError(method, parsed.rpc.error, text);
        }

        return {
          sessionId: nextSessionId,
          rpc: parsed.rpc,
          text,
        };
      } catch (error) {
        const normalizedError = normalizeWindowsMcpClientError(error, method);
        if (normalizedError.category === 'session_missing' && method !== 'initialize') {
          this.clearSession();
        }

        lastError = normalizedError;
        if (!normalizedError.retryable || attempt >= this.maxRetries) {
          break;
        }

        await sleep(this.retryDelayMs * (attempt + 1));
        attempt += 1;
      }
    }

    throw lastError ?? new WindowsMcpClientError(`Windows MCP request failed: ${method}`, {
      category: 'transport_error',
      retryable: true,
    });
  }

  private async fetchWithTimeout(body: Record<string, unknown>, callerSignal?: AbortSignal): Promise<Response> {
    if (callerSignal?.aborted) {
      throw createCallerAbortError(callerSignal.reason);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort(callerSignal?.reason);

    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      return await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...(this.sessionId ? { [SESSION_HEADER]: this.sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (callerSignal?.aborted) {
          throw createCallerAbortError(callerSignal.reason ?? error);
        }

        throw new WindowsMcpClientError(`Windows MCP request timed out after ${this.timeoutMs}ms.`, {
          category: 'transport_timeout',
          retryable: true,
          cause: error,
        });
      }

      throw new WindowsMcpClientError('Windows MCP HTTP request failed before a response was received.', {
        category: 'http_error',
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private createHttpError(method: string, statusCode: number, responseText: string): WindowsMcpClientError {
    const category = isSessionErrorText(responseText) ? 'session_missing' : 'http_error';
    return new WindowsMcpClientError(`Windows MCP ${method} returned HTTP ${statusCode}.`, {
      category,
      retryable: category !== 'session_missing' ? statusCode >= 500 || statusCode === 429 : true,
      responseSnippet: truncateText(responseText),
      statusCode,
    });
  }

  private createRpcError(method: string, error: WindowsMcpRpcErrorShape, responseText: string): WindowsMcpClientError {
    const message = error.message || `Windows MCP ${method} returned an RPC error.`;
    const category = classifyWindowsMcpErrorCategory(message, method);
    return new WindowsMcpClientError(message, {
      category,
      retryable: isRetryableWindowsMcpCategory(category),
      responseSnippet: truncateText(responseText),
    });
  }

  private assertToolResult(toolName: string, result: unknown, responseText: string): void {
    if (!result || typeof result !== 'object') {
      return;
    }

    const maybeResult = result as Record<string, unknown>;
    const outputText = extractWindowsMcpText(maybeResult);
    if (maybeResult.isError === true) {
      throw new WindowsMcpClientError(outputText || `Windows MCP tool ${toolName} reported a failure.`, {
        category: classifyWindowsMcpErrorCategory(outputText, 'tools/call'),
        retryable: false,
        responseSnippet: truncateText(responseText),
      });
    }

    if (outputText && isInteractiveDesktopBlockedMessage(outputText)) {
      throw new WindowsMcpClientError(outputText, {
        category: 'interactive_desktop_blocked',
        retryable: false,
        responseSnippet: truncateText(responseText),
      });
    }
  }
}

function createCallerAbortError(reason?: unknown): WindowsMcpClientError {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.trim().length > 0
        ? reason
        : 'Windows MCP request was aborted by caller.';

  return new WindowsMcpClientError(message, {
    category: 'transport_error',
    retryable: false,
    cause: reason,
  });
}

export function normalizeWindowsMcpClientError(
  error: unknown,
  method?: string,
): WindowsMcpClientError {
  if (error instanceof WindowsMcpClientError) {
    return error;
  }

  if (isAbortError(error)) {
    return new WindowsMcpClientError(`Windows MCP request timed out${method ? ` while calling ${method}` : ''}.`, {
      category: 'transport_timeout',
      retryable: true,
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  const category = classifyWindowsMcpErrorCategory(message, method);
  return new WindowsMcpClientError(message, {
    category,
    retryable: isRetryableWindowsMcpCategory(category),
    cause: error,
  });
}

export function classifyWindowsMcpErrorCategory(
  message: string | undefined,
  method?: string,
): WindowsMcpErrorCategory {
  const normalized = (message || '').toLowerCase();

  if (isInteractiveDesktopBlockedMessage(normalized)) {
    return 'interactive_desktop_blocked';
  }

  if (isSessionErrorText(normalized)) {
    return 'session_missing';
  }

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'transport_timeout';
  }

  if (
    normalized.includes('unexpected token')
    || normalized.includes('failed to parse')
    || normalized.includes('invalid json')
    || normalized.includes('invalid payload')
  ) {
    return 'invalid_response';
  }

  if (normalized.includes('http ') || normalized.includes('fetch failed') || normalized.includes('econnrefused')) {
    return 'http_error';
  }

  if (method === 'tools/call') {
    return 'tool_call_failed';
  }

  return 'transport_error';
}

export function isRetryableWindowsMcpCategory(category: WindowsMcpErrorCategory): boolean {
  return category === 'transport_timeout'
    || category === 'http_error'
    || category === 'session_missing'
    || category === 'transport_error';
}

export function isInteractiveDesktopBlockedMessage(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  return /screen grab failed|session 0|desktop.+not interactive|no active desktop|non-interactive|capture.+failed/i.test(message);
}

export function extractWindowsMcpText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractWindowsMcpText(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') {
    return record.text;
  }

  if (Array.isArray(record.content)) {
    const textParts = record.content
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return undefined;
        }

        const contentEntry = entry as Record<string, unknown>;
        if (typeof contentEntry.text === 'string') {
          return contentEntry.text;
        }

        if (typeof contentEntry.data === 'string') {
          return contentEntry.data;
        }

        return undefined;
      })
      .filter((item): item is string => Boolean(item));

    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  if (record.structuredContent && typeof record.structuredContent === 'object') {
    const structuredText = extractWindowsMcpText(record.structuredContent);
    if (structuredText) {
      return structuredText;
    }

    try {
      return JSON.stringify(record.structuredContent);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function parseWindowsMcpResponse<TResult>(text: string): { rpc: WindowsMcpRpcEnvelope<TResult> } {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new WindowsMcpClientError('Windows MCP returned an empty response body.', {
      category: 'invalid_response',
      responseSnippet: text,
    });
  }

  const direct = tryParseJson<WindowsMcpRpcEnvelope<TResult>>(trimmed);
  if (direct) {
    return { rpc: direct };
  }

  const streamedEvents = parseSsePayloads(trimmed);
  if (streamedEvents.length === 0) {
    throw new WindowsMcpClientError('Windows MCP returned a body that was neither JSON nor SSE data.', {
      category: 'invalid_response',
      responseSnippet: truncateText(text),
    });
  }

  const lastEvent = streamedEvents.at(-1);
  if (!lastEvent) {
    throw new WindowsMcpClientError('Windows MCP SSE stream finished without a parseable event.', {
      category: 'invalid_response',
      responseSnippet: truncateText(text),
    });
  }

  return { rpc: lastEvent as WindowsMcpRpcEnvelope<TResult> };
}

function parseSsePayloads(text: string): WindowsMcpRpcEnvelope[] {
  const events = text.split(/\r?\n\r?\n/);
  const parsed: WindowsMcpRpcEnvelope[] = [];

  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== '[DONE]');

    if (dataLines.length === 0) {
      continue;
    }

    const payload = tryParseJson<WindowsMcpRpcEnvelope>(dataLines.join('\n'));
    if (payload) {
      parsed.push(payload);
    }
  }

  return parsed;
}

function tryParseJson<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function isSessionErrorText(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  return /session.+(missing|expired|not found|required|unknown)|mcp-session-id/i.test(message);
}

function getSessionIdFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const sessionId = (value as Record<string, unknown>).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function truncateText(value: string, limit = 280): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default WindowsMcpHttpClient;
