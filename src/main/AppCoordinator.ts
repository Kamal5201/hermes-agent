/**
 * AppCoordinator - 核心协调器
 * 
 * 负责协调所有模块的初始化、生命周期管理和事件路由
 * 是应用的主控制器，连接 PerceptionModule、LearningEngine、ExecutionModule 等
 * 
 * 主要职责：
 * 1. 初始化所有服务模块
 * 2. 管理模块间的通信
 * 3. 处理应用生命周期事件
 * 4. 提供统一的错误处理和恢复机制
 */

import { execFile } from 'node:child_process';
import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'path';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import dotenv from 'dotenv';
import log from 'electron-log/main.js';

import DatabaseManager, { WindowHistory } from '../database/DatabaseManager';
import { LearningEngine } from '../learning/LearningEngine';
import { createNotification, ExecutionModule, MCPHandler, MessageType, type MCPMessage } from '../mcp';
import { PerceptionModule } from '../perception/PerceptionModule';
import { WindowEventPipeline, type WindowEventPayload } from '../perception/WindowEventPipeline';
import { PredictionEngine } from '../prediction/PredictionEngine';
import type { PredictionContext } from '../prediction/PredictionTypes';
import PrivacyManager from '../security/PrivacyManager';
import { SecurityGuard } from '../security/SecurityGuard';
import { CompanionState, StateEngine } from '../state/StateEngine';
import { DeviceRegistry, normalizePlatform, StateSyncManager } from '../sync';
import { AppleStyleUI, UIState, companionStateToUiState } from '../ui/AppleStyleUI';
import { DatabaseConfigStore, setupIpcHandlers } from './ipc-handlers';
import ControlServer, { type ControlInboxMessage, type ControlServerApp } from './ControlServer';
import { getLogger, initializeLogger } from './logger';

// 类型定义
export type AppConfig = {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debugMode: boolean;
  learningIntervalMs: number;
  stateTickMs: number;
  clipboardPollingMs: number;
  overlayWidth: number;
  overlayHeight: number;
  mcpUrl?: string;
  syncUrl?: string;
  syncHeartbeatMs: number;
  /** 窗口事件管道配置 */
  windowPipelineEnabled: boolean;
  windowPipelineSamplingMs: number;
};

export type RuntimeSignals = {
  sessionStartedAt: number;
  lastClipboardChangeAt: number | null;
  activeUntil: number | null;
  errorCount: number;
};

export type AppCoordinatorServices = {
  db: DatabaseManager;
  perception: PerceptionModule;
  execution: ExecutionModule;
  state: StateEngine;
  learning: LearningEngine;
  prediction: PredictionEngine;
  security: SecurityGuard;
  privacy: PrivacyManager;
  config: DatabaseConfigStore;
  mcp: MCPHandler;
  sync: StateSyncManager;
  deviceRegistry: DeviceRegistry;
  ui: AppleStyleUI;
};

type ChatSpeaker = 'user' | 'hermes' | 'system';

// 导出类型供外部使用 - 使用命名导出

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// 加载环境配置
function loadEnvConfig(): AppConfig {
  return {
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
    debugMode: process.env.DEBUG_MODE === 'true',
    learningIntervalMs: Number(process.env.LEARNING_INTERVAL_MS ?? 3_600_000),
    stateTickMs: Number(process.env.STATE_TICK_MS ?? 5_000),
    clipboardPollingMs: Number(process.env.CLIPBOARD_POLLING_MS ?? 1_000),
    overlayWidth: Number(process.env.OVERLAY_WIDTH ?? 320),
    overlayHeight: Number(process.env.OVERLAY_HEIGHT ?? 200),
    mcpUrl: process.env.HERMES_MCP_URL,
    syncUrl: process.env.HERMES_SYNC_URL,
    syncHeartbeatMs: Number(process.env.HERMES_SYNC_HEARTBEAT_MS ?? 30_000),
    windowPipelineEnabled: process.env.WINDOW_PIPELINE_ENABLED !== 'false',
    windowPipelineSamplingMs: Number(process.env.WINDOW_PIPELINE_SAMPLING_MS ?? 1000),
  };
}

/**
 * AppCoordinator - 应用核心协调器
 * 
 * 使用单例模式管理整个应用的生命周期
 */
export class AppCoordinator extends EventEmitter implements ControlServerApp {
  private static instance: AppCoordinator | null = null;
  
  private readonly config: AppConfig;
  private readonly logger: ReturnType<typeof getLogger>;
  
  private mainWindow: BrowserWindow | null = null;
  private services: AppCoordinatorServices | null = null;
  private windowPipeline: WindowEventPipeline | null = null;
  private controlServer: ControlServer | null = null;
  private stateTicker: NodeJS.Timeout | null = null;
  private runtimeSignals: RuntimeSignals;
  private isShuttingDown = false;
  private isInitialized = false;
  private errorRecoveryInitialized = false;
  private lastLearningSyncAt = 0;
  private lastPredictionSyncAt = 0;
  private inbox: ControlInboxMessage[] = [];
  /** 待处理的敏感操作确认（Promise resolve/reject） */
  private pendingConfirmation: {
    action: string;
    params: Record<string, unknown>;
    resolve: (confirmed: boolean) => void;
  } | null = null;

  private constructor() {
    super();
    
    // 加载环境变量
    dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env') });
    
    // 初始化日志
    this.config = loadEnvConfig();
    initializeLogger({
      appName: 'Hermes Companion',
      level: this.config.logLevel,
    });
    
    this.logger = getLogger('AppCoordinator');
    this.runtimeSignals = this.createRuntimeSignals();
    this.setupErrorRecovery();
    
    log.info('AppCoordinator instance created');
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): AppCoordinator {
    if (!AppCoordinator.instance) {
      AppCoordinator.instance = new AppCoordinator();
    }
    return AppCoordinator.instance;
  }

  /**
   * 获取配置
   */
  public getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * 获取运行时信号
   */
  public getRuntimeSignals(): RuntimeSignals {
    return { ...this.runtimeSignals };
  }

  /**
   * 获取服务实例
   */
  public getServices(): AppCoordinatorServices | null {
    return this.services;
  }

  /**
   * 检查是否已初始化
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * 启动应用
   */
  async bootstrap(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('AppCoordinator already initialized');
      return;
    }

    this.logger.info('Starting Hermes Companion bootstrap...');

    console.error('[AppCoordinator] Bootstrap starting...');
    try {
      // 初始化服务
      this.services = this.initializeServices();
      console.error('[AppCoordinator] Services initialized');

      // 创建主窗口
      console.error('[AppCoordinator] About to create main window');
      this.mainWindow = this.createMainWindow();
      console.error('[AppCoordinator] Main window created:', !!this.mainWindow);

      await this.startControlServer();
      this.registerGlobalHotkey();
      
      // 连接 MCP
      if (this.config.mcpUrl) {
        await this.connectMcp();
      }

      if (this.config.syncUrl) {
        await this.connectSync();
      }
      
      // 广播初始状态
      this.broadcastState();
      
      this.isInitialized = true;
      this.emit('ready');
      
      this.logger.info('Bootstrap complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Bootstrap failed', errorMessage);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * 关闭应用
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    this.emit('shutdown:start');

    this.logger.info('Initiating shutdown...');

    // 停止状态循环
    this.stopStateLoop();
    this.windowPipeline?.stop();
    this.windowPipeline = null;
    globalShortcut.unregisterAll();

    if (this.controlServer) {
      try {
        await this.controlServer.stop();
      } catch (error) {
        this.logger.error('Error stopping control server', error);
      }
      this.controlServer = null;
    }

    if (this.services) {
      try {
        this.services.learning.stopContinuousLearning();
        this.services.perception.dispose();
        await this.services.mcp.disconnect();
        await this.services.sync.disconnect();
      } catch (error) {
        this.logger.error('Error during service shutdown', error);
      }

      try {
        this.services.db.close();
      } catch (error) {
        this.logger.error('Error closing database', error);
      }

      DatabaseManager.resetInstance();
      this.services = null;
    }

    this.isInitialized = false;
    this.emit('shutdown:complete');
    
    this.logger.info('Shutdown complete');
  }

  /**
   * 激活伴侣(ANOTHER_WINDOW_FOCUSED 或任务模式)
   */
  activateCompanion(reason: string): void {
    if (!this.services) {
      return;
    }

    this.runtimeSignals.activeUntil = Date.now() + 10_000;
    if (this.services.state.getCurrentState() !== CompanionState.ACTIVE) {
      this.services.state.forceTransition(CompanionState.ACTIVE, reason);
    } else {
      this.syncWindowBounds(UIState.ACTIVE);
      this.updateWindowInteractivity(UIState.ACTIVE);
    }
    this.emit('companion:activated', reason);
  }

  /**
   * 获取主窗口
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /**
   * 确保主窗口存在并显示
   */
  async ensureMainWindow(): Promise<BrowserWindow | null> {
    if (!this.isInitialized) {
      await this.bootstrap();
      return this.mainWindow;
    }

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.mainWindow = this.createMainWindow();
      this.broadcastState();
      return this.mainWindow;
    }

    this.mainWindow.showInactive();
    this.broadcastState();
    return this.mainWindow;
  }

  public addToInbox(message: ControlInboxMessage): void {
    this.inbox.push(message);

    if (this.inbox.length > 50) {
      this.inbox.splice(0, this.inbox.length - 50);
    }
  }

  public popInbox(): ControlInboxMessage[] {
    const messages = [...this.inbox];
    this.inbox = [];
    return messages;
  }

  public async handleControlCommand(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    // 无感授权：图形控制仅在 ACTIVE 状态下允许（乔布斯哲学：状态本身即授权）
    const graphicalCommands = ['goto', 'click', 'type', 'screenshot'];
    if (graphicalCommands.includes(action)) {
      this.requireGuiControlAuthorized();
    }

    // 如果是敏感操作（删除、渗透、推送、发截图给第三方），需要用户语音确认
    const isConfirmed = params.confirmed === true;
    if (this.requiresVoiceConfirmation(action, params) && !isConfirmed) {
      // 先问用户，拿到确认后再执行
      const confirmed = await this.requestVoiceConfirmation(action, params);
      if (!confirmed) {
        const err = new Error('User rejected sensitive operation') as Error & { code?: string };
        err.code = 'CONFIRMATION_REJECTED';
        throw err;
      }
    }

    switch (action) {
      case 'getState':
        return this.getCurrentStatePayload();
      case 'setState':
        return this.setCompanionState(params.state);
      case 'goto':
        return this.moveWindow(this.requireNumber(params, 'x'), this.requireNumber(params, 'y'));
      case 'click':
        return this.clickAt(
          this.requireNumber(params, 'x'),
          this.requireNumber(params, 'y'),
          this.optionalString(params, 'button'),
        );
      case 'type':
        return this.typeText(this.requireString(params, 'text'));
      case 'screenshot':
        return this.takeScreenshot();
      case 'displayMessage':
        return this.displayMessage(
          this.requireString(params, 'text'),
          this.optionalString(params, 'speaker') as ChatSpeaker | undefined,
        );
      case 'speak':
        return this.speak(this.requireString(params, 'text'));
      default:
        throw new Error(`Unsupported control action: ${action}`);
    }
  }

  // ============ 私有方法 ============

  private createRuntimeSignals(): RuntimeSignals {
    return {
      sessionStartedAt: Date.now(),
      lastClipboardChangeAt: null,
      activeUntil: null,
      errorCount: 0,
    };
  }

  private initializeServices(): AppCoordinatorServices {
    const databaseDir = app.getPath('userData');
    const databasePath = path.join(databaseDir, 'hermes.db');
    const db = DatabaseManager.getInstance(databasePath);
    db.initialize();

    const perception = new PerceptionModule();
    const execution = new ExecutionModule();
    const state = new StateEngine(CompanionState.STEALTH);
    const learning = new LearningEngine(db);
    const prediction = PredictionEngine.getInstance(learning, db);
    const security = SecurityGuard.getInstance();
    const privacy = PrivacyManager.getInstance();
    const config = new DatabaseConfigStore(db);
    const mcp = new MCPHandler(perception, execution, learning, security, privacy, config);
    const deviceRegistry = new DeviceRegistry(config, {
      deviceName: `${app.getName()}-${process.platform}`,
      platform: normalizePlatform(process.platform),
      capabilities: ['state_sync', 'learning_cycle', 'mcp'],
    });
    const sync = new StateSyncManager(deviceRegistry, {
      connection: {
        url: this.config.syncUrl ?? '',
        reconnect: true,
        heartbeat: this.config.syncHeartbeatMs,
      },
      getLocalState: () => ({
        state: state.getCurrentState(),
        metadata: {
          learningDay: learning.getCurrentLearningDay(),
          mcpConnectionState: mcp.getConnectionState(),
          errorCount: this.runtimeSignals.errorCount,
        },
      }),
    });
    const ui = AppleStyleUI.getInstance();
    this.windowPipeline = this.config.windowPipelineEnabled
      ? new WindowEventPipeline(perception, db, {
          samplingIntervalMs: this.config.windowPipelineSamplingMs,
          recordToDatabase: true,
        })
      : null;

    // 设置 IPC 处理器
    setupIpcHandlers(
      perception,
      execution,
      state,
      learning,
      mcp,
      security,
      config,
      sync,
      deviceRegistry,
      {
        onChatSend: async (text: string) => this.handleChatSend(text),
      },
    );

    // 初始化服务
    const services: AppCoordinatorServices = {
      db,
      perception,
      execution,
      state,
      learning,
      prediction,
      security,
      privacy,
      config,
      mcp,
      sync,
      deviceRegistry,
      ui,
    };

    this.setupEventFlow(services);
    // 绑定服务事件
    this.wireServiceEvents(services);
    this.windowPipeline?.start();
    
    // 启动持续学习
    learning.startContinuousLearning(this.config.learningIntervalMs);
    
    // 启动状态循环
    this.startStateLoop(services);

    return services;
  }

  private setupEventFlow(services: AppCoordinatorServices): void {
    if (this.windowPipeline) {
      this.windowPipeline.on('window:event', (event: { type: string; payload: WindowEventPayload; timestamp: number }) => {
        void this.handleWindowEventFlow(event.type, event.payload, services);
      });
    }

    // 状态 -> UI
    services.state.onStateChange((nextState, previousState) => {
      this.logger.info(`State changed: ${previousState} -> ${nextState}`);

      if (nextState === CompanionState.RETREATING) {
        setTimeout(() => {
          if (!this.services || this.services.state.getCurrentState() !== CompanionState.RETREATING) {
            return;
          }
          this.services.state.forceTransition(CompanionState.STEALTH, 'retreat animation completed');
        }, 300);
      }

      this.broadcastState(nextState, previousState);
    });
  }

  private wireServiceEvents(services: AppCoordinatorServices): void {
    // 感知模块 - 剪贴板监控
    services.perception.startMonitoring(() => {
      this.runtimeSignals.lastClipboardChangeAt = Date.now();
    }, this.config.clipboardPollingMs);

    // MCP 处理器 - 消息
    services.mcp.on('message', (message: MCPMessage) => {
      this.forwardMcpMessage(message);

      if (message.type === MessageType.Request) {
        this.activateCompanion('MCP request');
      }
    });

    // MCP 处理器 - 状态变化
    services.mcp.on('stateChange', (currentState: string, previousState: string) => {
      this.forwardMcpMessage(createNotification('mcp.stateChange', {
        currentState,
        previousState,
      }));
    });

    // MCP 处理器 - 错误
    services.mcp.on('error', (error: unknown) => {
      this.runtimeSignals.errorCount += 1;
      this.logger.error('MCP error', error);
    });

    services.sync.on('deviceRegistered', (device) => {
      void Promise.resolve(services.config.set('sync_devices', services.deviceRegistry.listDevices()))
        .catch((error: unknown) => {
          this.logger.warn('Failed to persist sync device registry', error);
        });

      this.logger.info(`Sync device registered: ${device.deviceName}`);
    });

    services.sync.on('stateResolved', (record) => {
      void Promise.resolve(services.config.set('sync_last_resolved_state', record))
        .catch((error: unknown) => {
          this.logger.warn('Failed to persist sync state resolution', error);
        });
    });

    services.sync.on('error', (error: unknown) => {
      this.runtimeSignals.errorCount += 1;
      this.logger.error('State sync error', error);
    });
  }

  private async handleWindowEventFlow(
    type: string,
    payload: WindowEventPayload,
    services: AppCoordinatorServices
  ): Promise<void> {
    const timestamp = Date.now();

    await Promise.resolve(services.config.set('last_window_event', {
      type,
      payload,
      timestamp,
    })).catch((error: unknown) => {
      this.logger.warn('Failed to persist window event', error);
    });

    if (type === 'window:focused' || type === 'window:opened') {
      this.runtimeSignals.activeUntil = timestamp + 5_000;
      services.state.updateContext({
        userActivity: 1,
        lastActivityTimestamp: timestamp,
        attentionNeeded: true,
      });

      await this.syncLearningFromPerception(services, type, payload);
      await this.syncPredictionFromPerception(services, payload);
      return;
    }

    if (type === 'window:unfocused' || type === 'window:closed') {
      services.state.updateContext({
        userActivity: 0,
        lastActivityTimestamp: timestamp,
      });
    }
  }

  private async syncLearningFromPerception(
    services: AppCoordinatorServices,
    trigger: string,
    payload: WindowEventPayload
  ): Promise<void> {
    const now = Date.now();

    if (now - this.lastLearningSyncAt < 60_000) {
      return;
    }

    this.lastLearningSyncAt = now;

    try {
      const executedDays = await services.learning.runScheduledCycle();
      if (executedDays.length === 0) {
        await services.learning.day1_BasicCollection();
      }

      const patterns = services.learning.getPatterns();
      const cycleStatus = services.learning.getCycleStatus();

      await Promise.resolve(services.config.set('learning_snapshot', {
        trigger,
        updatedAt: now,
        appName: payload.appName,
        learningDay: cycleStatus.currentDay,
        cycleCompletedDays: cycleStatus.completedDays,
        currentLearningRate: cycleStatus.currentLearningRate,
        patternsDiscovered: patterns.timePatterns.length + patterns.operationPatterns.length,
        habitsFormed: patterns.habits.length,
      }));
    } catch (error) {
      this.logger.warn('Learning sync from perception failed', error);
    }
  }

  private async syncPredictionFromPerception(
    services: AppCoordinatorServices,
    payload: WindowEventPayload
  ): Promise<void> {
    const now = Date.now();

    if (now - this.lastPredictionSyncAt < 15_000) {
      return;
    }

    this.lastPredictionSyncAt = now;

    const context: PredictionContext = {
      timeOfDay: this.getTimeOfDay(now),
      currentApp: payload.appName,
      recentOperations: [payload.title],
      attentionScore: 0.8,
      dayOfWeek: new Date(now).getDay(),
      currentWindow: payload.title,
      idleTimeSeconds: 0,
    };

    try {
      const predictions = await services.prediction.predict(context);

      await Promise.resolve(services.config.set('last_prediction', {
        updatedAt: now,
        context,
        predictions,
      }));
    } catch (error) {
      this.logger.warn('Prediction sync from perception failed', error);
    }
  }

  private createMainWindow(): BrowserWindow {
    console.error('[AppCoordinator] createMainWindow called');
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.max(16, width - this.config.overlayWidth - 24);
    const y = Math.max(16, height - this.config.overlayHeight - 24);

    const preloadPath = this.resolvePreloadFile();
    console.error('[AppCoordinator] Preload path resolved:', preloadPath);

    const window = new BrowserWindow({
      width: this.config.overlayWidth,
      height: this.config.overlayHeight,
      x,
      y,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      movable: true,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.resolvePreloadFile(),
        nodeIntegration: false,
        contextIsolation: true,
        // Keep sandbox disabled because the desktop automation stack relies on
        // native modules such as nut-js/node-pty that are not compatible with
        // Electron's fully sandboxed renderer environment in this app shape.
        sandbox: false,
        webSecurity: true,
      },
    });

    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(true, { forward: true });

    window.once('ready-to-show', () => {
      window.showInactive();

      if (this.config.debugMode) {
        window.webContents.openDevTools({ mode: 'detach' });
      }
    });

    window.webContents.on('did-finish-load', () => {
      this.logger.info('Renderer ready');
      this.broadcastState();
    });

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      this.logger.error(`Renderer failed to load (${errorCode})`, errorDescription);
    });

    window.on('closed', () => {
      this.mainWindow = null;
    });

    void window.loadFile(this.resolveRendererFile());
    
    return window;
  }

  private resolveRendererFile(): string {
    const candidates = [
      path.resolve(PROJECT_ROOT, 'dist/renderer/index.html'),
      path.resolve(PROJECT_ROOT, 'src/renderer/index.html'),
      path.join(app.getAppPath(), 'src/renderer/index.html'),
    ];

    for (const candidate of candidates) {
      const exists = existsSync(candidate);
      console.error(`[AppCoordinator] Trying renderer path: ${candidate} exists=${exists}`);
      if (exists) {
        return candidate;
      }
    }

    throw new Error(`Unable to resolve renderer/index.html. Looked: ${candidates.join(', ')}`);
  }

  private resolvePreloadFile(): string {
    const preloadPath = path.join(app.getAppPath(), 'dist/preload/index.js');
    console.error('[AppCoordinator] Checking preload path:', preloadPath, 'exists=', existsSync(preloadPath));

    if (!existsSync(preloadPath)) {
      throw new Error(`Preload bundle not found: ${preloadPath}. Run TypeScript build first.`);
    }

    return preloadPath;
  }

  private async startControlServer(): Promise<void> {
    if (!this.controlServer) {
      this.controlServer = new ControlServer(this);
    }

    await this.controlServer.start();
  }

  private registerGlobalHotkey(): void {
    const accelerator = 'CommandOrControl+Shift+H';

    globalShortcut.unregister(accelerator);
    const registered = globalShortcut.register(accelerator, () => {
      void this.openChatSurface('global shortcut', {
        focusWindow: true,
        focusInput: true,
      });
    });

    if (!registered) {
      this.logger.warn(`Failed to register global shortcut: ${accelerator}`);
      return;
    }

    this.logger.info(`Registered global shortcut: ${accelerator}`);
  }

  private async handleChatSend(text: string): Promise<void> {
    const message = text.trim();
    if (!message) {
      return;
    }

    this.addToInbox({
      type: 'chat',
      text: message,
      timestamp: Date.now(),
    });
    this.logger.info(`[Chat] User said: ${message}`);

    await this.openChatSurface('user chat', {
      focusInput: false,
      focusWindow: false,
    });
    this.displayChatMessage(message, 'user');
  }

  // ─── Public API for ControlServer / SelfTestEngine ──────────────────────

  /** 返回当前状态字符串（供 SelfTestEngine 使用） */
  public getCurrentState(): string {
    return this.services?.state?.getCurrentState() ?? 'UNKNOWN';
  }

  /** 强制切换状态（供 SelfTestEngine 使用） */
  public forceState(state: string): void {
    if (!this.services?.state) return;
    this.services.state.forceTransition(state as CompanionState, 'self-test');
  }

  private getCurrentStatePayload(): {
    state: string;
    previousState?: string;
    ui: ReturnType<AppleStyleUI['render']>;
    timestamp: number;
  } {
    if (!this.services) {
      throw new Error('Services are not initialized');
    }

    return this.createStatePayload(
      this.services.state.getCurrentState(),
      this.services.state.getLastState() ?? undefined,
    );
  }

  private async setCompanionState(rawState: unknown): Promise<unknown> {
    if (!this.services) {
      throw new Error('Services are not initialized');
    }

    const nextState = this.parseCompanionState(rawState);
    if (!nextState) {
      throw new Error(`Invalid companion state: ${String(rawState)}`);
    }

    if (nextState === CompanionState.ACTIVE) {
      await this.openChatSurface('control server setState', {
        focusInput: false,
        focusWindow: false,
      });
      return this.getCurrentStatePayload();
    }

    if (this.services.state.getCurrentState() !== nextState) {
      this.services.state.forceTransition(nextState, 'control server setState');
    } else {
      this.broadcastState(nextState, this.services.state.getLastState() ?? undefined);
    }

    return this.getCurrentStatePayload();
  }

  public async moveWindow(x: number, y: number): Promise<unknown> {
    const window = await this.ensureMainWindow();
    if (!window || window.isDestroyed()) {
      throw new Error('Main window is unavailable');
    }

    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const nextX = this.clamp(Math.round(x), workArea.x, workArea.x + workArea.width - bounds.width);
    const nextY = this.clamp(Math.round(y), workArea.y, workArea.y + workArea.height - bounds.height);

    window.setPosition(nextX, nextY);
    return {
      moved: true,
      bounds: window.getBounds(),
    };
  }

  public async clickAt(x: number, y: number, button?: string): Promise<unknown> {
    if (!this.services) {
      throw new Error('Services are not initialized');
    }

    const mouseButton = button === 'middle' || button === 'right' || button === 'left'
      ? button
      : 'left';

    return this.services.execution.click(x, y, mouseButton);
  }

  public async typeText(text: string): Promise<unknown> {
    if (!this.services) {
      throw new Error('Services are not initialized');
    }

    return this.services.execution.typeText(text);
  }

  public async takeScreenshot(): Promise<unknown> {
    if (!this.services) {
      throw new Error('Services are not initialized');
    }

    const data = await this.services.perception.captureBase64OnDemand(undefined, 'png');
    return {
      data,
      format: 'png',
      capturedAt: Date.now(),
    };
  }

  public async displayMessage(text: string, speaker: ChatSpeaker = 'hermes'): Promise<unknown> {
    const message = text.trim();
    if (!message) {
      throw new Error('Display message text cannot be empty');
    }

    await this.openChatSurface('display message', {
      focusInput: false,
      focusWindow: false,
    });
    this.displayChatMessage(message, speaker);

    return {
      displayed: true,
      speaker,
      text: message,
      timestamp: Date.now(),
    };
  }

  public async speak(text: string): Promise<unknown> {
    const message = text.trim();
    if (!message) {
      return { spoken: false, reason: 'empty_text' };
    }

    if (process.platform !== 'darwin') {
      this.logger.warn('TTS skipped: macOS say command is unavailable on this platform');
      return { spoken: false, reason: 'unsupported_platform' };
    }

    await new Promise<void>((resolve, reject) => {
      execFile('say', [message], (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return {
      spoken: true,
      text: message,
      timestamp: Date.now(),
    };
  }

  private async openChatSurface(
    reason: string,
    options: { focusWindow: boolean; focusInput: boolean },
  ): Promise<BrowserWindow | null> {
    const window = await this.ensureMainWindow();
    if (!window || window.isDestroyed() || !this.services) {
      return window;
    }

    this.runtimeSignals.activeUntil = Date.now() + 10_000;

    if (this.services.state.getCurrentState() !== CompanionState.ACTIVE) {
      this.services.state.forceTransition(CompanionState.ACTIVE, reason);
    } else {
      this.syncWindowBounds(UIState.ACTIVE);
      this.updateWindowInteractivity(UIState.ACTIVE);
    }

    if (options.focusWindow) {
      window.show();
      window.focus();
    } else {
      window.showInactive();
    }

    if (options.focusInput) {
      window.webContents.send('chat:focus-input');
    }

    return window;
  }

  private displayChatMessage(text: string, speaker: ChatSpeaker): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send('chat:message', {
      text,
      speaker,
      timestamp: Date.now(),
    });
  }

  private async connectMcp(): Promise<void> {
    if (!this.services || !this.config.mcpUrl) {
      return;
    }

    try {
      await this.services.mcp.connect(this.config.mcpUrl);
      this.logger.info('MCP connected');
    } catch (error) {
      this.logger.warn('MCP connection failed', error);
    }
  }

  private async connectSync(): Promise<void> {
    if (!this.services || !this.config.syncUrl) {
      return;
    }

    try {
      await this.services.sync.connect({
        url: this.config.syncUrl,
        heartbeat: this.config.syncHeartbeatMs,
      });
      await this.services.sync.broadcastState();
      this.logger.info('State sync connected');
    } catch (error) {
      this.logger.warn('State sync connection failed', error);
    }
  }

  private startStateLoop(services: AppCoordinatorServices): void {
    this.stopStateLoop();

    this.stateTicker = setInterval(() => {
      void this.refreshStateContext(services);
    }, this.config.stateTickMs);

    void this.refreshStateContext(services);
  }

  private stopStateLoop(): void {
    if (this.stateTicker) {
      clearInterval(this.stateTicker);
      this.stateTicker = null;
    }
  }

  private async refreshStateContext(services: AppCoordinatorServices): Promise<void> {
    const now = Date.now();
    const clipboardChanged = this.runtimeSignals.lastClipboardChangeAt !== null
      && now - this.runtimeSignals.lastClipboardChangeAt < 15_000;
    const taskActive = this.runtimeSignals.activeUntil !== null
      && this.runtimeSignals.activeUntil > now;

    let hasFocusedWindow = false;
    try {
      hasFocusedWindow = Boolean(await services.perception.getFocusedWindow());
    } catch (error) {
      this.runtimeSignals.errorCount += 1;
      this.logger.warn('Failed to sample focused window', error);
    }

    services.state.updateContext({
      userActivity: taskActive ? 0 : hasFocusedWindow ? 1 : 0,
      lastActivityTimestamp: hasFocusedWindow ? now : now - 31_000,
      taskActive,
      attentionNeeded: clipboardChanged || taskActive,
      systemLoad: 0,
      errorCount: this.runtimeSignals.errorCount,
      sessionDuration: now - this.runtimeSignals.sessionStartedAt,
      manualOverride: taskActive,
      clipboardChanged,
      screenCaptureAvailable: true,
    });

    services.state.tick();
  }

  private broadcastState(state?: CompanionState, previousState?: CompanionState): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.services) {
      return;
    }

    const payload = this.createStatePayload(state, previousState);
    this.mainWindow.webContents.send('state:changed', payload);

    void this.services.sync.broadcastState({
      state: payload.state,
      metadata: {
        previousState: payload.previousState,
        uiState: payload.ui.state,
      },
    }).catch((error: unknown) => {
      this.logger.debug('State sync broadcast skipped', error);
    });
  }

  private createStatePayload(
    state = this.services?.state.getCurrentState() ?? CompanionState.STEALTH,
    previousState?: CompanionState
  ): {
    state: string;
    previousState?: string;
    ui: ReturnType<AppleStyleUI['render']>;
    timestamp: number;
  } {
    if (!this.services) {
      throw new Error('Services are not initialized');
    }

    const uiState = companionStateToUiState(state);

    switch (uiState) {
      case UIState.STEALTH:
        this.services.ui.hide();
        break;
      case UIState.OBSERVING:
        this.services.ui.updateState(UIState.OBSERVING);
        break;
      case UIState.HINT:
        this.services.ui.showHint('我注意到你在重复一个动作，需要我替你接下一步吗？');
        break;
      case UIState.ACTIVE:
        this.services.ui.showActive('Hermes 已接管当前协作节奏。');
        break;
      case UIState.RETREATING:
        this.services.ui.showRetreat();
        break;
      default:
        this.services.ui.hide();
    }

    this.updateWindowInteractivity(uiState);

    const ui = this.services.ui.render(uiState, {
      reason: previousState ? `${previousState} -> ${state}` : state,
    });

    return {
      state,
      previousState,
      ui,
      timestamp: Date.now(),
    };
  }

  private forwardMcpMessage(message: MCPMessage): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send('mcp:message', message);
  }

  private updateWindowInteractivity(uiState: UIState): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.syncWindowBounds(uiState);

    const interactive = uiState === UIState.HINT || uiState === UIState.ACTIVE;
    this.mainWindow.setFocusable(interactive);
    this.mainWindow.setIgnoreMouseEvents(!interactive, { forward: !interactive });
  }

  private syncWindowBounds(uiState: UIState): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const currentBounds = this.mainWindow.getBounds();
    const targetWidth = uiState === UIState.ACTIVE
      ? Math.max(this.config.overlayWidth, 360)
      : this.config.overlayWidth;
    const targetHeight = uiState === UIState.ACTIVE
      ? Math.max(this.config.overlayHeight, 420)
      : this.config.overlayHeight;

    if (currentBounds.width === targetWidth && currentBounds.height === targetHeight) {
      return;
    }

    const display = screen.getDisplayMatching(currentBounds);
    const workArea = display.workArea;
    const rightEdge = currentBounds.x + currentBounds.width;
    const bottomEdge = currentBounds.y + currentBounds.height;
    const nextX = this.clamp(
      rightEdge - targetWidth,
      workArea.x,
      workArea.x + workArea.width - targetWidth,
    );
    const nextY = this.clamp(
      bottomEdge - targetHeight,
      workArea.y,
      workArea.y + workArea.height - targetHeight,
    );

    this.mainWindow.setBounds(
      {
        x: nextX,
        y: nextY,
        width: targetWidth,
        height: targetHeight,
      },
      true,
    );
  }

  private setupErrorRecovery(): void {
    if (this.errorRecoveryInitialized) {
      return;
    }

    process.on('uncaughtException', (error: Error) => {
      this.runtimeSignals.errorCount += 1;
      this.logger.error('Uncaught exception', error);
      this.notifyError(error);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      this.runtimeSignals.errorCount += 1;
      this.logger.error('Unhandled rejection', reason);
      this.notifyError(reason);
    });

    this.errorRecoveryInitialized = true;
  }

  private notifyError(error: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('app:error', {
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    }
  }

  private getTimeOfDay(timestamp: number): PredictionContext['timeOfDay'] {
    const hour = new Date(timestamp).getHours();

    if (hour >= 6 && hour < 12) {
      return 'morning';
    }
    if (hour >= 12 && hour < 18) {
      return 'afternoon';
    }
    if (hour >= 18 && hour < 22) {
      return 'evening';
    }
    return 'night';
  }

  private parseCompanionState(value: unknown): CompanionState | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toUpperCase();
    return (Object.values(CompanionState) as string[]).includes(normalized)
      ? normalized as CompanionState
      : null;
  }

  /**
   * 无感授权检查（乔布斯哲学：ACTIVE 状态本身即授权）
   *
   * 分层授权：
   * - 图形控制命令（goto/click/type/screenshot）仅在 ACTIVE 状态下允许
   * - 敏感操作（渗透、删除、改配置、发截图给第三方）需要用户语音确认
   * - 日常操作（打开应用、浏览网页、移动窗口）直接执行
   *
   * 用户切换到 ACTIVE = 授权开启；离开 ACTIVE = 授权自动收回
   */
  private requireGuiControlAuthorized(): void {
    const state = this.services?.state?.getCurrentState();
    if (state !== CompanionState.ACTIVE) {
      const err = new Error(`GUI control requires ACTIVE state (current: ${state})`) as Error & { code?: string };
      err.code = 'UNAUTHORIZED';
      throw err;
    }
  }

  /**
   * 检查命令是否需要额外语音确认
   * 敏感操作返回 true，需要先问用户
   */
  private requiresVoiceConfirmation(action: string, params: Record<string, unknown>): boolean {
    const sensitivePatterns = [
      'pentest', 'scan', 'exploit', '攻', '渗', '黑',
      'delete', 'remove', 'destroy', 'drop', '删除',
      'sudo', 'rm ', 'rmdir', 'format',
      'push', 'commit --amend', 'force push',
      'send_to_thirdparty', 'share_screen', 'broadcast',
    ];

    const actionLower = action.toLowerCase();
    const paramStr = JSON.stringify(params).toLowerCase();

    for (const pattern of sensitivePatterns) {
      if (actionLower.includes(pattern) || paramStr.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 处理需要语音确认的命令
   * 显示确认提示并等待用户回复
   */
  private async requestVoiceConfirmation(action: string, params: Record<string, unknown>): Promise<boolean> {
    const descriptions: Record<string, string> = {
      'pentest': '执行渗透测试',
      'delete': `删除目标：${params.url ?? params.target ?? '未知'}`,
      'push': '推送代码更改',
      'sudo': '以管理员权限执行命令',
      'send_to_thirdparty': '将内容发送给第三方',
    };

    const description = descriptions[action] ?? `${action} (${JSON.stringify(params)})`;

    // 显示确认消息
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send('chat:message', {
        text: `⚠️ 确认：${description}，回复"是"继续，"否"取消`,
        speaker: 'system',
      });
    }

    // 语音朗读确认请求
    this.speak(`请确认：${description}，回复"是"继续，"否"取消`);

    // 等待用户在下一次 inbox 消息里回复
    return new Promise<boolean>((resolve) => {
      this.pendingConfirmation = { action, params, resolve };

      // 30 秒超时自动取消
      setTimeout(() => {
        if (this.pendingConfirmation?.resolve === resolve) {
          this.pendingConfirmation = null;
          resolve(false);
        }
      }, 30_000);
    });
  }

  /**
   * 处理来自收件箱的用户消息。
   * 如果有待处理的敏感操作确认，分发到对应的 resolve；
   * 否则作为普通聊天消息添加到 inbox。
   */
  public async handleIncomingUserMessage(text: string): Promise<void> {
    if (!this.pendingConfirmation) {
      // 没有待确认的敏感操作 → 普通聊天消息
      // 注意：消息已被 popInbox() 取出，不需要再 addToInbox，直接显示即可
      const win = this.mainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send('chat:message', { text: `你: ${text}`, speaker: 'user' });
      }
      this.speak(`收到: ${text}`);
      return;
    }

    // 有待确认的敏感操作
    const lower = text.toLowerCase().trim();
    const isConfirm = ['是', '确认', 'ok', 'yes', 'y', '好的', '好', '执行', '继续'].includes(lower);
    const isReject = ['否', '不', 'no', 'n', '取消', '拒绝', '算了'].includes(lower);

    if (isConfirm || isReject) {
      const pending = this.pendingConfirmation;
      this.pendingConfirmation = null;

      const win = this.mainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send('chat:message', {
          text: isConfirm ? '✅ 确认执行' : '❌ 已取消',
          speaker: 'system',
        });
      }
      this.speak(isConfirm ? '确认执行' : '已取消');

      if (isConfirm) {
        try {
          await this.handleControlCommand(pending.action, { ...pending.params, confirmed: true });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (win && !win.isDestroyed()) {
            win.webContents.send('chat:message', { text: `执行失败: ${msg}`, speaker: 'system' });
          }
        }
      }
    } else {
      // 用户说了别的话，提醒他
      const win = this.mainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send('chat:message', {
          text: '请回复"是"继续或"否"取消',
          speaker: 'system',
        });
      }
      this.speak('请回复是继续，否取消');
    }
  }

  private requireString(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Missing required string parameter: ${key}`);
    }

    return value.trim();
  }

  private optionalString(params: Record<string, unknown>, key: string): string | undefined {
    const value = params[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private requireNumber(params: Record<string, unknown>, key: string): number {
    const value = params[key];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Missing required numeric parameter: ${key}`);
    }

    return value;
  }

  private clamp(value: number, min: number, max: number): number {
    if (max < min) {
      return min;
    }

    return Math.min(max, Math.max(min, value));
  }
}

// 导出单例获取函数
export function getAppCoordinator(): AppCoordinator {
  return AppCoordinator.getInstance();
}

export default AppCoordinator;
