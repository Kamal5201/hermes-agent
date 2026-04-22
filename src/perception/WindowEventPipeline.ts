/**
 * WindowEventPipeline - 窗口事件管道
 * 
 * 专门处理窗口相关事件的批量收集和处理：
 * - 窗口切换
 * - 窗口打开/关闭
 * - 窗口大小/位置变化
 * - 焦点变化
 * 
 * 使用 node-screenshots 的窗口API捕获窗口状态变化
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';
import { EventPipeline, PipelineConfig, PipelineEvent, BatchResult, DEFAULT_PIPELINE_CONFIG } from '../common/EventPipeline';
import DatabaseManager, { WindowHistory } from '../database/DatabaseManager';
import { PerceptionModule, WindowInfo } from './PerceptionModule';

// 窗口事件类型
export type WindowEventType = 
  | 'window:focused'
  | 'window:unfocused'
  | 'window:opened'
  | 'window:closed'
  | 'window:moved'
  | 'window:resized'
  | 'window:title_changed';

// 窗口事件负载
export interface WindowEventPayload {
  windowId: string;
  title: string;
  appName: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  previousTitle?: string;
  previousBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  metadata?: Record<string, unknown>;
}

// 窗口快照
interface WindowSnapshot {
  windowId: string;
  title: string;
  appName: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  focused: boolean;
  timestamp: number;
}

// 配置接口
export interface WindowEventPipelineConfig extends Partial<PipelineConfig> {
  /** 数据库批量插入的大小 */
  dbBatchSize?: number;
  /** 数据库批量插入的间隔 */
  dbBatchIntervalMs?: number;
  /** 是否自动记录窗口历史 */
  recordToDatabase?: boolean;
  /** 窗口变化检测的阈值(像素) */
  positionChangeThreshold?: number;
  /** 采样间隔(ms) */
  samplingIntervalMs?: number;
}

const DEFAULT_WINDOW_PIPELINE_CONFIG: WindowEventPipelineConfig = {
  ...DEFAULT_PIPELINE_CONFIG,
  batchSize: 5,
  batchIntervalMs: 2000,
  throttleEnabled: true,
  throttleIntervalMs: 1000,
  debounceEnabled: true,
  debounceDelayMs: 500,
  maxQueueSize: 100,
  dbBatchSize: 20,
  dbBatchIntervalMs: 5000,
  recordToDatabase: true,
  positionChangeThreshold: 5,
  samplingIntervalMs: 1000,
};

/**
 * WindowEventPipeline - 窗口事件管道
 * 
 * 功能：
 * 1. 采样检测窗口状态变化
 * 2. 批量处理窗口事件
 * 3. 可选地将窗口历史记录到数据库
 */
export class WindowEventPipeline extends EventPipeline<WindowEventPayload> {
  private readonly perception: PerceptionModule;
  private readonly database: DatabaseManager | null;
  private readonly pipelineConfig: WindowEventPipelineConfig;
  
  private samplingTimer: NodeJS.Timeout | null = null;
  private lastSnapshot: Map<string, WindowSnapshot> = new Map();
  private currentFocusedWindowId: string | null = null;
  private pendingDbRecords: WindowHistory[] = [];
  private dbBatchTimer: NodeJS.Timeout | null = null;

  constructor(
    perception: PerceptionModule,
    database?: DatabaseManager,
    config: WindowEventPipelineConfig = {}
  ) {
    const finalConfig = { ...DEFAULT_WINDOW_PIPELINE_CONFIG, ...config };
    super('WindowEvent', finalConfig);
    
    this.perception = perception;
    this.database = database ?? DatabaseManager.getInstance();
    this.pipelineConfig = finalConfig;
    
    log.info('[WindowEventPipeline] Initialized', { 
      recordToDatabase: this.pipelineConfig.recordToDatabase,
      samplingIntervalMs: this.pipelineConfig.samplingIntervalMs,
    });
  }

  /**
   * 启动窗口事件监控
   */
  start(): void {
    if (this.samplingTimer) {
      log.warn('[WindowEventPipeline] Already started');
      return;
    }

    super.start();
    this.startSampling();
    
    if (this.pipelineConfig.recordToDatabase) {
      this.startDbBatchTimer();
    }
    
    log.info('[WindowEventPipeline] Started monitoring');
  }

  /**
   * 停止窗口事件监控
   */
  stop(): void {
    this.stopSampling();
    this.stopDbBatchTimer();
    super.stop();
    log.info('[WindowEventPipeline] Stopped monitoring');
  }

  /**
   * 强制刷新窗口快照
   */
  async refreshSnapshots(): Promise<void> {
    try {
      const windows = await this.perception.getWindows();
      const now = Date.now();
      
      const newSnapshotMap = new Map<string, WindowSnapshot>();
      
      for (const win of windows) {
        newSnapshotMap.set(win.id, {
          windowId: win.id,
          title: win.title,
          appName: win.processName,
          bounds: win.bounds,
          focused: win.isFocused,
          timestamp: now,
        });
      }
      
      // 检测变化
      this.detectChanges(this.lastSnapshot, newSnapshotMap);
      
      // 更新快照
      this.lastSnapshot = newSnapshotMap;
      
      // 更新焦点窗口
      const focusedWindow = windows.find((w) => w.isFocused);
      this.currentFocusedWindowId = focusedWindow?.id ?? null;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('[WindowEventPipeline] Failed to refresh snapshots', errorMessage);
    }
  }

  /**
   * 获取当前所有窗口快照
   */
  getCurrentSnapshots(): WindowSnapshot[] {
    return Array.from(this.lastSnapshot.values());
  }

  /**
   * 获取当前焦点窗口
   */
  getFocusedWindow(): WindowSnapshot | null {
    if (!this.currentFocusedWindowId) {
      return null;
    }
    return this.lastSnapshot.get(this.currentFocusedWindowId) ?? null;
  }

  // ============ 继承自 EventPipeline ============

  protected async processEvents(events: PipelineEvent<WindowEventPayload>[]): Promise<BatchResult<WindowEventPayload>> {
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;
    const errors: Array<{ event: PipelineEvent<WindowEventPayload>; error: string }> = [];

    for (const event of events) {
      try {
        await this.handleWindowEvent(event);
        processed++;
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ event, error: errorMessage });
        log.error(`[WindowEventPipeline] Failed to handle event ${event.type}`, errorMessage);
      }
    }

    return {
      processed,
      failed,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  // ============ 私有方法 ============

  private startSampling(): void {
    if (this.samplingTimer) {
      return;
    }

    // 立即执行一次采样
    void this.refreshSnapshots();

    this.samplingTimer = setInterval(() => {
      void this.refreshSnapshots();
    }, this.pipelineConfig.samplingIntervalMs);

    log.info(`[WindowEventPipeline] Sampling started (interval: ${this.pipelineConfig.samplingIntervalMs}ms)`);
  }

  private stopSampling(): void {
    if (this.samplingTimer) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = null;
    }
  }

  private startDbBatchTimer(): void {
    if (this.dbBatchTimer) {
      return;
    }

    this.dbBatchTimer = setInterval(() => {
      void this.flushDbRecords();
    }, this.pipelineConfig.dbBatchIntervalMs);
  }

  private stopDbBatchTimer(): void {
    if (this.dbBatchTimer) {
      clearInterval(this.dbBatchTimer);
      this.dbBatchTimer = null;
    }
  }

  private detectChanges(oldSnapshots: Map<string, WindowSnapshot>, newSnapshots: Map<string, WindowSnapshot>): void {
    const now = Date.now();
    const oldIds = new Set(oldSnapshots.keys());
    const newIds = new Set(newSnapshots.keys());

    // 检测关闭的窗口
    for (const windowId of oldIds) {
      if (!newIds.has(windowId)) {
        const old = oldSnapshots.get(windowId)!;
        this.push('window:closed', {
          windowId: old.windowId,
          title: old.title,
          appName: old.appName,
          bounds: old.bounds,
        });
      }
    }

    // 检测新窗口和变化的窗口
    for (const windowId of newIds) {
      const newWindow = newSnapshots.get(windowId)!;
      const oldWindow = oldSnapshots.get(windowId);

      if (!oldWindow) {
        // 新窗口
        this.push('window:opened', {
          windowId: newWindow.windowId,
          title: newWindow.title,
          appName: newWindow.appName,
          bounds: newWindow.bounds,
        });
      } else {
        // 检查变化
        const changes = this.detectWindowChanges(oldWindow, newWindow);
        
        if (changes.focused && !oldWindow.focused) {
          this.push('window:focused', {
            windowId: newWindow.windowId,
            title: newWindow.title,
            appName: newWindow.appName,
            bounds: newWindow.bounds,
          });
        } else if (!changes.focused && oldWindow.focused) {
          this.push('window:unfocused', {
            windowId: newWindow.windowId,
            title: newWindow.title,
            appName: newWindow.appName,
            bounds: newWindow.bounds,
          });
        }

        if (changes.bounds) {
          this.push('window:moved', {
            windowId: newWindow.windowId,
            title: newWindow.title,
            appName: newWindow.appName,
            bounds: newWindow.bounds,
            previousBounds: oldWindow.bounds,
          });
        }

        if (changes.title) {
          this.push('window:title_changed', {
            windowId: newWindow.windowId,
            title: newWindow.title,
            appName: newWindow.appName,
            bounds: newWindow.bounds,
            previousTitle: oldWindow.title,
          });
        }
      }
    }
  }

  private detectWindowChanges(oldWindow: WindowSnapshot, newWindow: WindowSnapshot): {
    focused: boolean;
    bounds: boolean;
    title: boolean;
  } {
    return {
      focused: oldWindow.focused !== newWindow.focused,
      bounds: this.hasBoundsChanged(oldWindow.bounds, newWindow.bounds),
      title: oldWindow.title !== newWindow.title,
    };
  }

  private hasBoundsChanged(
    oldBounds: WindowSnapshot['bounds'],
    newBounds: WindowSnapshot['bounds']
  ): boolean {
    const threshold = this.pipelineConfig.positionChangeThreshold ?? 5;
    
    return (
      Math.abs(oldBounds.x - newBounds.x) > threshold ||
      Math.abs(oldBounds.y - newBounds.y) > threshold ||
      Math.abs(oldBounds.width - newBounds.width) > threshold ||
      Math.abs(oldBounds.height - newBounds.height) > threshold
    );
  }

  private async handleWindowEvent(event: PipelineEvent<WindowEventPayload>): Promise<void> {
    const { type, payload } = event;
    
    // 发出事件
    this.emit(type, payload);
    this.emit('window:event', { type, payload, timestamp: event.timestamp });

    // 如果需要记录到数据库
    if (this.pipelineConfig.recordToDatabase && this.database) {
      const record: WindowHistory = {
        window_id: payload.windowId,
        title: payload.title,
        app_name: payload.appName,
        start_time: Math.floor(event.timestamp / 1000),
        end_time: undefined,
        duration: undefined,
        closed: type === 'window:closed' ? 1 : 0,
      };

      this.pendingDbRecords.push(record);

      // 如果达到批量大小，立即刷新
      if (this.pendingDbRecords.length >= (this.pipelineConfig.dbBatchSize ?? 20)) {
        await this.flushDbRecords();
      }
    }
  }

  private async flushDbRecords(): Promise<void> {
    if (this.pendingDbRecords.length === 0 || !this.database) {
      return;
    }

    const records = [...this.pendingDbRecords];
    this.pendingDbRecords = [];

    try {
      // 使用批量插入
      this.database.batchInsertWindowHistory(records);
      log.info(`[WindowEventPipeline] Flushed ${records.length} window records to database`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('[WindowEventPipeline] Failed to flush DB records', errorMessage);
      // 放回队列以便重试
      this.pendingDbRecords.push(...records);
    }
  }

  protected shouldProcessImmediately(): boolean {
    // 焦点变化事件立即处理
    return this.queue.some(
      (e) => e.type === 'window:focused' || e.type === 'window:unfocused'
    );
  }

  protected sortEvents(events: PipelineEvent<WindowEventPayload>[]): PipelineEvent<WindowEventPayload>[] {
    return events.sort((a, b) => {
      // 优先级排序
      const priorityMap: Record<string, number> = {
        'window:focused': 100,
        'window:unfocused': 90,
        'window:closed': 80,
        'window:opened': 70,
        'window:moved': 60,
        'window:title_changed': 50,
      };
      
      const aPriority = priorityMap[a.type] ?? 0;
      const bPriority = priorityMap[b.type] ?? 0;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      return a.timestamp - b.timestamp;
    });
  }
}

export default WindowEventPipeline;
