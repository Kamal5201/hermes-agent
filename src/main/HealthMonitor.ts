/**
 * HealthMonitor.ts - 系统健康监控器
 *
 * 监控应用各组件的健康状态，包括：
 * - 内存使用情况
 * - CPU 使用率
 * - 数据库连接状态
 * - 预测引擎健康度
 * - 安全模块状态
 * - 学习引擎状态
 *
 * 主要功能：
 * - 定期健康检查和报告
 * - 异常检测和告警
 * - 健康评分计算
 * - 历史健康状态记录
 */

import log from 'electron-log/main.js';
import { EventEmitter } from 'events';

// ============================================================================
// 类型定义
// ============================================================================

export interface HealthStatus {
  /** 组件名称 */
  component: string;
  /** 是否健康 */
  healthy: boolean;
  /** 健康评分 (0-1) */
  score: number;
  /** 状态详情 */
  details: Record<string, unknown>;
  /** 最后检查时间 */
  lastChecked: number;
  /** 问题描述（如果不健康） */
  issue?: string;
}

export interface SystemHealth {
  /** 总体健康状态 */
  overall: 'healthy' | 'degraded' | 'critical';
  /** 总体健康评分 (0-1) */
  overallScore: number;
  /** 各组件健康状态 */
  components: HealthStatus[];
  /** 健康检查时间戳 */
  timestamp: number;
  /** 系统指标 */
  systemMetrics: SystemMetrics;
}

export interface SystemMetrics {
  /** 内存使用率 (0-1) */
  memoryUsage: number;
  /** 内存使用量（字节） */
  memoryUsed: number;
  /** 内存总量（字节） */
  memoryTotal: number;
  /** CPU 使用率 (0-1) */
  cpuUsage: number;
  /** 活跃运行时间（毫秒） */
  uptime: number;
  /** 事件循环延迟（毫秒） */
  eventLoopLag: number;
}

export interface HealthAlert {
  /** 告警级别 */
  level: 'warning' | 'error' | 'critical';
  /** 告警组件 */
  component: string;
  /** 告警消息 */
  message: string;
  /** 告警时间 */
  timestamp: number;
  /** 建议的修复操作 */
  suggestedAction?: string;
}

export interface HealthMonitorConfig {
  /** 检查间隔（毫秒） */
  checkIntervalMs: number;
  /** 内存使用告警阈值 */
  memoryWarningThreshold: number;
  /** 内存使用危险阈值 */
  memoryCriticalThreshold: number;
  /** CPU 使用告警阈值 */
  cpuWarningThreshold: number;
  /** CPU 使用危险阈值 */
  cpuCriticalThreshold: number;
  /** 事件循环延迟告警阈值（毫秒） */
  eventLoopLagWarningMs: number;
  /** 事件循环延迟危险阈值（毫秒） */
  eventLoopLagCriticalMs: number;
  /** 是否启用历史记录 */
  enableHistory: boolean;
  /** 历史记录最大条数 */
  maxHistorySize: number;
}

export interface HealthThresholds {
  /** 数据库连接池最小可用连接 */
  dbMinConnections: number;
  /** 预测队列最大长度 */
  predictionQueueMaxLength: number;
  /** 学习引擎最小更新频率（次/分钟） */
  learningMinUpdateRate: number;
}

// ============================================================================
// 健康监控器
// ============================================================================

export class HealthMonitor extends EventEmitter {
  private static instance: HealthMonitor | null = null;

  private config: HealthMonitorConfig;
  private healthHistory: SystemHealth[] = [];
  private alerts: HealthAlert[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /** 各组件的最后健康状态 */
  private componentStatuses: Map<string, HealthStatus> = new Map();

  /** 应用启动时间 */
  private readonly startTime: number;

  /** 健康检查计数器 */
  private checkCount = 0;

  private constructor(config?: Partial<HealthMonitorConfig>) {
    super();

    this.startTime = Date.now();

    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 30_000,
      memoryWarningThreshold: config?.memoryWarningThreshold ?? 0.7,
      memoryCriticalThreshold: config?.memoryCriticalThreshold ?? 0.9,
      cpuWarningThreshold: config?.cpuWarningThreshold ?? 0.7,
      cpuCriticalThreshold: config?.cpuCriticalThreshold ?? 0.9,
      eventLoopLagWarningMs: config?.eventLoopLagWarningMs ?? 100,
      eventLoopLagCriticalMs: config?.eventLoopLagCriticalMs ?? 500,
      enableHistory: config?.enableHistory ?? true,
      maxHistorySize: config?.maxHistorySize ?? 100,
    };

    log.info('[HealthMonitor] Initialized');
  }

  /**
   * 获取单例实例
   */
  public static getInstance(config?: Partial<HealthMonitorConfig>): HealthMonitor {
    if (!HealthMonitor.instance) {
      HealthMonitor.instance = new HealthMonitor(config);
    }
    return HealthMonitor.instance;
  }

  /**
   * 重置单例
   */
  public static resetInstance(config?: Partial<HealthMonitorConfig>): void {
    if (HealthMonitor.instance) {
      HealthMonitor.instance.stop();
    }
    HealthMonitor.instance = null;
    if (config) {
      HealthMonitor.instance = new HealthMonitor(config);
    }
  }

  /**
   * 启动健康监控
   */
  public start(): void {
    if (this.isRunning) {
      log.warn('[HealthMonitor] Already running');
      return;
    }

    this.isRunning = true;
    this.runHealthCheck(); // 立即执行一次
    this.checkInterval = setInterval(() => {
      void this.runHealthCheck();
    }, this.config.checkIntervalMs);

    log.info('[HealthMonitor] Started');
  }

  /**
   * 停止健康监控
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    log.info('[HealthMonitor] Stopped');
  }

  /**
   * 执行一次健康检查
   */
  public async runHealthCheck(): Promise<SystemHealth> {
    this.checkCount++;
    const timestamp = Date.now();

    // 收集各组件健康状态
    const componentStatuses: HealthStatus[] = [];

    // 系统级健康检查
    const systemHealth = await this.checkSystemHealth(timestamp);
    componentStatuses.push(systemHealth);

    // 组件级健康检查（如果 AppCoordinator 可用）
    const coordinatorHealth = await this.checkCoordinatorHealth(timestamp);
    if (coordinatorHealth) {
      componentStatuses.push(coordinatorHealth);
    }

    // 计算总体健康状态
    const overallScore = this.calculateOverallScore(componentStatuses);
    const overall = this.determineOverallStatus(overallScore, componentStatuses);

    const health: SystemHealth = {
      overall,
      overallScore,
      components: componentStatuses,
      timestamp,
      systemMetrics: await this.getSystemMetrics(),
    };

    // 更新历史记录
    if (this.config.enableHistory) {
      this.healthHistory.push(health);
      if (this.healthHistory.length > this.config.maxHistorySize) {
        this.healthHistory.shift();
      }
    }

    // 更新组件状态缓存
    for (const status of componentStatuses) {
      this.componentStatuses.set(status.component, status);
    }

    // 检查是否需要生成告警
    const newAlerts = this.checkForAlerts(componentStatuses, health.systemMetrics);
    for (const alert of newAlerts) {
      this.alerts.push(alert);
      this.emit('alert', alert);
      log.warn(`[HealthMonitor] Alert (${alert.level}): ${alert.component} - ${alert.message}`);
    }

    // 保持告警历史在限制内
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    this.emit('healthCheck', health);
    return health;
  }

  /**
   * 获取当前健康状态
   */
  public getCurrentHealth(): SystemHealth | null {
    if (this.healthHistory.length === 0) {
      return null;
    }
    return this.healthHistory[this.healthHistory.length - 1];
  }

  /**
   * 获取健康历史
   */
  public getHealthHistory(count?: number): SystemHealth[] {
    if (count === undefined) {
      return [...this.healthHistory];
    }
    return this.healthHistory.slice(-count);
  }

  /**
   * 获取当前告警列表
   */
  public getAlerts(): HealthAlert[] {
    return [...this.alerts];
  }

  /**
   * 获取组件状态
   */
  public getComponentStatus(component: string): HealthStatus | null {
    return this.componentStatuses.get(component) ?? null;
  }

  /**
   * 获取系统指标
   */
  public async getSystemMetrics(): Promise<SystemMetrics> {
    const memUsage = process.memoryUsage();
    const totalMemory = memUsage.heapTotal;
    const usedMemory = memUsage.heapUsed;

    return {
      memoryUsage: usedMemory / totalMemory,
      memoryUsed: usedMemory,
      memoryTotal: totalMemory,
      cpuUsage: await this.measureCpuUsage(),
      uptime: Date.now() - this.startTime,
      eventLoopLag: await this.measureEventLoopLag(),
    };
  }

  /**
   * 获取健康报告摘要
   */
  public getSummary(): {
    status: string;
    score: number;
    uptime: string;
    alertCount: number;
    lastCheck: string;
    components: Record<string, { healthy: boolean; score: number }>;
  } {
    const current = this.getCurrentHealth();
    const uptimeMs = Date.now() - this.startTime;
    const uptimeHours = Math.floor(uptimeMs / 3_600_000);
    const uptimeMinutes = Math.floor((uptimeMs % 3_600_000) / 60_000);

    return {
      status: current?.overall ?? 'unknown',
      score: current?.overallScore ?? 0,
      uptime: `${uptimeHours}h ${uptimeMinutes}m`,
      alertCount: this.alerts.filter(a => a.timestamp > Date.now() - 3_600_000).length,
      lastCheck: current ? new Date(current.timestamp).toISOString() : 'never',
      components: Object.fromEntries(
        Array.from(this.componentStatuses.entries()).map(([name, status]) => [
          name,
          { healthy: status.healthy, score: status.score },
        ])
      ),
    };
  }

  /**
   * 清除历史记录
   */
  public clearHistory(): void {
    this.healthHistory = [];
    log.info('[HealthMonitor] History cleared');
  }

  /**
   * 清除告警
   */
  public clearAlerts(): void {
    this.alerts = [];
    log.info('[HealthMonitor] Alerts cleared');
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<HealthMonitorConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning) {
      this.start();
    }

    log.info(`[HealthMonitor] Config updated: ${JSON.stringify(config)}`);
  }

  // ==================== 私有方法 ====================

  /**
   * 检查系统级健康状态
   */
  private async checkSystemHealth(timestamp: number): Promise<HealthStatus> {
    const metrics = await this.getSystemMetrics();

    let score = 1.0;
    let healthy = true;
    let issue: string | undefined;
    const details: Record<string, unknown> = {};

    // 内存检查
    if (metrics.memoryUsage >= this.config.memoryCriticalThreshold) {
      score *= 0.3;
      healthy = false;
      issue = `Critical memory usage: ${(metrics.memoryUsage * 100).toFixed(1)}%`;
    } else if (metrics.memoryUsage >= this.config.memoryWarningThreshold) {
      score *= 0.7;
      healthy = false;
      issue = `High memory usage: ${(metrics.memoryUsage * 100).toFixed(1)}%`;
    }

    details.memoryPercent = (metrics.memoryUsage * 100).toFixed(1);
    details.memoryUsedMB = (metrics.memoryUsed / 1024 / 1024).toFixed(0);

    // CPU 检查
    if (metrics.cpuUsage >= this.config.cpuCriticalThreshold) {
      score *= 0.4;
      if (healthy) {
        healthy = false;
        issue = `Critical CPU usage: ${(metrics.cpuUsage * 100).toFixed(1)}%`;
      }
    } else if (metrics.cpuUsage >= this.config.cpuWarningThreshold) {
      score *= 0.8;
    }

    details.cpuPercent = (metrics.cpuUsage * 100).toFixed(1);

    // 事件循环延迟检查
    if (metrics.eventLoopLag >= this.config.eventLoopLagCriticalMs) {
      score *= 0.2;
      if (healthy) {
        healthy = false;
        issue = `Event loop lag critical: ${metrics.eventLoopLag.toFixed(0)}ms`;
      }
    } else if (metrics.eventLoopLag >= this.config.eventLoopLagWarningMs) {
      score *= 0.7;
    }

    details.eventLoopLagMs = metrics.eventLoopLag.toFixed(1);
    details.uptimeSeconds = Math.floor(metrics.uptime / 1000);

    return {
      component: 'system',
      healthy,
      score: Math.max(0, Math.min(1, score)),
      details,
      lastChecked: timestamp,
      issue,
    };
  }

  /**
   * 检查 AppCoordinator 相关组件健康状态
   */
  private async checkCoordinatorHealth(timestamp: number): Promise<HealthStatus | null> {
    try {
      // 尝试导入 AppCoordinator 以检查服务状态
      const { getAppCoordinator } = await import('./AppCoordinator.js');
      const coordinator = getAppCoordinator();

      if (!coordinator.isReady()) {
        return {
          component: 'coordinator',
          healthy: false,
          score: 0.2,
          details: { ready: false },
          lastChecked: timestamp,
          issue: 'AppCoordinator not ready',
        };
      }

      const services = coordinator.getServices();
      if (!services) {
        return {
          component: 'coordinator',
          healthy: false,
          score: 0.3,
          details: { services: null },
          lastChecked: timestamp,
          issue: 'Services not initialized',
        };
      }

      // 检查各服务状态
      const serviceScores: Array<{ name: string; score: number }> = [];
      let totalScore = 1.0;
      const issues: string[] = [];

      // 数据库检查
      try {
        const dbHealth = await this.checkDatabaseHealth(services.db);
        serviceScores.push({ name: 'database', score: dbHealth.score });
        if (!dbHealth.healthy) {
          issues.push(dbHealth.issue ?? 'Database issue');
        }
      } catch {
        issues.push('Database check failed');
      }

      // 学习引擎检查
      try {
        const learningState = (services.learning as unknown as { getLearningState?: () => { isHealthy: boolean } | null }).getLearningState?.();
        if (learningState) {
          serviceScores.push({ name: 'learning', score: learningState.isHealthy ? 1.0 : 0.5 });
        }
      } catch {
        // 学习引擎检查可选
      }

      // 预测引擎检查
      try {
        const predictionMetrics = (services.prediction as unknown as { getMetrics?: () => { score?: number } | null }).getMetrics?.();
        if (predictionMetrics) {
          serviceScores.push({ name: 'prediction', score: predictionMetrics.score ?? 1.0 });
        }
      } catch {
        // 预测引擎检查可选
      }

      // 安全模块检查
      try {
        const securityHealth = this.checkSecurityHealth(services.security);
        serviceScores.push({ name: 'security', score: securityHealth.score });
        if (!securityHealth.healthy) {
          issues.push(securityHealth.issue ?? 'Security issue');
        }
      } catch {
        // 安全检查可选
      }

      // 计算综合评分
      if (serviceScores.length > 0) {
        totalScore = serviceScores.reduce((sum, s) => sum + s.score, 0) / serviceScores.length;
      }

      const healthy = issues.length === 0;
      const score = Math.max(0, Math.min(1, totalScore));

      return {
        component: 'coordinator',
        healthy,
        score,
        details: {
          services: Object.fromEntries(serviceScores.map(s => [s.name, s.score])),
          checkCount: this.checkCount,
        },
        lastChecked: timestamp,
        issue: issues.length > 0 ? issues.join('; ') : undefined,
      };
    } catch {
      // 如果无法获取 coordinator，返回 null
      return null;
    }
  }

  /**
   * 检查数据库健康状态
   */
  private async checkDatabaseHealth(db: unknown): Promise<{ score: number; healthy: boolean; issue?: string }> {
    // 简化实现，实际应检查连接池、查询延迟等
    return {
      score: 1.0,
      healthy: true,
    };
  }

  /**
   * 检查安全模块健康状态
   */
  private checkSecurityHealth(security: unknown): { score: number; healthy: boolean; issue?: string } {
    // 简化实现，实际应检查规则加载、检测统计等
    return {
      score: 1.0,
      healthy: true,
    };
  }

  /**
   * 计算总体健康评分
   */
  private calculateOverallScore(components: HealthStatus[]): number {
    if (components.length === 0) return 1.0;

    const weights: Record<string, number> = {
      system: 0.3,
      coordinator: 0.4,
      database: 0.15,
      security: 0.15,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const component of components) {
      const weight = weights[component.component] ?? (1 / components.length);
      weightedSum += component.score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 1.0;
  }

  /**
   * 确定总体健康状态
   */
  private determineOverallStatus(score: number, components: HealthStatus[]): 'healthy' | 'degraded' | 'critical' {
    const hasCritical = components.some(c => !c.healthy && c.score < 0.3);
    const hasDegraded = components.some(c => !c.healthy);

    if (hasCritical || score < 0.3) {
      return 'critical';
    }
    if (hasDegraded || score < 0.7) {
      return 'degraded';
    }
    return 'healthy';
  }

  /**
   * 检查是否需要生成告警
   */
  private checkForAlerts(components: HealthStatus[], metrics: SystemMetrics): HealthAlert[] {
    const alerts: HealthAlert[] = [];
    const now = Date.now();

    // 检查系统级告警
    const systemComponent = components.find(c => c.component === 'system');
    if (systemComponent) {
      if (metrics.memoryUsage >= this.config.memoryCriticalThreshold) {
        alerts.push({
          level: 'critical',
          component: 'system',
          message: `Memory usage critical: ${(metrics.memoryUsage * 100).toFixed(1)}%`,
          timestamp: now,
          suggestedAction: 'Consider restarting the application or freeing up memory',
        });
      } else if (metrics.memoryUsage >= this.config.memoryWarningThreshold) {
        alerts.push({
          level: 'warning',
          component: 'system',
          message: `Memory usage high: ${(metrics.memoryUsage * 100).toFixed(1)}%`,
          timestamp: now,
        });
      }

      if (metrics.eventLoopLag >= this.config.eventLoopLagCriticalMs) {
        alerts.push({
          level: 'critical',
          component: 'system',
          message: `Event loop lag critical: ${metrics.eventLoopLag.toFixed(0)}ms`,
          timestamp: now,
          suggestedAction: 'Check for blocking operations or excessive computation',
        });
      }
    }

    // 检查组件级告警
    for (const component of components) {
      if (!component.healthy && component.score < 0.5) {
        alerts.push({
          level: component.score < 0.3 ? 'error' : 'warning',
          component: component.component,
          message: component.issue ?? `Component ${component.component} is unhealthy`,
          timestamp: now,
        });
      }
    }

    return alerts;
  }

  /**
   * 测量 CPU 使用率
   */
  private async measureCpuUsage(): Promise<number> {
    // 简化实现，实际应使用 os.cpus() 或平台特定 API
    const startUsage = process.cpuUsage();
    await new Promise(resolve => setTimeout(resolve, 100));
    const endUsage = process.cpuUsage(startUsage);

    // 将微秒转换为比例（假设 100ms 内最多使用 200% CPU）
    const totalMs = endUsage.user / 1000 + endUsage.system / 1000;
    return Math.min(1, totalMs / 200);
  }

  /**
   * 测量事件循环延迟
   */
  private async measureEventLoopLag(): Promise<number> {
    const start = Date.now();
    await new Promise(resolve => setImmediate(resolve));
    return Date.now() - start;
  }
}
