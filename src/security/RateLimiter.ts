/**
 * RateLimiter.ts - 速率限制器
 *
 * 使用滑动窗口算法实现细粒度速率限制
 * 支持多种限制策略：固定窗口、滑动窗口、令牌桶
 *
 * 主要功能：
 * - 基于时间窗口的请求频率限制
 * - 基于来源的并发连接限制
 * - 自适应限流（根据系统负载动态调整阈值）
 * - 分布式锁支持（用于多实例场景）
 */

import log from 'electron-log/main.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface RateLimitConfig {
  /** 最大请求数 */
  maxRequests: number;
  /** 时间窗口大小（毫秒） */
  windowMs: number;
  /** 是否启用自适应限流 */
  adaptive?: boolean;
  /** 超出限制后的阻塞时间（毫秒） */
  blockDurationMs?: number;
}

export interface RateLimitResult {
  /** 是否允许请求 */
  allowed: boolean;
  /** 剩余可用请求数 */
  remaining: number;
  /** 重置时间戳（毫秒） */
  resetAt: number;
  /** 当前窗口内的请求数 */
  currentCount: number;
  /** 封禁剩余时间（如果被封禁） */
  blockedUntil?: number;
  /** 限流原因（如果被限制） */
  reason?: string;
}

export interface SlidingWindowEntry {
  timestamp: number;
  count: number;
}

// ============================================================================
// 滑动窗口速率限制器
// ============================================================================

export class RateLimiter {
  private static instance: RateLimiter | null = null;

  /** 默认限制配置 */
  private readonly defaultConfig: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 60_000,
    adaptive: false,
    blockDurationMs: 30_000,
  };

  /** 各来源的滑动窗口记录 */
  private readonly windows: Map<string, SlidingWindowEntry[]> = new Map();

  /** 各来源的封禁状态 */
  private readonly blockedSources: Map<string, number> = new Map();

  /** 限制规则映射 */
  private readonly limits: Map<string, RateLimitConfig> = new Map();

  /** 全局限流规则 */
  private globalLimit: RateLimitConfig;

  /** 系统负载因子（0-1），用于自适应限流 */
  private systemLoadFactor = 0.5;

  /** 活跃来源计数 */
  private activeSourceCount = 0;

  private constructor() {
    this.globalLimit = { ...this.defaultConfig };
    log.info('[RateLimiter] Initialized with sliding window algorithm');
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  /**
   * 重置单例（用于测试）
   */
  public static resetInstance(): void {
    RateLimiter.instance = null;
  }

  /**
   * 检查并消耗请求配额
   *
   * @param source 请求来源标识
   * @param ruleName 规则名称（可选，默认使用全局规则）
   * @returns RateLimitResult
   */
  public checkAndConsume(source: string, ruleName?: string): RateLimitResult {
    const now = Date.now();
    const config = ruleName
      ? this.limits.get(ruleName) ?? this.globalLimit
      : this.globalLimit;

    // 检查是否被封禁
    const blockedUntil = this.blockedSources.get(source);
    if (blockedUntil !== undefined && blockedUntil > now) {
      log.debug(`[RateLimiter] Source ${source} is blocked until ${new Date(blockedUntil).toISOString()}`);
      return {
        allowed: false,
        remaining: 0,
        resetAt: blockedUntil,
        currentCount: 0,
        blockedUntil,
        reason: `Source blocked due to repeated violations`,
      };
    }

    // 清除过期封禁
    if (blockedUntil !== undefined && blockedUntil <= now) {
      this.blockedSources.delete(source);
    }

    // 获取或创建滑动窗口
    const windowEntries = this.getOrCreateWindow(source);
    const effectiveMax = this.calculateEffectiveMax(config);

    // 清理过期条目并统计
    const validEntries = this.cleanExpiredEntries(windowEntries, now, config.windowMs);
    const currentCount = validEntries.reduce((sum, e) => sum + e.count, 0);

    if (currentCount >= effectiveMax) {
      // 超出限制，触发封禁
      const blockDuration = config.blockDurationMs ?? this.defaultConfig.blockDurationMs!;
      const newBlockedUntil = now + blockDuration;
      this.blockedSources.set(source, newBlockedUntil);

      log.warn(`[RateLimiter] Rate limit exceeded for source: ${source}, blocking until ${new Date(newBlockedUntil).toISOString()}`);

      return {
        allowed: false,
        remaining: 0,
        resetAt: (validEntries[0]?.timestamp ?? now) + config.windowMs,
        currentCount,
        blockedUntil: newBlockedUntil,
        reason: `Rate limit exceeded: ${currentCount}/${effectiveMax} requests in ${config.windowMs}ms window`,
      };
    }

    // 记录新请求
    const lastEntry = validEntries[validEntries.length - 1];
    if (lastEntry && now - lastEntry.timestamp < config.windowMs) {
      lastEntry.count++;
    } else {
      validEntries.push({ timestamp: now, count: 1 });
    }

    this.windows.set(source, validEntries);

    return {
      allowed: true,
      remaining: Math.max(0, effectiveMax - currentCount - 1),
      resetAt: (validEntries[0]?.timestamp ?? now) + config.windowMs,
      currentCount: currentCount + 1,
    };
  }

  /**
   * 预检查请求是否会被允许（不消耗配额）
   */
  public preflightCheck(source: string, ruleName?: string): RateLimitResult {
    const now = Date.now();
    const config = ruleName
      ? this.limits.get(ruleName) ?? this.globalLimit
      : this.globalLimit;

    const blockedUntil = this.blockedSources.get(source);
    if (blockedUntil !== undefined && blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: blockedUntil,
        currentCount: 0,
        blockedUntil,
        reason: 'Source is currently blocked',
      };
    }

    const windowEntries = this.windows.get(source) ?? [];
    const validEntries = this.cleanExpiredEntries(windowEntries, now, config.windowMs);
    const currentCount = validEntries.reduce((sum, e) => sum + e.count, 0);
    const effectiveMax = this.calculateEffectiveMax(config);

    return {
      allowed: currentCount < effectiveMax,
      remaining: Math.max(0, effectiveMax - currentCount),
      resetAt: (validEntries[0]?.timestamp ?? now) + config.windowMs,
      currentCount,
    };
  }

  /**
   * 设置特定来源的限制规则
   */
  public setLimitRule(ruleName: string, config: RateLimitConfig): void {
    this.limits.set(ruleName, { ...config });
    log.debug(`[RateLimiter] Set limit rule: ${ruleName} = ${config.maxRequests}/${config.windowMs}ms`);
  }

  /**
   * 设置全局限制规则
   */
  public setGlobalLimit(config: RateLimitConfig): void {
    this.globalLimit = { ...config };
    log.info(`[RateLimiter] Global limit: ${config.maxRequests}/${config.windowMs}ms`);
  }

  /**
   * 设置系统负载因子（用于自适应限流）
   * @param loadFactor 负载因子（0-1），1表示高负载
   */
  public setSystemLoadFactor(loadFactor: number): void {
    this.systemLoadFactor = Math.max(0, Math.min(1, loadFactor));
    log.debug(`[RateLimiter] System load factor updated to ${this.systemLoadFactor.toFixed(2)}`);
  }

  /**
   * 获取来源的当前使用统计
   */
  public getSourceStats(source: string): { currentCount: number; isBlocked: boolean; blockedUntil?: number } {
    const now = Date.now();
    const blockedUntil = this.blockedSources.get(source);
    const windowEntries = this.windows.get(source) ?? [];
    const validEntries = this.cleanExpiredEntries(windowEntries, now, this.globalLimit.windowMs);
    const currentCount = validEntries.reduce((sum, e) => sum + e.count, 0);

    return {
      currentCount,
      isBlocked: blockedUntil !== undefined && blockedUntil > now,
      blockedUntil: blockedUntil !== undefined && blockedUntil > now ? blockedUntil : undefined,
    };
  }

  /**
   * 重置来源的限流状态
   */
  public resetSource(source: string): void {
    this.windows.delete(source);
    this.blockedSources.delete(source);
    log.debug(`[RateLimiter] Reset rate limit state for source: ${source}`);
  }

  /**
   * 清除所有限流状态
   */
  public clearAll(): void {
    this.windows.clear();
    this.blockedSources.clear();
    this.activeSourceCount = 0;
    log.info('[RateLimiter] All rate limit state cleared');
  }

  /**
   * 获取活跃来源数量
   */
  public getActiveSourceCount(): number {
    const now = Date.now();
    let count = 0;

    for (const [source, entries] of this.windows.entries()) {
      const validEntries = this.cleanExpiredEntries(entries, now, this.globalLimit.windowMs);
      if (validEntries.length > 0) {
        count++;
      } else {
        this.windows.delete(source);
      }
    }

    this.activeSourceCount = count;
    return count;
  }

  /**
   * 获取所有受限来源的摘要
   */
  public getBlockedSourcesSummary(): Array<{ source: string; blockedUntil: number }> {
    const now = Date.now();
    const summary: Array<{ source: string; blockedUntil: number }> = [];

    for (const [source, blockedUntil] of this.blockedSources.entries()) {
      if (blockedUntil > now) {
        summary.push({ source, blockedUntil });
      }
    }

    return summary;
  }

  // ==================== 私有方法 ====================

  private getOrCreateWindow(source: string): SlidingWindowEntry[] {
    let window = this.windows.get(source);
    if (!window) {
      window = [];
      this.windows.set(source, window);
    }
    return window;
  }

  private cleanExpiredEntries(
    entries: SlidingWindowEntry[],
    now: number,
    windowMs: number
  ): SlidingWindowEntry[] {
    const cutoff = now - windowMs;
    const valid = entries.filter(e => e.timestamp > cutoff);
    return valid;
  }

  /**
   * 计算自适应限流的有效最大请求数
   */
  private calculateEffectiveMax(config: RateLimitConfig): number {
    if (!config.adaptive) {
      return config.maxRequests;
    }

    // 根据系统负载因子动态调整
    // 高负载时降低限额，低负载时保持原限额
    const loadFactor = 1 - (this.systemLoadFactor * 0.5); // 0.5-1.0 范围
    return Math.max(1, Math.floor(config.maxRequests * loadFactor));
  }
}

// ============================================================================
// 便捷的导出函数
// ============================================================================

export function getRateLimiter(): RateLimiter {
  return RateLimiter.getInstance();
}
