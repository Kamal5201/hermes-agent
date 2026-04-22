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

import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import dotenv from 'dotenv';
import log from 'electron-log/main.js';

import DatabaseManager, { WindowHistory } from '../database/DatabaseManager';
import { LearningEngine } from '../learning/LearningEngine';
import { ExecutionModule, MCPHandler, MessageType, type MCPMessage } from '../mcp';
import { PerceptionModule } from '../perception/PerceptionModule';
import { WindowEventPipeline, type WindowEventPayload } from '../perception/WindowEventPipeline';
import { PredictionEngine } from '../prediction/PredictionEngine';
import type { PredictionContext } from '../prediction/PredictionTypes';
import PrivacyManager from '../security/PrivacyManager';
import { SecurityGuard } from '../security/SecurityGuard';
import { CompanionState, StateEngine } from '../state/StateEngine';
import { AppleStyleUI, UIState, companionStateToUiState } from '../ui/AppleStyleUI';
import { DatabaseConfigStore, setupIpcHandlers } from './ipc-handlers';
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
  ui: AppleStyleUI;
};

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
    windowPipelineEnabled: process.env.WINDOW_PIPELINE_ENABLED !== 'false',
    windowPipelineSamplingMs: Number(process.env.WINDOW_PIPELINE_SAMPLING_MS ?? 1000),
  };
}

/**
 * AppCoordinator - 应用核心协调器
 * 
 * 使用单例模式管理整个应用的生命周期
 */
export class AppCoordinator extends EventEmitter {
  private static instance: AppCoordinator | null = null;
  
  private readonly config: AppConfig;
  private readonly logger: ReturnType<typeof getLogger>;
  
  private mainWindow: BrowserWindow | null = null;
  private services: AppCoordinatorServices | null = null;
  private windowPipeline: WindowEventPipeline | null = null;
  private stateTicker: NodeJS.Timeout | null = null;
  private runtimeSignals: RuntimeSignals;
  private isShuttingDown = false;
  private isInitialized = false;
  private errorRecoveryInitialized = false;
  private lastLearningSyncAt = 0;
  private lastPredictionSyncAt = 0;

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

    try {
      // 初始化服务
      this.services = this.initializeServices();
      
      // 创建主窗口
      this.mainWindow = this.createMainWindow();
      
      // 连接 MCP
      if (this.config.mcpUrl) {
        await this.connectMcp();
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

    if (this.services) {
      try {
        this.services.learning.stopContinuousLearning();
        this.services.perception.dispose();
        await this.services.mcp.disconnect();
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
    this.services.state.forceTransition(CompanionState.ACTIVE, reason);
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
    const databasePath = path.resolve(PROJECT_ROOT, 'data', 'hermes.db');
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
    const ui = AppleStyleUI.getInstance();
    this.windowPipeline = this.config.windowPipelineEnabled
      ? new WindowEventPipeline(perception, db, {
          samplingIntervalMs: this.config.windowPipelineSamplingMs,
          recordToDatabase: true,
        })
      : null;

    // 设置 IPC 处理器
    setupIpcHandlers(perception, execution, state, learning, mcp, security, config);

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
      this.forwardMcpMessage({
        id: null,
        type: MessageType.Notification,
        method: 'mcp.stateChange',
        params: {
          currentState,
          previousState,
        },
        timestamp: Date.now(),
      });
    });

    // MCP 处理器 - 错误
    services.mcp.on('error', (error: unknown) => {
      this.runtimeSignals.errorCount += 1;
      this.logger.error('MCP error', error);
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
      await services.learning.day1_BasicCollection();
      const patterns = services.learning.getPatterns();

      await Promise.resolve(services.config.set('learning_snapshot', {
        trigger,
        updatedAt: now,
        appName: payload.appName,
        learningDay: services.learning.getCurrentLearningDay(),
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
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.max(16, width - this.config.overlayWidth - 24);
    const y = Math.max(16, height - this.config.overlayHeight - 24);

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
      movable: false,
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
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error('Unable to resolve renderer/index.html');
  }

  private resolvePreloadFile(): string {
    const preloadPath = path.resolve(PROJECT_ROOT, 'dist/preload/index.js');

    if (!existsSync(preloadPath)) {
      throw new Error(`Preload bundle not found: ${preloadPath}. Run TypeScript build first.`);
    }

    return preloadPath;
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

    const interactive = uiState === UIState.HINT || uiState === UIState.ACTIVE;
    this.mainWindow.setFocusable(interactive);
    this.mainWindow.setIgnoreMouseEvents(!interactive, { forward: !interactive });
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
}

// 导出单例获取函数
export function getAppCoordinator(): AppCoordinator {
  return AppCoordinator.getInstance();
}

export default AppCoordinator;
