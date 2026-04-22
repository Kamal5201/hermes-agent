import { EventEmitter } from 'events';
import WebSocket, { RawData } from 'ws';
import log from 'electron-log/main.js';
import type { PerceptionModule, ScreenRegion } from '../perception/PerceptionModule';
import type { LearningEngine } from '../learning/LearningEngine';
import type { SecurityGuard } from '../security/SecurityGuard';
import { PrivacyLevel, type PrivacyPreset } from '../security/PrivacyManager';
import type PrivacyManager from '../security/PrivacyManager';
import type { MouseButtonName } from './ExecutionModule';
import { ExecutionModule } from './ExecutionModule';
import { MessageType, MCPErrorCode, type MCPMessage, type MCPRequest, type MCPResponse } from './Protocol';
import { TOOL_NAME_MAP } from './ToolDefinitions';

export interface ConfigStore {
  get(key: string): Promise<unknown> | unknown;
  set(key: string, value: unknown): Promise<void> | void;
}

export interface MCPHandlerOptions {
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export enum MCPConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
}

type ToolParams = Record<string, unknown>;

export class MCPHandler extends EventEmitter {
  private readonly perception: PerceptionModule;
  private readonly execution: ExecutionModule;
  private readonly learning: LearningEngine;
  private readonly security: SecurityGuard;
  private readonly privacy: PrivacyManager;
  private readonly config: ConfigStore;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;

  private socket: WebSocket | null = null;
  private state = MCPConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private targetUrl: string | null = null;
  private shouldReconnect = false;

  constructor(
    perception: PerceptionModule,
    execution: ExecutionModule,
    learning: LearningEngine,
    security: SecurityGuard,
    privacy: PrivacyManager,
    config: ConfigStore,
    options: MCPHandlerOptions = {},
  ) {
    super();
    this.perception = perception;
    this.execution = execution;
    this.learning = learning;
    this.security = security;
    this.privacy = privacy;
    this.config = config;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
  }

  public getConnectionState(): MCPConnectionState {
    return this.state;
  }

  public async connect(url: string): Promise<MCPConnectionState> {
    this.targetUrl = url;
    this.shouldReconnect = true;

    if (this.socket) {
      this.cleanupSocket();
    }

    await this.createSocket(url);
    return this.state;
  }

  public async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    if (!this.socket) {
      this.updateState(MCPConnectionState.DISCONNECTED);
      return;
    }

    const socket = this.socket;
    this.socket = null;

    socket.removeAllListeners();
    socket.close();

    this.updateState(MCPConnectionState.DISCONNECTED);
  }

  public async send(message: MCPMessage | string): Promise<void> {
    if (!this.socket || this.state !== MCPConnectionState.CONNECTED || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('MCP socket is not connected');
    }

    const payload = typeof message === 'string' ? message : JSON.stringify(message);

    await new Promise<void>((resolve, reject) => {
      this.socket?.send(payload, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async createSocket(url: string): Promise<void> {
    this.updateState(this.reconnectAttempts > 0 ? MCPConnectionState.RECONNECTING : MCPConnectionState.CONNECTING);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.once('open', () => {
        this.reconnectAttempts = 0;
        this.updateState(MCPConnectionState.CONNECTED);
        resolve();
      });

      socket.once('error', (error) => {
        this.emit('error', error);
        log.error('[MCPHandler] WebSocket error', error);

        if (this.state !== MCPConnectionState.CONNECTED) {
          reject(error);
        }
      });

      socket.on('close', (code, reason) => {
        const reasonText = reason.toString() || 'no reason';
        log.warn(`[MCPHandler] Connection closed (${code}): ${reasonText}`);
        this.cleanupSocket();
        this.updateState(MCPConnectionState.DISCONNECTED);

        if (this.shouldReconnect && this.targetUrl) {
          this.scheduleReconnect();
        }
      });

      socket.on('message', (data) => {
        void this.handleIncomingData(data);
      });
    });
  }

  private async handleIncomingData(data: RawData): Promise<void> {
    const messageText = typeof data === 'string' ? data : data.toString();

    let message: MCPMessage;
    try {
      message = JSON.parse(messageText) as MCPMessage;
    } catch (error) {
      const response = this.createErrorResponse(null, MCPErrorCode.ParseError, 'Invalid JSON payload');
      await this.safeSend(response);
      return;
    }

    this.emit('message', message);

    if (message.type !== MessageType.Request || !message.method) {
      return;
    }

    const request = message as MCPRequest;

    try {
      const result = await this.routeToolCall(request.method, request.params ?? {});
      const response: MCPResponse = {
        id: request.id,
        type: MessageType.Response,
        result,
        timestamp: Date.now(),
      };
      await this.safeSend(response);
    } catch (error) {
      const response = this.createErrorResponse(
        request.id,
        MCPErrorCode.InternalError,
        error instanceof Error ? error.message : 'Unknown MCP handler error',
      );
      await this.safeSend(response);
    }
  }

  private async routeToolCall(methodName: string, params: ToolParams): Promise<unknown> {
    const method = TOOL_NAME_MAP[methodName] ?? methodName;

    const securityResult = this.security.checkOperation(method, 'hermes_agent', JSON.stringify(params));
    if (!securityResult.allowed) {
      throw new Error(securityResult.reason ?? 'Security policy rejected the request');
    }

    if (securityResult.requiresConfirmation) {
      throw new Error(`Operation requires confirmation: ${method}`);
    }

    switch (method) {
      case 'perception.capture_screen':
        return this.captureScreen(params);
      case 'perception.get_windows':
        return this.perception.getWindows();
      case 'perception.get_focused_window':
        return this.perception.getFocusedWindow();
      case 'perception.get_running_apps':
        return this.perception.getRunningApps();
      case 'perception.get_mouse_position':
        return this.perception.getMousePosition();
      case 'perception.get_clipboard':
        return this.perception.getClipboard();
      case 'execution.click':
        return this.execution.click(
          this.requireNumber(params, 'x'),
          this.requireNumber(params, 'y'),
          this.getOptionalString(params, 'button', 'left') as MouseButtonName,
        );
      case 'execution.type_text':
        return this.execution.typeText(this.requireString(params, 'text'));
      case 'execution.press_key':
        return this.execution.pressKey(this.requireString(params, 'key'));
      case 'execution.hotkey':
        return this.execution.hotkey(...this.requireStringArray(params, 'keys'));
      case 'execution.open_app':
        return this.execution.openApp(this.requireString(params, 'bundleId'));
      case 'execution.close_app':
        return this.execution.closeApp(this.requireString(params, 'bundleId'));
      case 'learning.get_patterns':
        return this.learning.getPatterns();
      case 'learning.get_prediction':
        return this.getPrediction(params);
      case 'learning.get_user_profile':
        return this.learning.getUserProfile();
      case 'learning.set_feedback':
        return this.setFeedback(params);
      case 'config.config_get':
        return this.config.get(this.requireString(params, 'key'));
      case 'config.config_set':
        await this.config.set(this.requireString(params, 'key'), params.value);
        return {
          key: this.requireString(params, 'key'),
          value: params.value ?? null,
          updatedAt: Date.now(),
        };
      case 'config.set_privacy':
        return this.setPrivacy(params);
      default:
        throw new Error(`Unsupported MCP method: ${methodName}`);
    }
  }

  private async captureScreen(params: ToolParams): Promise<{ data: string; format: string; capturedAt: number }> {
    const regionValue = params.region;
    const format = this.getOptionalString(params, 'format', 'png') as 'png' | 'jpeg' | 'webp';

    let region: ScreenRegion | undefined;
    if (this.isRecord(regionValue)) {
      region = {
        x: this.requireNumber(regionValue, 'x'),
        y: this.requireNumber(regionValue, 'y'),
        width: this.requireNumber(regionValue, 'width'),
        height: this.requireNumber(regionValue, 'height'),
      };
    }

    return {
      data: await this.perception.captureBase64(region, format),
      format,
      capturedAt: Date.now(),
    };
  }

  private async getPrediction(params: ToolParams): Promise<Record<string, unknown>> {
    const currentApp = this.getOptionalString(params, 'currentApp');
    const time = this.getOptionalNumber(params, 'time');
    const recentApps = this.getOptionalStringArray(params, 'recentApps') ?? [];

    return {
      nextApp: await this.learning.predictApp({
        currentApp,
        time,
      }),
      repetition: recentApps.length > 0 ? this.learning.detectRepetition(recentApps) : null,
      generatedAt: Date.now(),
    };
  }

  private async setFeedback(params: ToolParams): Promise<Record<string, unknown>> {
    const feedback = this.getOptionalString(params, 'feedback');

    if (feedback) {
      await this.learning.recordFeedback(
        this.getOptionalString(params, 'predictionType', 'prediction_feedback') ?? 'prediction_feedback',
        this.getOptionalString(params, 'predictedApp', 'unknown') ?? 'unknown',
        this.getOptionalString(params, 'actualApp', 'unknown') ?? 'unknown',
        this.getOptionalString(params, 'context', '{}') ?? '{}',
        feedback as 'accept' | 'reject' | 'modify',
      );

      return {
        accepted: true,
        mode: 'detailed',
        timestamp: Date.now(),
      };
    }

    const predictionId = this.getOptionalString(params, 'predictionId', 'unknown') ?? 'unknown';
    const correct = this.getOptionalBoolean(params, 'correct', false) ?? false;

    await this.learning.recordFeedback(
      'prediction_feedback',
      predictionId,
      correct ? predictionId : 'manual_override',
      JSON.stringify({ predictionId }),
      correct ? 'accept' : 'reject',
    );

    return {
      accepted: true,
      mode: 'simple',
      predictionId,
      correct,
      timestamp: Date.now(),
    };
  }

  private async setPrivacy(params: ToolParams): Promise<Record<string, unknown>> {
    const enabled = this.getOptionalBoolean(params, 'enabled', false) ?? false;
    this.privacy.setPrivacyMode(enabled);

    const bundleId = this.getOptionalString(params, 'bundleId');
    const blocked = this.getOptionalBoolean(params, 'blocked');
    const level = this.getOptionalString(params, 'level');

    if (bundleId && blocked === true) {
      this.privacy.blockApp(bundleId);
    } else if (bundleId && blocked === false) {
      this.privacy.unblockApp(bundleId);
    }

    if (level && Object.values(PrivacyLevel).includes(level as PrivacyLevel)) {
      this.privacy.setPrivacyLevel(level as PrivacyLevel);
    }

    return {
      enabled: this.privacy.getPrivacyMode(),
      level: this.privacy.getPrivacyLevel(),
      presets: this.privacy.getPrivacyPresets().map((preset: PrivacyPreset) => ({
        ...preset,
        allowedDataTypes: [...preset.allowedDataTypes],
      })),
      blockedApps: this.privacy.getBlockedApps(),
      sensitiveApps: this.privacy.getSensitiveApps(),
      updatedAt: Date.now(),
    };
  }

  private createErrorResponse(id: MCPMessage['id'], code: MCPErrorCode, message: string): MCPResponse {
    return {
      id,
      type: MessageType.Response,
      error: {
        code,
        message,
      },
      timestamp: Date.now(),
    };
  }

  private async safeSend(message: MCPResponse): Promise<void> {
    try {
      await this.send(message);
    } catch (error) {
      this.emit('error', error);
      log.error('[MCPHandler] Failed to send MCP response', error);
    }
  }

  private scheduleReconnect(): void {
    if (!this.targetUrl || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(this.reconnectBaseDelayMs * (2 ** (this.reconnectAttempts - 1)), this.reconnectMaxDelayMs);

    this.updateState(MCPConnectionState.RECONNECTING);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (!this.targetUrl) {
        return;
      }

      void this.createSocket(this.targetUrl).catch((error) => {
        this.emit('error', error);
        log.error('[MCPHandler] Reconnect attempt failed', error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
  }

  private updateState(nextState: MCPConnectionState): void {
    if (this.state === nextState) {
      return;
    }

    const previousState = this.state;
    this.state = nextState;
    this.emit('stateChange', nextState, previousState);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private requireString(source: Record<string, unknown>, key: string): string {
    const value = source[key];

    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Missing string parameter: ${key}`);
    }

    return value;
  }

  private getOptionalString(source: Record<string, unknown>, key: string, fallback?: string): string | undefined {
    const value = source[key];

    if (value === undefined) {
      return fallback;
    }

    if (typeof value !== 'string') {
      throw new Error(`Parameter ${key} must be a string`);
    }

    return value;
  }

  private requireNumber(source: Record<string, unknown>, key: string): number {
    const value = source[key];

    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Missing numeric parameter: ${key}`);
    }

    return value;
  }

  private getOptionalNumber(source: Record<string, unknown>, key: string): number | undefined {
    const value = source[key];

    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Parameter ${key} must be a number`);
    }

    return value;
  }

  private getOptionalBoolean(source: Record<string, unknown>, key: string, fallback?: boolean): boolean | undefined {
    const value = source[key];

    if (value === undefined) {
      return fallback;
    }

    if (typeof value !== 'boolean') {
      throw new Error(`Parameter ${key} must be a boolean`);
    }

    return value;
  }

  private requireStringArray(source: Record<string, unknown>, key: string): string[] {
    const value = source[key];

    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error(`Parameter ${key} must be a string array`);
    }

    return value;
  }

  private getOptionalStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
    const value = source[key];

    if (value === undefined) {
      return undefined;
    }

    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error(`Parameter ${key} must be a string array`);
    }

    return value;
  }
}

export default MCPHandler;
