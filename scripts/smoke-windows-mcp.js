#!/usr/bin/env node

const { randomUUID } = require('crypto');
const { existsSync } = require('fs');
const path = require('path');

const DEFAULT_URL = process.env.WINDOWS_MCP_URL || 'http://192.168.1.10:8000/mcp';
const DEFAULT_PROTOCOL_VERSION = process.env.WINDOWS_MCP_PROTOCOL_VERSION || '2024-11-05';
const ADAPTER_POLL_INTERVAL_MS = 400;
const ADAPTER_POLL_TIMEOUT_MS = parsePositiveInteger(process.env.WINDOWS_MCP_ADAPTER_POLL_TIMEOUT_MS, 120_000);
const RPC_TIMEOUT_MS = parsePositiveInteger(process.env.WINDOWS_MCP_SMOKE_TIMEOUT_MS, 12_000);
const RPC_MAX_RETRIES = parsePositiveInteger(process.env.WINDOWS_MCP_SMOKE_MAX_RETRIES, 2);
const RPC_RETRY_DELAY_MS = parsePositiveInteger(process.env.WINDOWS_MCP_SMOKE_RETRY_DELAY_MS, 500);
const ALLOW_STALE_ADAPTER_DIST = /^(1|true|yes)$/i.test(process.env.WINDOWS_MCP_ALLOW_STALE_ADAPTER_DIST || '');

main().catch((error) => {
  console.error('❌ Windows MCP smoke failed');
  console.error(`   ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  const baseUrl = DEFAULT_URL;
  const init = await rpcRequest(baseUrl, 'initialize', {
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: 'hermes-smoke',
      version: '1.0.0',
    },
  });

  const sessionId = init.sessionId;
  const toolsResponse = await rpcRequest(baseUrl, 'tools/list', undefined, { sessionId });
  const tools = Array.isArray(toolsResponse.result && toolsResponse.result.tools)
    ? toolsResponse.result.tools
    : [];
  const toolNames = tools.map((tool) => tool.name);

  const screenshotTool = pickScreenshotTool(toolNames);
  const screenshotSummary = screenshotTool
    ? await runScreenshotCheck(baseUrl, sessionId, screenshotTool)
    : {
        ok: false,
        toolName: undefined,
        message: 'Worker did not expose Screenshot or Snapshot.',
      };

  const adapterSummary = await maybeRunAdapterSmoke(baseUrl);
  const capabilities = {
    screenshot: toolNames.includes('Screenshot'),
    snapshot: toolNames.includes('Snapshot'),
    scrape: toolNames.includes('Scrape'),
    click: toolNames.includes('Click'),
    type: toolNames.includes('Type'),
    powershell: toolNames.includes('PowerShell'),
    process: toolNames.includes('Process'),
    interactiveDesktopLikely: screenshotSummary.ok,
  };

  const summary = {
    endpoint: baseUrl,
    initializeOk: true,
    sessionIdPresent: Boolean(sessionId),
    sessionId: sessionId || null,
    protocolVersion: init.result && init.result.protocolVersion ? init.result.protocolVersion : DEFAULT_PROTOCOL_VERSION,
    toolsCount: toolNames.length,
    toolNames,
    capabilities,
    screenshot: screenshotSummary,
    adapterTask: adapterSummary,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!screenshotSummary.ok || adapterSummary.skipped || adapterSummary.status !== 'completed') {
    process.exitCode = 1;
  }
}

async function maybeRunAdapterSmoke(baseUrl) {
  const adapterResolution = resolveAdapterModulePath();
  if (!adapterResolution.path) {
    return {
      skipped: true,
      reason: adapterResolution.reason,
    };
  }

  const adapterModule = require(adapterResolution.path);
  const WindowsMcpAdapter = adapterModule.WindowsMcpAdapter || adapterModule.default;
  if (!WindowsMcpAdapter) {
    return {
      skipped: true,
      reason: `Compiled adapter module did not export WindowsMcpAdapter: ${adapterResolution.path}`,
    };
  }

  const adapter = new WindowsMcpAdapter({ baseUrl });
  await adapter.probe();
  const taskId = randomUUID();
  await adapter.submitTask({
    id: taskId,
    kind: 'desktop',
    target: 'windows',
    intent: 'Screenshot',
    priority: 'normal',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'queued',
    input: {
      params: {},
    },
    constraints: {
      requiredCapabilities: ['screenshot'],
      interactiveSessionRequired: true,
    },
    metadata: {
      source: 'smoke-windows-mcp.js',
    },
  });

  const deadline = Date.now() + ADAPTER_POLL_TIMEOUT_MS;
  let task = null;
  while (Date.now() < deadline) {
    task = await adapter.getTask(taskId);
    if (task && isTerminalTaskStatus(task.status)) {
      break;
    }
    await sleep(ADAPTER_POLL_INTERVAL_MS);
  }

  if (task && !isTerminalTaskStatus(task.status)) {
    await sleep(1_000);
    task = await adapter.getTask(taskId);
  }

  if (!task) {
    return {
      status: 'missing',
      lastError: 'task disappeared before polling could complete',
    };
  }

  return {
    skipped: false,
    adapterPath: path.relative(process.cwd(), adapterResolution.path),
    adapterSource: adapterResolution.source,
    status: task.status,
    lastError: task.lastError,
    artifacts: summarizeArtifacts(task.artifacts),
  };
}

function resolveAdapterModulePath() {
  const overridePath = process.env.WINDOWS_MCP_ADAPTER_JS
    ? path.resolve(process.cwd(), process.env.WINDOWS_MCP_ADAPTER_JS)
    : null;
  if (overridePath) {
    return existsSync(overridePath)
      ? { path: overridePath, source: 'override' }
      : { reason: `WINDOWS_MCP_ADAPTER_JS does not exist: ${overridePath}` };
  }

  const distPath = path.resolve(__dirname, '../dist/remote/adapters/WindowsMcpAdapter.js');
  if (existsSync(distPath)) {
    return { path: distPath, source: 'dist' };
  }

  const staleDistPath = path.resolve(__dirname, '../.remote-task2-dist/adapters/WindowsMcpAdapter.js');
  if (existsSync(staleDistPath)) {
    return ALLOW_STALE_ADAPTER_DIST
      ? { path: staleDistPath, source: 'stale-dist' }
      : {
          reason: `Refusing stale adapter build at ${path.relative(process.cwd(), staleDistPath)} without WINDOWS_MCP_ALLOW_STALE_ADAPTER_DIST=1.`,
        };
  }

  return {
    reason: 'adapter smoke skipped (no compiled adapter js found under dist/remote/adapters/WindowsMcpAdapter.js)',
  };
}

async function runScreenshotCheck(baseUrl, sessionId, toolName) {
  try {
    const response = await rpcRequest(baseUrl, 'tools/call', {
      name: toolName,
      arguments: {},
    }, { sessionId });
    const message = summarizeResultText(response.result) || 'tool returned a payload';
    return {
      ok: !/screen grab failed|session 0|non-interactive|no active desktop/i.test(message),
      toolName,
      message,
    };
  } catch (error) {
    return {
      ok: false,
      toolName,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function rpcRequest(baseUrl, method, params, options = {}) {
  let attempt = 0;
  let lastError;

  while (attempt <= RPC_MAX_RETRIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: randomUUID(),
          method,
          params,
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = parseResponseBody(text);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new SmokeRpcError(`HTTP ${response.status}: ${truncate(text)}`, { retryable });
      }
      if (payload.error) {
        throw new SmokeRpcError(payload.error.message || truncate(text), { retryable: false });
      }

      return {
        sessionId: response.headers.get('mcp-session-id') || (payload.result && payload.result.sessionId) || options.sessionId,
        result: payload.result,
        rawText: text,
      };
    } catch (error) {
      const normalizedError = normalizeSmokeRpcError(error);
      lastError = normalizedError;
      if (!normalizedError.retryable || attempt >= RPC_MAX_RETRIES) {
        break;
      }

      await sleep(RPC_RETRY_DELAY_MS * (attempt + 1));
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new SmokeRpcError(`Windows MCP ${method} failed without a response.`, { retryable: false });
}

function parseResponseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty response body');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const events = trimmed.split(/\r?\n\r?\n/);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== '[DONE]');
      if (dataLines.length === 0) {
        continue;
      }

      try {
        return JSON.parse(dataLines.join('\n'));
      } catch {
        continue;
      }
    }

    throw new Error(`Response was neither JSON nor parseable SSE: ${truncate(trimmed)}`);
  }
}

function pickScreenshotTool(toolNames) {
  if (toolNames.includes('Screenshot')) {
    return 'Screenshot';
  }
  if (toolNames.includes('Snapshot')) {
    return 'Snapshot';
  }

  return toolNames.find((toolName) => /screenshot|snapshot/i.test(toolName));
}

function summarizeResultText(result) {
  if (typeof result === 'string') {
    return truncate(result);
  }

  if (Array.isArray(result)) {
    const parts = result.map((entry) => summarizeResultText(entry)).filter(Boolean);
    return parts.length > 0 ? truncate(parts.join(' | ')) : undefined;
  }

  if (!result || typeof result !== 'object') {
    return undefined;
  }

  if (typeof result.text === 'string') {
    return truncate(result.text);
  }

  if (Array.isArray(result.content)) {
    const parts = result.content
      .map((entry) => (entry && typeof entry.text === 'string' ? entry.text : undefined))
      .filter(Boolean);
    if (parts.length > 0) {
      return truncate(parts.join(' | '));
    }
  }

  if (result.structuredContent) {
    try {
      return truncate(JSON.stringify(result.structuredContent));
    } catch {
      return undefined;
    }
  }

  try {
    return truncate(JSON.stringify(result));
  } catch {
    return undefined;
  }
}

function summarizeArtifacts(artifacts) {
  if (!artifacts) {
    return 'none';
  }

  const parts = [];
  if (Array.isArray(artifacts.logs) && artifacts.logs.length > 0) {
    parts.push(`logs=${artifacts.logs.join(',')}`);
  }
  if (Array.isArray(artifacts.screenshots) && artifacts.screenshots.length > 0) {
    parts.push(`screenshots=${artifacts.screenshots.join(',')}`);
  }
  if (Array.isArray(artifacts.snapshots) && artifacts.snapshots.length > 0) {
    parts.push(`snapshots=${artifacts.snapshots.join(',')}`);
  }

  return parts.join('; ') || 'none';
}

function isTerminalTaskStatus(status) {
  return ['wait_login', 'blocked', 'failed_retryable', 'failed_terminal', 'completed', 'cancelled'].includes(status);
}

function truncate(value, limit = 220) {
  if (!value || value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}…`;
}

class SmokeRpcError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SmokeRpcError';
    this.retryable = Boolean(options.retryable);
  }
}

function normalizeSmokeRpcError(error) {
  if (error instanceof SmokeRpcError) {
    return error;
  }

  if (error && typeof error === 'object' && error.name === 'AbortError') {
    return new SmokeRpcError(`Request timed out after ${RPC_TIMEOUT_MS}ms`, { retryable: true });
  }

  const message = error instanceof Error ? error.message : String(error);
  const retryable = /fetch failed|timed out|timeout|econnrefused|socket hang up|http 429|http 5\d\d/i.test(message);
  return new SmokeRpcError(message, { retryable });
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
