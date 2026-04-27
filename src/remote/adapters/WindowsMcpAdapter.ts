import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log/main.js';
import type { TaskArtifacts, TaskEnvelope, WindowsTaskStatus } from '../contracts/TaskEnvelope';
import { isTerminalTaskStatus } from '../contracts/TaskEnvelope';
import type { TaskResult } from '../contracts/TaskResult';
import type { AdapterProbeResult, RemoteAdapter, RemoteDevice, RemoteSession } from './RemoteAdapter';
import {
  WindowsCapabilityProbe,
  capabilitiesToRemoteCapabilities,
  deriveWindowsDeviceStatus,
  type WindowsCapabilitySnapshot,
} from '../windows/WindowsCapabilityProbe';
import {
  WindowsMcpHttpClient,
  extractWindowsMcpText,
  isRetryableWindowsMcpCategory,
  normalizeWindowsMcpClientError,
  type WindowsMcpErrorCategory,
} from '../windows/WindowsMcpHttpClient';

export interface WindowsMcpClientInfo {
  name: string;
  version: string;
}

export interface WindowsMcpToolDescriptor {
  name: string;
  description?: string;
}

export interface WindowsMcpInitializeParams {
  protocolVersion: string;
  capabilities?: Record<string, unknown>;
  clientInfo: WindowsMcpClientInfo;
}

export interface WindowsMcpInitializeResult {
  sessionId?: string;
  protocolVersion?: string;
  serverInfo?: {
    name?: string;
    version?: string;
  };
}

export interface WindowsMcpCallOptions {
  signal?: AbortSignal;
}

export interface WindowsMcpClient {
  initialize(params: WindowsMcpInitializeParams): Promise<WindowsMcpInitializeResult>;
  listTools(): Promise<WindowsMcpToolDescriptor[]>;
  callTool(name: string, args?: Record<string, unknown>, options?: WindowsMcpCallOptions): Promise<unknown>;
}

export interface WindowsMcpSeedDevice {
  id: string;
  name: string;
  status?: RemoteDevice['status'];
  capabilities?: string[];
  endpoint?: string;
  lastSeen?: number;
  ip?: string;
  port?: number;
  metadata?: Record<string, unknown>;
}

export interface WindowsMcpAdapterOptions {
  baseUrl?: string;
  protocolVersion?: string;
  clientInfo?: WindowsMcpClientInfo;
  client?: WindowsMcpClient;
  seedDevices?: WindowsMcpSeedDevice[];
}

interface TaskWorkspace {
  rootAbs: string;
  logsDirAbs: string;
  screenshotsDirAbs: string;
  snapshotsDirAbs: string;
  taskFileAbs: string;
  resultFileAbs: string;
  logFileAbs: string;
  taskFileRelative: string;
  resultFileRelative: string;
  logFileRelative: string;
}

interface ToolInvocation {
  toolName: string;
  args: Record<string, unknown>;
}

const DEFAULT_BASE_URL = 'http://192.168.1.10:8000/mcp';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_CLIENT_INFO: WindowsMcpClientInfo = {
  name: 'hermes-companion',
  version: '1.0.0',
};
const DEFAULT_SEED_CAPABILITIES = ['mcp', 'windows-control-plane'];
const TASK_ARTIFACTS_ROOT = path.resolve(process.cwd(), 'artifacts', 'windows-tasks');
const TASK_LOG_FILENAME = 'events.jsonl';

export class WindowsMcpAdapter implements RemoteAdapter {
  public readonly name = 'windows-mcp';
  public readonly platform = 'windows' as const;

  private readonly baseUrl: string;
  private readonly protocolVersion: string;
  private readonly clientInfo: WindowsMcpClientInfo;
  private readonly client?: WindowsMcpClient;
  private readonly configuredSeeds: WindowsMcpSeedDevice[];
  private readonly capabilityProbe: WindowsCapabilityProbe;
  private readonly devices = new Map<string, RemoteDevice>();
  private readonly sessions = new Map<string, RemoteSession>();
  private readonly tasks = new Map<string, TaskEnvelope>();
  private readonly taskResults = new Map<string, TaskResult>();
  private readonly taskExecutions = new Map<string, Promise<void>>();
  private readonly cancelledTasks = new Set<string>();
  private readonly taskAbortControllers = new Map<string, AbortController>();

  constructor(options: WindowsMcpAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
    this.client = options.client ?? (options.seedDevices?.length ? undefined : new WindowsMcpHttpClient({
      baseUrl: this.baseUrl,
      protocolVersion: this.protocolVersion,
      clientInfo: this.clientInfo,
    }));
    this.configuredSeeds = options.seedDevices ?? [];
    this.capabilityProbe = new WindowsCapabilityProbe();
  }

  public async probe(): Promise<AdapterProbeResult> {
    if (this.client) {
      return this.probeWithClient();
    }

    const devices = this.getSeedDevices();
    this.replaceDevices(devices);

    return {
      available: devices.some((device) => device.status !== 'offline' && device.status !== 'blocked'),
      checkedAt: Date.now(),
      devices: devices.map((device) => this.cloneDevice(device)),
      metadata: {
        baseUrl: this.baseUrl,
        protocolVersion: this.protocolVersion,
        clientInfo: this.clientInfo,
        mode: 'seed',
      },
    };
  }

  public supports(device: RemoteDevice, task?: TaskEnvelope): boolean {
    if (device.platform !== this.platform) {
      return false;
    }

    if (!task) {
      return true;
    }

    const requiredCapabilities = this.getEffectiveRequiredCapabilities(task);
    return requiredCapabilities.every((capability) => device.capabilities.includes(capability));
  }

  public async connect(deviceId: string): Promise<RemoteSession> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Windows MCP device not found: ${deviceId}`);
    }

    if (device.status === 'offline' || device.status === 'blocked') {
      throw new Error(`Windows MCP device is not routable (${device.status}): ${deviceId}`);
    }

    const initializeResult = this.client
      ? await this.client.initialize({
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: this.clientInfo,
        })
      : undefined;

    const session: RemoteSession = {
      id: randomUUID(),
      device: this.cloneDevice(device),
      adapter: this.name,
      startTime: Date.now(),
      status: 'active',
      metadata: {
        baseUrl: this.baseUrl,
        protocolVersion: initializeResult?.protocolVersion ?? this.protocolVersion,
        clientBound: Boolean(this.client),
        sessionId: initializeResult?.sessionId ?? this.getBoundSessionId(),
      },
    };

    this.sessions.set(session.id, session);
    log.info(`[WindowsMcpAdapter] Connected to ${device.name} (${device.id})`);
    return this.cloneSession(session);
  }

  public async submitTask(task: TaskEnvelope): Promise<{ taskId: string }> {
    const now = Date.now();
    const taskId = task.id;
    const workspace = await this.ensureTaskWorkspace(taskId);
    const normalizedTask = this.cloneTask({
      ...task,
      adapter: this.name,
      target: 'windows',
      updatedAt: now,
      status: task.status === 'completed' ? 'queued' : task.status,
      artifacts: mergeArtifacts(task.artifacts, {
        logs: [workspace.logFileRelative],
      }),
      metadata: this.mergeTaskMetadata(task.metadata, {
        baseUrl: this.baseUrl,
        protocolVersion: this.protocolVersion,
        clientInfo: this.clientInfo,
        mode: this.client ? 'live' : 'seed',
        taskFile: workspace.taskFileRelative,
        resultFile: workspace.resultFileRelative,
      }),
    });

    this.tasks.set(taskId, normalizedTask);
    await this.persistTaskEnvelope(normalizedTask);
    await this.appendTaskLog(taskId, 'accepted', {
      intent: normalizedTask.intent,
      deviceId: normalizedTask.deviceId,
      status: normalizedTask.status,
    });

    if (!this.client) {
      await this.finalizeTaskError(taskId, new Error('Windows MCP client is not configured; adapter is running in seed-only mode.'));
      return { taskId };
    }

    if (!this.taskExecutions.has(taskId)) {
      const execution = this.executeTask(taskId)
        .catch(async (error) => {
          await this.finalizeTaskError(taskId, error);
        })
        .finally(() => {
          this.taskExecutions.delete(taskId);
        });

      this.taskExecutions.set(taskId, execution);
    }

    return { taskId };
  }

  public async getTask(taskId: string): Promise<TaskEnvelope | null> {
    const task = this.tasks.get(taskId);
    return task ? this.cloneTask(task) : null;
  }

  public async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    this.cancelledTasks.add(taskId);
    this.taskAbortControllers.get(taskId)?.abort(new Error(`Task cancelled: ${taskId}`));
    const now = Date.now();
    const cancelledTask = this.cloneTask({
      ...task,
      status: 'cancelled',
      updatedAt: now,
      lastError: undefined,
    });

    this.tasks.set(taskId, cancelledTask);
    await this.persistTaskEnvelope(cancelledTask);
    await this.appendTaskLog(taskId, 'cancelled');

    const result: TaskResult = {
      taskId,
      status: 'cancelled',
      updatedAt: now,
      completedAt: now,
      artifacts: cancelledTask.artifacts,
      metadata: {
        adapter: this.name,
      },
    };

    this.taskResults.set(taskId, result);
    await this.persistTaskResult(taskId, result);
    log.info(`[WindowsMcpAdapter] Task cancelled: ${taskId}`);
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || !this.client) {
      return;
    }

    if (this.cancelledTasks.has(taskId)) {
      return;
    }

    const abortController = new AbortController();
    this.taskAbortControllers.set(taskId, abortController);

    try {
      await this.updateTask(taskId, {
        status: 'routing',
        updatedAt: Date.now(),
      }, {
        logEvent: 'routing',
        logPayload: {
          intent: task.intent,
        },
      });

      if (this.cancelledTasks.has(taskId)) {
        return;
      }

      const invocation = this.resolveToolInvocation(task);
      await this.updateTask(taskId, {
        status: 'running',
        updatedAt: Date.now(),
        metadata: this.mergeTaskMetadata(task.metadata, {
          toolName: invocation.toolName,
          toolArgs: invocation.args,
        }),
      }, {
        logEvent: 'running',
        logPayload: {
          toolName: invocation.toolName,
        },
      });

      if (this.cancelledTasks.has(taskId)) {
        return;
      }

      const toolResult = await this.client.callTool(invocation.toolName, invocation.args, {
        signal: abortController.signal,
      });
      if (this.cancelledTasks.has(taskId)) {
        return;
      }

      const persistedArtifacts = await this.persistToolArtifacts(taskId, invocation.toolName, toolResult);
      const now = Date.now();
      const completedTask = await this.updateTask(taskId, {
        status: 'completed',
        updatedAt: now,
        lastError: undefined,
        artifacts: mergeArtifacts(this.tasks.get(taskId)?.artifacts, persistedArtifacts),
      }, {
        logEvent: 'completed',
        logPayload: {
          toolName: invocation.toolName,
        },
      });

      const result: TaskResult = {
        taskId,
        status: 'completed',
        updatedAt: now,
        completedAt: now,
        output: toolResult,
        artifacts: completedTask.artifacts,
        metadata: {
          adapter: this.name,
          baseUrl: this.baseUrl,
          toolName: invocation.toolName,
          sessionId: this.getBoundSessionId(),
        },
      };

      this.taskResults.set(taskId, result);
      await this.persistTaskResult(taskId, result);
      log.info(`[WindowsMcpAdapter] Task completed: ${taskId} (${invocation.toolName})`);
    } finally {
      this.taskAbortControllers.delete(taskId);
    }
  }

  private async finalizeTaskError(taskId: string, error: unknown): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || this.cancelledTasks.has(taskId)) {
      return;
    }

    const normalizedError = normalizeWindowsMcpClientError(error, 'tools/call');
    const status = this.mapErrorToTaskStatus(normalizedError.category, normalizedError.message);
    const now = Date.now();
    const errorArtifacts = await this.persistErrorArtifacts(taskId, normalizedError);
    const updatedTask = await this.updateTask(taskId, {
      status,
      updatedAt: now,
      lastError: normalizedError.message,
      artifacts: mergeArtifacts(task.artifacts, errorArtifacts),
      metadata: this.mergeTaskMetadata(task.metadata, {
        lastErrorCategory: normalizedError.category,
        lastErrorRetryable: normalizedError.retryable,
      }),
    }, {
      logEvent: 'failed',
      logPayload: {
        category: normalizedError.category,
        message: normalizedError.message,
      },
    });

    const result: TaskResult = {
      taskId,
      status,
      updatedAt: now,
      completedAt: isTerminalTaskStatus(status) ? now : undefined,
      error: {
        code: normalizedError.category.toUpperCase(),
        message: normalizedError.message,
        details: {
          retryable: normalizedError.retryable,
          responseSnippet: normalizedError.responseSnippet,
        },
      },
      artifacts: updatedTask.artifacts,
      metadata: {
        adapter: this.name,
        baseUrl: this.baseUrl,
      },
    };

    this.taskResults.set(taskId, result);
    await this.persistTaskResult(taskId, result);
    log.warn(`[WindowsMcpAdapter] Task ${status}: ${taskId} (${normalizedError.category}) ${normalizedError.message}`);
  }

  private async probeWithClient(): Promise<AdapterProbeResult> {
    try {
      const initializeResult = await this.client!.initialize({
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: this.clientInfo,
      });
      const capabilitySnapshot = await this.capabilityProbe.probe(this.client!, { forceRefresh: true });
      const device = this.createLiveDevice(initializeResult, capabilitySnapshot);
      const available = device.status !== 'offline' && device.status !== 'blocked';

      this.replaceDevices([device]);
      return {
        available,
        checkedAt: capabilitySnapshot.checkedAt,
        devices: [this.cloneDevice(device)],
        reason: available ? capabilitySnapshot.sessionHealth.failureSummary : (capabilitySnapshot.sessionHealth.failureSummary ?? undefined),
        metadata: {
          baseUrl: this.baseUrl,
          protocolVersion: initializeResult.protocolVersion ?? this.protocolVersion,
          sessionId: initializeResult.sessionId ?? this.getBoundSessionId(),
          clientInfo: this.clientInfo,
          mode: 'live',
          toolNames: capabilitySnapshot.toolNames,
          windowsCapabilities: capabilitySnapshot.capabilities,
          sessionHealth: capabilitySnapshot.sessionHealth,
        },
      };
    } catch (error) {
      const normalizedError = normalizeWindowsMcpClientError(error, 'initialize');
      log.warn(`[WindowsMcpAdapter] Probe failed for ${this.baseUrl}: ${normalizedError.message}`);

      const fallbackStatus: RemoteDevice['status'] = normalizedError.category === 'interactive_desktop_blocked'
        ? 'blocked'
        : 'offline';
      const fallback = this.createDevice({
        id: 'windows-mcp-primary',
        name: 'Windows MCP Worker',
        status: fallbackStatus,
        endpoint: this.baseUrl,
        capabilities: DEFAULT_SEED_CAPABILITIES,
        metadata: {
          protocolVersion: this.protocolVersion,
          probeError: normalizedError.message,
          errorCategory: normalizedError.category,
        },
      });

      this.replaceDevices([fallback]);
      return {
        available: false,
        checkedAt: Date.now(),
        devices: [this.cloneDevice(fallback)],
        reason: normalizedError.message,
        metadata: {
          baseUrl: this.baseUrl,
          protocolVersion: this.protocolVersion,
          clientInfo: this.clientInfo,
          mode: 'client-error',
          errorCategory: normalizedError.category,
        },
      };
    }
  }

  private createLiveDevice(
    initializeResult: WindowsMcpInitializeResult,
    capabilitySnapshot: WindowsCapabilitySnapshot,
  ): RemoteDevice {
    return this.createDevice({
      id: 'windows-mcp-primary',
      name: 'Windows MCP Worker',
      status: deriveWindowsDeviceStatus(capabilitySnapshot),
      endpoint: this.baseUrl,
      capabilities: capabilitiesToRemoteCapabilities(capabilitySnapshot.capabilities),
      metadata: {
        protocolVersion: initializeResult.protocolVersion ?? this.protocolVersion,
        sessionId: initializeResult.sessionId ?? this.getBoundSessionId(),
        serverInfo: initializeResult.serverInfo,
        toolNames: capabilitySnapshot.toolNames,
        windowsCapabilities: capabilitySnapshot.capabilities,
        sessionHealth: capabilitySnapshot.sessionHealth,
      },
    });
  }

  private getSeedDevices(): RemoteDevice[] {
    const seeds: WindowsMcpSeedDevice[] = this.configuredSeeds.length > 0
      ? this.configuredSeeds
      : [
          {
            id: 'windows-mcp-primary',
            name: 'Windows MCP Worker',
            status: 'degraded',
            endpoint: this.baseUrl,
            capabilities: DEFAULT_SEED_CAPABILITIES,
            metadata: {
              protocolVersion: this.protocolVersion,
              stub: true,
              note: 'Seed-only mode: no live Windows MCP client configured.',
            },
          },
        ];

    return seeds.map((seed) => this.createDevice(seed));
  }

  private createDevice(seed: WindowsMcpSeedDevice): RemoteDevice {
    const endpoint = seed.endpoint ?? this.baseUrl;
    const endpointUrl = this.parseUrl(endpoint);

    return {
      id: seed.id,
      name: seed.name,
      platform: 'windows',
      status: seed.status ?? 'degraded',
      lastSeen: seed.lastSeen ?? Date.now(),
      capabilities: [...(seed.capabilities ?? DEFAULT_SEED_CAPABILITIES)],
      adapter: this.name,
      endpoint,
      ip: seed.ip ?? endpointUrl?.hostname,
      port: seed.port ?? this.getPortFromUrl(endpointUrl),
      metadata: seed.metadata ? { ...seed.metadata } : undefined,
    };
  }

  private replaceDevices(devices: RemoteDevice[]): void {
    this.devices.clear();
    for (const device of devices) {
      this.devices.set(device.id, this.cloneDevice(device));
    }
  }

  private getEffectiveRequiredCapabilities(task: TaskEnvelope): string[] {
    const requiredCapabilities = new Set(task.constraints?.requiredCapabilities ?? []);
    const normalizedAction = this.inferNormalizedTaskAction(task);

    if (task.constraints?.interactiveSessionRequired) {
      requiredCapabilities.add('interactive-desktop');
    }

    const mappedCapability = this.mapActionToCapability(normalizedAction);
    if (mappedCapability) {
      requiredCapabilities.add(mappedCapability);
    }

    if (this.requiresFullControl(task, normalizedAction)) {
      requiredCapabilities.add('full-control');
    }

    return [...requiredCapabilities];
  }

  private inferNormalizedTaskAction(task: TaskEnvelope): string {
    const input = asRecord(task.input);
    const metadata = asRecord(task.metadata);
    const windowsMcpMetadata = asRecord(metadata.windowsMcp);
    const explicitToolName = firstString(
      windowsMcpMetadata.toolName,
      input.toolName,
    );

    return (explicitToolName ?? task.intent).trim().toLowerCase();
  }

  private mapActionToCapability(normalizedAction: string): string | undefined {
    switch (normalizedAction) {
      case 'screenshot':
        return 'screenshot';
      case 'snapshot':
        return 'snapshot';
      case 'scrape':
        return 'scrape';
      case 'click':
        return 'click';
      case 'type':
        return 'type';
      case 'powershell':
        return 'powershell';
      case 'process':
        return 'process';
      default:
        return undefined;
    }
  }

  private requiresFullControl(task: TaskEnvelope, normalizedAction: string): boolean {
    if (!task.constraints?.interactiveSessionRequired) {
      return false;
    }

    if (normalizedAction === 'click' || normalizedAction === 'type') {
      return true;
    }

    if (
      normalizedAction === 'screenshot'
      || normalizedAction === 'snapshot'
      || normalizedAction === 'scrape'
      || normalizedAction === 'powershell'
      || normalizedAction === 'process'
    ) {
      return false;
    }

    return task.kind !== 'browser';
  }

  private resolveToolInvocation(task: TaskEnvelope): ToolInvocation {
    const input = asRecord(task.input);
    const metadata = asRecord(task.metadata);
    const windowsMcpMetadata = asRecord(metadata.windowsMcp);
    const explicitToolName = firstString(
      windowsMcpMetadata.toolName,
      input.toolName,
    );
    const explicitArgs = asRecord(
      windowsMcpMetadata.toolArgs
      ?? windowsMcpMetadata.args
      ?? input.args
      ?? input.params,
    );

    if (explicitToolName) {
      return {
        toolName: explicitToolName,
        args: explicitArgs,
      };
    }

    const intent = task.intent.trim();
    if (/^screenshot$/i.test(intent)) {
      return { toolName: 'Screenshot', args: explicitArgs };
    }
    if (/^snapshot$/i.test(intent)) {
      return { toolName: 'Snapshot', args: explicitArgs };
    }
    if (/^scrape$/i.test(intent)) {
      return { toolName: 'Scrape', args: explicitArgs };
    }
    if (/^click$/i.test(intent)) {
      return { toolName: 'Click', args: explicitArgs };
    }
    if (/^type$/i.test(intent)) {
      return { toolName: 'Type', args: explicitArgs };
    }
    if (/^process$/i.test(intent)) {
      return { toolName: 'Process', args: explicitArgs };
    }
    if (/^powershell$/i.test(intent)) {
      const explicitCommand = firstString(input.command, explicitArgs.command);
      return {
        toolName: 'PowerShell',
        args: explicitCommand ? { ...explicitArgs, command: explicitCommand } : explicitArgs,
      };
    }

    const command = firstString(input.command, intent) ?? intent;
    return {
      toolName: 'PowerShell',
      args: {
        ...explicitArgs,
        command,
      },
    };
  }

  private mapErrorToTaskStatus(category: WindowsMcpErrorCategory, message: string): WindowsTaskStatus {
    if (category === 'interactive_desktop_blocked') {
      return 'blocked';
    }

    if (looksLikeWaitLogin(message)) {
      return 'wait_login';
    }

    if (isRetryableWindowsMcpCategory(category)) {
      return 'failed_retryable';
    }

    return 'failed_terminal';
  }

  private async updateTask(
    taskId: string,
    patch: Partial<TaskEnvelope>,
    options?: {
      logEvent?: string;
      logPayload?: Record<string, unknown>;
    },
  ): Promise<TaskEnvelope> {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      throw new Error(`Task not found in adapter cache: ${taskId}`);
    }

    if (existing.status === 'cancelled' && patch.status !== 'cancelled') {
      return this.cloneTask(existing);
    }

    const updatedTask = this.cloneTask({
      ...existing,
      ...patch,
      input: patch.input ? { ...patch.input } : existing.input,
      checkpoint: patch.checkpoint ? { ...patch.checkpoint } : existing.checkpoint,
      constraints: patch.constraints ? { ...patch.constraints } : existing.constraints,
      artifacts: patch.artifacts ? mergeArtifacts(existing.artifacts, patch.artifacts) : existing.artifacts,
      metadata: patch.metadata ? { ...patch.metadata } : existing.metadata,
    });

    this.tasks.set(taskId, updatedTask);
    await this.persistTaskEnvelope(updatedTask);

    if (options?.logEvent) {
      await this.appendTaskLog(taskId, options.logEvent, options.logPayload);
    }

    return this.cloneTask(updatedTask);
  }

  private async persistToolArtifacts(
    taskId: string,
    toolName: string,
    toolResult: unknown,
  ): Promise<TaskArtifacts> {
    const workspace = await this.ensureTaskWorkspace(taskId);
    const artifacts: TaskArtifacts = {
      logs: [workspace.logFileRelative],
    };

    const outputPath = path.join(workspace.logsDirAbs, 'tool-output.json');
    await fs.writeFile(outputPath, safeJson(toolResult), 'utf8');
    artifacts.logs = mergeStringArrays(artifacts.logs, [toRelativePath(outputPath)]);

    const textOutput = extractWindowsMcpText(toolResult);
    if (/screenshot/i.test(toolName)) {
      const screenshotArtifact = await this.persistScreenshotArtifact(workspace, toolResult, textOutput);
      if (screenshotArtifact) {
        artifacts.screenshots = [screenshotArtifact];
      }
    }

    if (/snapshot|scrape/i.test(toolName)) {
      const snapshotArtifact = await this.persistSnapshotArtifact(workspace, toolResult, textOutput);
      if (snapshotArtifact) {
        artifacts.snapshots = [snapshotArtifact];
      }
    }

    return artifacts;
  }

  private async persistErrorArtifacts(
    taskId: string,
    error: ReturnType<typeof normalizeWindowsMcpClientError>,
  ): Promise<TaskArtifacts> {
    const workspace = await this.ensureTaskWorkspace(taskId);
    const errorPath = path.join(workspace.logsDirAbs, 'tool-error.json');
    await fs.writeFile(errorPath, safeJson({
      category: error.category,
      retryable: error.retryable,
      message: error.message,
      responseSnippet: error.responseSnippet,
    }), 'utf8');

    return {
      logs: mergeStringArrays([workspace.logFileRelative], [toRelativePath(errorPath)]),
    };
  }

  private async persistScreenshotArtifact(
    workspace: TaskWorkspace,
    toolResult: unknown,
    textOutput: string | undefined,
  ): Promise<string | undefined> {
    const base64Image = findBase64Image(toolResult);
    if (base64Image) {
      const extension = screenshotExtensionForMimeType(base64Image.mimeType);
      const screenshotPath = path.join(workspace.screenshotsDirAbs, `latest-screenshot.${extension}`);
      await fs.writeFile(screenshotPath, Buffer.from(base64Image.data, 'base64'));
      return toRelativePath(screenshotPath);
    }

    const referencedPath = findImageReference(toolResult) ?? findImageReference(textOutput);
    const referenceFilePath = path.join(workspace.screenshotsDirAbs, 'remote-reference.txt');
    await fs.writeFile(referenceFilePath, referencedPath ?? (textOutput || 'Screenshot completed without a transferable image payload.'), 'utf8');
    return toRelativePath(referenceFilePath);
  }

  private async persistSnapshotArtifact(
    workspace: TaskWorkspace,
    toolResult: unknown,
    textOutput: string | undefined,
  ): Promise<string> {
    const snapshotPath = path.join(workspace.snapshotsDirAbs, 'latest-snapshot.txt');
    const content = textOutput || safeJson(toolResult);
    await fs.writeFile(snapshotPath, content, 'utf8');
    return toRelativePath(snapshotPath);
  }

  private async persistTaskEnvelope(task: TaskEnvelope): Promise<void> {
    const workspace = await this.ensureTaskWorkspace(task.id);
    await fs.writeFile(workspace.taskFileAbs, safeJson(task), 'utf8');
  }

  private async persistTaskResult(taskId: string, result: TaskResult): Promise<void> {
    const workspace = await this.ensureTaskWorkspace(taskId);
    await fs.writeFile(workspace.resultFileAbs, safeJson(result), 'utf8');
  }

  private async appendTaskLog(taskId: string, event: string, payload?: Record<string, unknown>): Promise<void> {
    const workspace = await this.ensureTaskWorkspace(taskId);
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    })}\n`;
    await fs.appendFile(workspace.logFileAbs, line, 'utf8');
  }

  private async ensureTaskWorkspace(taskId: string): Promise<TaskWorkspace> {
    const rootAbs = path.join(TASK_ARTIFACTS_ROOT, taskId);
    const logsDirAbs = path.join(rootAbs, 'logs');
    const screenshotsDirAbs = path.join(rootAbs, 'screenshots');
    const snapshotsDirAbs = path.join(rootAbs, 'snapshots');
    await fs.mkdir(logsDirAbs, { recursive: true });
    await fs.mkdir(screenshotsDirAbs, { recursive: true });
    await fs.mkdir(snapshotsDirAbs, { recursive: true });

    const taskFileAbs = path.join(rootAbs, 'task.json');
    const resultFileAbs = path.join(rootAbs, 'result.json');
    const logFileAbs = path.join(logsDirAbs, TASK_LOG_FILENAME);

    return {
      rootAbs,
      logsDirAbs,
      screenshotsDirAbs,
      snapshotsDirAbs,
      taskFileAbs,
      resultFileAbs,
      logFileAbs,
      taskFileRelative: toRelativePath(taskFileAbs),
      resultFileRelative: toRelativePath(resultFileAbs),
      logFileRelative: toRelativePath(logFileAbs),
    };
  }

  private getBoundSessionId(): string | undefined {
    if (this.client instanceof WindowsMcpHttpClient) {
      return this.client.getSessionId();
    }

    return undefined;
  }

  private mergeTaskMetadata(
    metadata: Record<string, unknown> | undefined,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const baseMetadata = metadata ? { ...metadata } : {};
    const existingWindowsMcp = asRecord(baseMetadata.windowsMcp);

    return {
      ...baseMetadata,
      windowsMcp: {
        ...existingWindowsMcp,
        ...patch,
      },
    };
  }

  private parseUrl(input: string): URL | null {
    try {
      return new URL(input);
    } catch {
      return null;
    }
  }

  private getPortFromUrl(url: URL | null): number | undefined {
    if (!url) {
      return undefined;
    }

    if (url.port) {
      const port = Number(url.port);
      return Number.isNaN(port) ? undefined : port;
    }

    return url.protocol === 'https:' ? 443 : 80;
  }

  private cloneDevice(device: RemoteDevice): RemoteDevice {
    return {
      ...device,
      capabilities: [...device.capabilities],
      metadata: device.metadata ? { ...device.metadata } : undefined,
    };
  }

  private cloneSession(session: RemoteSession): RemoteSession {
    return {
      ...session,
      device: this.cloneDevice(session.device),
      metadata: session.metadata ? { ...session.metadata } : undefined,
    };
  }

  private cloneTask(task: TaskEnvelope): TaskEnvelope {
    return {
      ...task,
      input: task.input ? { ...task.input } : undefined,
      checkpoint: task.checkpoint ? { ...task.checkpoint } : undefined,
      constraints: task.constraints
        ? {
            ...task.constraints,
            requiredCapabilities: task.constraints.requiredCapabilities
              ? [...task.constraints.requiredCapabilities]
              : undefined,
          }
        : undefined,
      artifacts: task.artifacts
        ? {
            screenshots: task.artifacts.screenshots ? [...task.artifacts.screenshots] : undefined,
            snapshots: task.artifacts.snapshots ? [...task.artifacts.snapshots] : undefined,
            logs: task.artifacts.logs ? [...task.artifacts.logs] : undefined,
          }
        : undefined,
      metadata: task.metadata ? { ...task.metadata } : undefined,
    };
  }
}

function mergeArtifacts(base: TaskArtifacts | undefined, patch: TaskArtifacts | undefined): TaskArtifacts | undefined {
  if (!base && !patch) {
    return undefined;
  }

  return {
    screenshots: mergeStringArrays(base?.screenshots, patch?.screenshots),
    snapshots: mergeStringArrays(base?.snapshots, patch?.snapshots),
    logs: mergeStringArrays(base?.logs, patch?.logs),
  };
}

function mergeStringArrays(
  current: string[] | undefined,
  next: string[] | undefined,
): string[] | undefined {
  const merged = [...(current ?? []), ...(next ?? [])].filter((value): value is string => Boolean(value));
  if (merged.length === 0) {
    return undefined;
  }

  return Array.from(new Set(merged));
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, replaceErrors, 2);
}

function replaceErrors(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

function toRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath) || '.';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function looksLikeWaitLogin(message: string): boolean {
  return /wait.?login|login|sign.?in|auth|verification|扫码|qr/i.test(message);
}

function findBase64Image(value: unknown): { mimeType: string; data: string } | undefined {
  if (typeof value === 'string') {
    const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (match) {
      return {
        mimeType: match[1],
        data: match[2],
      };
    }

    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findBase64Image(entry);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const imageLikeType = firstString(record.type)?.toLowerCase();
  const direct = firstString(record.imageBase64, record.screenshotBase64, record.base64);
  const structuredImageData = imageLikeType === 'image'
    ? firstString(record.data)
    : undefined;
  const encodedImage = direct ?? structuredImageData;
  if (encodedImage) {
    return {
      mimeType: firstString(record.mimeType) ?? 'image/png',
      data: encodedImage,
    };
  }

  for (const nestedValue of Object.values(record)) {
    const found = findBase64Image(nestedValue);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findImageReference(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const match = value.match(/[A-Za-z]:\\[^\n\r]+\.(png|jpg|jpeg|webp|bmp)/i)
      ?? value.match(/\/[^\n\r]+\.(png|jpg|jpeg|webp|bmp)/i);
    return match?.[0];
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findImageReference(entry);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const found = findImageReference(nestedValue);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function screenshotExtensionForMimeType(mimeType: string): 'png' | 'jpg' {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  return /image\/(pjpeg|jpeg|jpg)\b/.test(normalizedMimeType) ? 'jpg' : 'png';
}

export default WindowsMcpAdapter;
