/**
 * EventPipeline - 批量处理基类
 * 提供事件批量收集、节流、防抖和批量处理能力
 * 
 * 使用方式:
 * - 继承此类实现具体的事件处理管道
 * - 支持事件节流(throttle)、防抖(debounce)、批量(batch)
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

// 类型定义
export interface PipelineConfig {
  /** 批量处理的最大事件数量 */
  batchSize: number;
  /** 批量处理的最大时间间隔(ms) */
  batchIntervalMs: number;
  /** 是否启用节流 */
  throttleEnabled: boolean;
  /** 节流间隔(ms) */
  throttleIntervalMs: number;
  /** 是否启用防抖 */
  debounceEnabled: boolean;
  /** 防抖延迟(ms) */
  debounceDelayMs: number;
  /** 最大队列大小，0表示无限制 */
  maxQueueSize: number;
}

export interface PipelineEvent<T = unknown> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  priority: number;
  metadata?: Record<string, unknown>;
}

export interface BatchResult<T = unknown> {
  processed: number;
  failed: number;
  errors: Array<{ event: PipelineEvent<T>; error: string }>;
  durationMs: number;
}

export interface PipelineMetrics {
  totalReceived: number;
  totalProcessed: number;
  totalFailed: number;
  currentQueueSize: number;
  lastProcessTime: number | null;
  lastBatchSize: number;
  uptime: number;
}

// 默认配置
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  batchSize: 10,
  batchIntervalMs: 1000,
  throttleEnabled: true,
  throttleIntervalMs: 500,
  debounceEnabled: true,
  debounceDelayMs: 300,
  maxQueueSize: 1000,
};

// 事件ID生成器
let eventIdCounter = 0;
function generateEventId(): string {
  return `${Date.now()}-${++eventIdCounter}`;
}

/**
 * EventPipeline - 批量处理基类
 * 
 * 提供通用的事件批量处理能力，包括：
 * - 事件队列管理
 * - 节流(Throttle)和防抖(Debounce)
 * - 批量处理
 * - 错误恢复
 * - 指标统计
 */
export abstract class EventPipeline<T = unknown> extends EventEmitter {
  protected readonly name: string;
  protected config: PipelineConfig;
  protected queue: PipelineEvent<T>[] = [];
  protected processing = false;
  protected batchTimer: NodeJS.Timeout | null = null;
  protected throttleTimer: NodeJS.Timeout | null = null;
  protected debounceTimer: NodeJS.Timeout | null = null;
  protected startedAt = 0;
  
  // 指标
  private metrics: PipelineMetrics = {
    totalReceived: 0,
    totalProcessed: 0,
    totalFailed: 0,
    currentQueueSize: 0,
    lastProcessTime: null,
    lastBatchSize: 0,
    uptime: 0,
  };

  constructor(name: string, config: Partial<PipelineConfig> = {}) {
    super();
    this.name = name;
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    log.info(`[EventPipeline:${name}] Initialized with config`, this.config);
  }

  /**
   * 启动管道
   */
  start(): void {
    if (this.startedAt > 0) {
      log.warn(`[EventPipeline:${this.name}] Already started`);
      return;
    }
    
    this.startedAt = Date.now();
    this.scheduleBatch();
    log.info(`[EventPipeline:${this.name}] Started`);
    this.emit('started');
  }

  /**
   * 停止管道
   */
  stop(): void {
    this.clearAllTimers();
    this.queue = [];
    this.startedAt = 0;
    log.info(`[EventPipeline:${this.name}] Stopped`);
    this.emit('stopped');
  }

  /**
   * 推送事件到管道
   * @param type 事件类型
   * @param payload 事件数据
   * @param priority 优先级，数字越大优先级越高
   */
  push(type: string, payload: T, priority = 0): void {
    // 检查队列大小限制
    if (this.config.maxQueueSize > 0 && this.queue.length >= this.config.maxQueueSize) {
      log.warn(`[EventPipeline:${this.name}] Queue full (${this.config.maxQueueSize}), dropping oldest event`);
      this.queue.shift();
    }

    const event: PipelineEvent<T> = {
      id: generateEventId(),
      type,
      payload,
      timestamp: Date.now(),
      priority,
    };

    this.queue.push(event);
    this.metrics.totalReceived++;
    this.metrics.currentQueueSize = this.queue.length;

    this.emit('event:received', event);

    // 如果启用了防抖，重置防抖计时器
    if (this.config.debounceEnabled) {
      this.resetDebounce();
    }

    // 检查是否需要立即处理
    if (this.shouldProcessImmediately()) {
      void this.processBatch();
    }
  }

  /**
   * 推送多个事件
   */
  pushMany(events: Array<{ type: string; payload: T; priority?: number }>): void {
    for (const event of events) {
      this.push(event.type, event.payload, event.priority ?? 0);
    }
  }

  /**
   * 获取当前指标
   */
  getMetrics(): PipelineMetrics {
    return {
      ...this.metrics,
      currentQueueSize: this.queue.length,
      uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PipelineConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...config };
    log.info(`[EventPipeline:${this.name}] Config updated`, this.config);
    this.emit('config:updated', this.config);
  }

  /**
   * 清空队列
   */
  clearQueue(): number {
    const count = this.queue.length;
    this.queue = [];
    this.metrics.currentQueueSize = 0;
    log.info(`[EventPipeline:${this.name}] Queue cleared (${count} events)`);
    return count;
  }

  /**
   * 强制立即处理当前队列
   */
  async flush(): Promise<BatchResult<T>> {
    return this.processBatch();
  }

  // ============ 抽象方法 ============

  /**
   * 处理一批事件 - 子类必须实现
   */
  protected abstract processEvents(events: PipelineEvent<T>[]): Promise<BatchResult<T>>;

  // ============ 可重写的方法 ============

  /**
   * 判断是否需要立即处理
   * 默认当队列达到batchSize时立即处理
   */
  protected shouldProcessImmediately(): boolean {
    return this.queue.length >= this.config.batchSize;
  }

  /**
   * 事件排序 - 默认按优先级和时间戳排序
   */
  protected sortEvents(events: PipelineEvent<T>[]): PipelineEvent<T>[] {
    return events.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * 过滤事件 - 默认不过滤
   */
  protected filterEvents(events: PipelineEvent<T>[]): PipelineEvent<T>[] {
    return events;
  }

  // ============ 私有方法 ============

  private scheduleBatch(): void {
    if (this.batchTimer) {
      return;
    }

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      void this.processBatch();
      
      if (this.startedAt > 0) {
        this.scheduleBatch();
      }
    }, this.config.batchIntervalMs);
  }

  private resetDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    if (this.config.debounceEnabled) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.processBatch();
      }, this.config.debounceDelayMs);
    }
  }

  private shouldThrottle(): boolean {
    if (!this.config.throttleEnabled) {
      return false;
    }

    if (this.throttleTimer) {
      return true;
    }

    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
    }, this.config.throttleIntervalMs);

    return false;
  }

  private clearAllTimers(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private async processBatch(): Promise<BatchResult<T>> {
    // 防止并发处理
    if (this.processing) {
      return {
        processed: 0,
        failed: 0,
        errors: [],
        durationMs: 0,
      };
    }

    // 节流检查
    if (this.shouldThrottle()) {
      return {
        processed: 0,
        failed: 0,
        errors: [],
        durationMs: 0,
      };
    }

    if (this.queue.length === 0) {
      return {
        processed: 0,
        failed: 0,
        errors: [],
        durationMs: 0,
      };
    }

    this.processing = true;
    const startTime = Date.now();

    // 提取并清空队列
    const events = this.sortEvents(this.filterEvents([...this.queue]));
    this.queue = [];
    this.metrics.currentQueueSize = 0;

    this.emit('batch:start', events.length);

    let result: BatchResult<T>;
    
    try {
      result = await this.processEvents(events);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[EventPipeline:${this.name}] Batch processing error`, error);
      
      result = {
        processed: 0,
        failed: events.length,
        errors: events.map((event) => ({
          event,
          error: errorMessage,
        })),
        durationMs: Date.now() - startTime,
      };
    }

    // 更新指标
    this.metrics.totalProcessed += result.processed;
    this.metrics.totalFailed += result.failed;
    this.metrics.lastProcessTime = Date.now();
    this.metrics.lastBatchSize = events.length;
    this.metrics.uptime = this.startedAt > 0 ? Date.now() - this.startedAt : 0;

    this.processing = false;

    this.emit('batch:complete', result);
    log.info(`[EventPipeline:${this.name}] Batch processed: ${result.processed} ok, ${result.failed} failed, ${result.durationMs}ms`);

    return result;
  }
}

export default EventPipeline;
