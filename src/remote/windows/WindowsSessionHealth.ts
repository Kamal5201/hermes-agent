import type { WindowsMcpClient, WindowsMcpToolDescriptor } from '../adapters/WindowsMcpAdapter';
import {
  extractWindowsMcpText,
  isInteractiveDesktopBlockedMessage,
  normalizeWindowsMcpClientError,
  type WindowsMcpErrorCategory,
} from './WindowsMcpHttpClient';

export type WindowsSessionFailureCategory = WindowsMcpErrorCategory | 'interactive_desktop_blocked';

export interface WindowsSessionHealthSnapshot {
  checkedAt: number;
  interactiveDesktopLikely: boolean;
  screenshotAttempted: boolean;
  screenshotSucceeded: boolean;
  toolName?: string;
  failureCategory?: WindowsSessionFailureCategory;
  failureSummary?: string;
  outputSummary?: string;
}

const SCREENSHOT_TOOL_CANDIDATES = ['Screenshot', 'Snapshot'];

export async function inspectWindowsSessionHealth(
  client: WindowsMcpClient,
  tools: WindowsMcpToolDescriptor[],
): Promise<WindowsSessionHealthSnapshot> {
  const checkedAt = Date.now();
  const toolName = pickDesktopProbeTool(tools);

  if (!toolName) {
    return {
      checkedAt,
      interactiveDesktopLikely: false,
      screenshotAttempted: false,
      screenshotSucceeded: false,
      failureCategory: 'tool_call_failed',
      failureSummary: 'Worker did not expose Screenshot or Snapshot.',
    };
  }

  try {
    const result = await client.callTool(toolName, {});
    const outputSummary = summarizeToolOutput(result);
    const interactiveDesktopLikely = !isInteractiveDesktopBlockedMessage(outputSummary);

    return {
      checkedAt,
      interactiveDesktopLikely,
      screenshotAttempted: true,
      screenshotSucceeded: interactiveDesktopLikely,
      toolName,
      outputSummary,
      ...(interactiveDesktopLikely
        ? {}
        : {
            failureCategory: 'interactive_desktop_blocked' as const,
            failureSummary: outputSummary || `${toolName} indicated a non-interactive desktop.`,
          }),
    };
  } catch (error) {
    const normalizedError = normalizeWindowsMcpClientError(error, 'tools/call');
    return {
      checkedAt,
      interactiveDesktopLikely: false,
      screenshotAttempted: true,
      screenshotSucceeded: false,
      toolName,
      failureCategory: normalizedError.category,
      failureSummary: normalizedError.message,
      outputSummary: normalizedError.responseSnippet,
    };
  }
}

function pickDesktopProbeTool(tools: WindowsMcpToolDescriptor[]): string | undefined {
  for (const preferredName of SCREENSHOT_TOOL_CANDIDATES) {
    const exact = tools.find((tool) => tool.name === preferredName);
    if (exact) {
      return exact.name;
    }
  }

  const fuzzy = tools.find((tool) => /screenshot|snapshot/i.test(tool.name));
  return fuzzy?.name;
}

function summarizeToolOutput(result: unknown): string | undefined {
  const text = extractWindowsMcpText(result);
  if (text) {
    return truncate(text);
  }

  if (!result || typeof result !== 'object') {
    return undefined;
  }

  try {
    return truncate(JSON.stringify(result));
  } catch {
    return undefined;
  }
}

function truncate(value: string, limit = 240): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}…`;
}
