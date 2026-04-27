import type { RemoteDeviceStatus } from '../adapters/RemoteAdapter';
import type { WindowsMcpClient, WindowsMcpToolDescriptor } from '../adapters/WindowsMcpAdapter';
import { inspectWindowsSessionHealth, type WindowsSessionHealthSnapshot } from './WindowsSessionHealth';

export interface WindowsCapabilities {
  screenshot: boolean;
  snapshot: boolean;
  scrape: boolean;
  click: boolean;
  type: boolean;
  powershell: boolean;
  process: boolean;
  interactiveDesktopLikely: boolean;
}

export interface WindowsCapabilitySnapshot {
  checkedAt: number;
  toolNames: string[];
  capabilities: WindowsCapabilities;
  sessionHealth: WindowsSessionHealthSnapshot;
}

export interface WindowsCapabilityProbeRequest {
  forceRefresh?: boolean;
  tools?: WindowsMcpToolDescriptor[];
}

export interface WindowsCapabilityProbeOptions {
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 30_000;

export class WindowsCapabilityProbe {
  private readonly cacheTtlMs: number;
  private cachedSnapshot?: WindowsCapabilitySnapshot;

  constructor(options: WindowsCapabilityProbeOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  public clear(): void {
    this.cachedSnapshot = undefined;
  }

  public async probe(
    client: WindowsMcpClient,
    request: WindowsCapabilityProbeRequest = {},
  ): Promise<WindowsCapabilitySnapshot> {
    const now = Date.now();
    if (!request.forceRefresh && this.cachedSnapshot && now - this.cachedSnapshot.checkedAt <= this.cacheTtlMs) {
      return cloneCapabilitySnapshot(this.cachedSnapshot);
    }

    const tools = request.tools ?? await client.listTools();
    const capabilities = deriveWindowsCapabilities(tools);
    const sessionHealth = await inspectWindowsSessionHealth(client, tools);
    capabilities.interactiveDesktopLikely = sessionHealth.interactiveDesktopLikely;

    const snapshot: WindowsCapabilitySnapshot = {
      checkedAt: Date.now(),
      toolNames: tools.map((tool) => tool.name),
      capabilities,
      sessionHealth,
    };

    this.cachedSnapshot = cloneCapabilitySnapshot(snapshot);
    return cloneCapabilitySnapshot(snapshot);
  }
}

export function deriveWindowsCapabilities(tools: WindowsMcpToolDescriptor[]): WindowsCapabilities {
  const normalizedToolNames = new Set(tools.map((tool) => tool.name.toLowerCase()));

  return {
    screenshot: hasTool(normalizedToolNames, 'screenshot'),
    snapshot: hasTool(normalizedToolNames, 'snapshot'),
    scrape: hasTool(normalizedToolNames, 'scrape'),
    click: hasTool(normalizedToolNames, 'click'),
    type: hasTool(normalizedToolNames, 'type'),
    powershell: hasTool(normalizedToolNames, 'powershell'),
    process: hasTool(normalizedToolNames, 'process'),
    interactiveDesktopLikely: false,
  };
}

export function capabilitiesToRemoteCapabilities(capabilities: WindowsCapabilities): string[] {
  const remoteCapabilities = ['mcp', 'windows-control-plane'];

  if (capabilities.screenshot) {
    remoteCapabilities.push('screenshot');
  }
  if (capabilities.snapshot) {
    remoteCapabilities.push('snapshot');
  }
  if (capabilities.scrape) {
    remoteCapabilities.push('scrape');
  }
  if (capabilities.click) {
    remoteCapabilities.push('click');
  }
  if (capabilities.type) {
    remoteCapabilities.push('type');
  }
  if (capabilities.powershell) {
    remoteCapabilities.push('powershell');
  }
  if (capabilities.process) {
    remoteCapabilities.push('process');
  }
  if (capabilities.interactiveDesktopLikely) {
    remoteCapabilities.push('interactive-desktop');
  }
  if (isFullControlReady(capabilities)) {
    remoteCapabilities.push('browser-automation');
    remoteCapabilities.push('full-control');
  }

  return remoteCapabilities;
}

export function deriveWindowsDeviceStatus(snapshot: WindowsCapabilitySnapshot): RemoteDeviceStatus {
  const { capabilities, sessionHealth } = snapshot;
  const fullControlSurfacePresent = capabilities.screenshot
    && capabilities.snapshot
    && capabilities.click
    && capabilities.type;

  if (sessionHealth.failureCategory === 'interactive_desktop_blocked') {
    return 'blocked';
  }

  if (!fullControlSurfacePresent) {
    return 'degraded';
  }

  if (!capabilities.interactiveDesktopLikely) {
    return 'degraded';
  }

  return 'online';
}

export function isFullControlReady(capabilities: WindowsCapabilities): boolean {
  return capabilities.screenshot
    && capabilities.snapshot
    && capabilities.click
    && capabilities.type
    && capabilities.interactiveDesktopLikely;
}

function cloneCapabilitySnapshot(snapshot: WindowsCapabilitySnapshot): WindowsCapabilitySnapshot {
  return {
    checkedAt: snapshot.checkedAt,
    toolNames: [...snapshot.toolNames],
    capabilities: { ...snapshot.capabilities },
    sessionHealth: { ...snapshot.sessionHealth },
  };
}

function hasTool(normalizedToolNames: Set<string>, needle: string): boolean {
  for (const toolName of normalizedToolNames) {
    if (toolName.includes(needle)) {
      return true;
    }
  }

  return false;
}
