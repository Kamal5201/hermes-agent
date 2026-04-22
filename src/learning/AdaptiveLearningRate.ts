/**
 * AdaptiveLearningRate.ts - 自适应学习率控制器
 *
 * 根据模型性能和系统状态动态调整学习率
 * 支持多种自适应策略：AdaGrad、RMSProp、Adam、热启动、余弦退火
 *
 * 主要功能：
 * - 基于损失变化率的自适应调整
 * - 基于验证集性能的早停机制
 * - 学习率预热（warm-up）和余弦退火
 * - 梯度裁剪和自适应缩放
 */

import log from 'electron-log/main.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface LearningRateConfig {
  /** 初始学习率 */
  initialRate: number;
  /** 最小学习率 */
  minRate: number;
  /** 最大学习率 */
  maxRate: number;
  /** 自适应策略 */
  strategy: 'constant' | 'adaGrad' | 'rmsProp' | 'adam' | 'cosineAnnealing' | 'warmupCosine';
  /** 热启动步数 */
  warmupSteps?: number;
  /** 余弦退火周期（步数） */
  cosAnnealingPeriod?: number;
  /** AdaGrad/RMSProp 的 rho 参数 */
  rho?: number;
  /** AdaGrad 的 epsilon 参数 */
  epsilon?: number;
  /** beta1 (Adam) */
  beta1?: number;
  /** beta2 (Adam) */
  beta2?: number;
}

export interface LearningRateState {
  /** 当前学习率 */
  currentRate: number;
  /** 迭代次数 */
  iteration: number;
  /** 累计梯度范数 */
  gradientNorm: number;
  /** 更新次数 */
  updateCount: number;
  /** 是否在热启动阶段 */
  isWarmingUp: boolean;
}

export interface TrainingMetrics {
  /** 当前损失 */
  loss: number;
  /** 验证损失 */
  validationLoss?: number;
  /** 损失变化率 */
  lossDelta: number;
  /** 梯度范数 */
  gradientNorm: number;
  /** 训练准确率 */
  trainAccuracy?: number;
  /** 验证准确率 */
  validationAccuracy?: number;
}

export interface AdaptiveAdjustmentResult {
  /** 建议的新学习率 */
  suggestedRate: number;
  /** 实际应用的学习率 */
  appliedRate: number;
  /** 调整原因 */
  reason: string;
  /** 是否触发了早停 */
  earlyStopTriggered: boolean;
  /** 早停剩余容忍次数 */
  earlyStopPatienceRemaining?: number;
}

// ============================================================================
// 自适应学习率控制器
// ============================================================================

export class AdaptiveLearningRate {
  private static instance: AdaptiveLearningRate | null = null;

  private config: LearningRateConfig;
  private state: LearningRateState;

  /** AdaGrad/RMSProp 累积变量 */
  private accumulatedGradient: number = 0;

  /** Adam 状态 */
  private adamFirstMoment: number = 0;
  private adamSecondMoment: number = 0;

  /** 早停相关 */
  private bestValidationLoss: number = Infinity;
  private earlyStopPatience: number = 5;
  private earlyStopCount: number = 0;

  /** 历史指标 */
  private lossHistory: number[] = [];
  private readonly lossHistoryMaxLength = 20;

  /** 梯度历史 */
  private gradientHistory: number[] = [];

  private constructor(config?: Partial<LearningRateConfig>) {
    this.config = {
      initialRate: config?.initialRate ?? 0.001,
      minRate: config?.minRate ?? 1e-6,
      maxRate: config?.maxRate ?? 0.1,
      strategy: config?.strategy ?? 'adam',
      warmupSteps: config?.warmupSteps ?? 100,
      cosAnnealingPeriod: config?.cosAnnealingPeriod ?? 1000,
      rho: config?.rho ?? 0.9,
      epsilon: config?.epsilon ?? 1e-8,
      beta1: config?.beta1 ?? 0.9,
      beta2: config?.beta2 ?? 0.999,
    };

    this.state = {
      currentRate: this.config.initialRate,
      iteration: 0,
      gradientNorm: 0,
      updateCount: 0,
      isWarmingUp: false,
    };

    log.info(`[AdaptiveLearningRate] Initialized with strategy: ${this.config.strategy}, initial rate: ${this.config.initialRate}`);
  }

  /**
   * 获取单例实例
   */
  public static getInstance(config?: Partial<LearningRateConfig>): AdaptiveLearningRate {
    if (!AdaptiveLearningRate.instance) {
      AdaptiveLearningRate.instance = new AdaptiveLearningRate(config);
    }
    return AdaptiveLearningRate.instance;
  }

  /**
   * 重置单例
   */
  public static resetInstance(config?: Partial<LearningRateConfig>): void {
    AdaptiveLearningRate.instance = null;
    if (config) {
      AdaptiveLearningRate.instance = new AdaptiveLearningRate(config);
    }
  }

  /**
   * 获取当前学习率
   */
  public getCurrentRate(): number {
    return this.state.currentRate;
  }

  /**
   * 获取当前状态
   */
  public getState(): LearningRateState {
    return { ...this.state };
  }

  /**
   * 获取配置
   */
  public getConfig(): LearningRateConfig {
    return { ...this.config };
  }

  /**
   * 基于损失更新学习率
   *
   * @param metrics 当前训练指标
   * @returns 自适应调整结果
   */
  public update(metrics: TrainingMetrics): AdaptiveAdjustmentResult {
    this.state.iteration++;

    // 记录历史
    this.lossHistory.push(metrics.loss);
    if (this.lossHistory.length > this.lossHistoryMaxLength) {
      this.lossHistory.shift();
    }

    this.gradientHistory.push(metrics.gradientNorm);
    if (this.gradientHistory.length > this.lossHistoryMaxLength) {
      this.gradientHistory.shift();
    }

    const lossDelta = this.lossHistory.length >= 2
      ? metrics.loss - this.lossHistory[this.lossHistory.length - 2]
      : 0;

    const result: AdaptiveAdjustmentResult = {
      suggestedRate: this.state.currentRate,
      appliedRate: this.state.currentRate,
      reason: 'no change',
      earlyStopTriggered: false,
    };

    // 检查热启动
    if (this.config.strategy === 'warmupCosine' && this.config.warmupSteps) {
      this.updateWarmupState();
    }

    // 计算新学习率
    let newRate = this.state.currentRate;

    switch (this.config.strategy) {
      case 'constant':
        newRate = this.config.initialRate;
        result.reason = 'constant rate';
        break;

      case 'adaGrad':
        newRate = this.computeAdaGradRate(metrics.gradientNorm);
        break;

      case 'rmsProp':
        newRate = this.computeRMSPropRate(metrics.gradientNorm);
        break;

      case 'adam':
        newRate = this.computeAdamRate(metrics.gradientNorm);
        break;

      case 'cosineAnnealing':
        newRate = this.computeCosineAnnealingRate();
        result.reason = 'cosine annealing decay';
        break;

      case 'warmupCosine':
        newRate = this.computeWarmupCosineRate();
        result.reason = this.state.isWarmingUp ? 'warmup phase' : 'warmup cosine decay';
        break;
    }

    // 应用早停检查
    if (metrics.validationLoss !== undefined) {
      const earlyStopResult = this.checkEarlyStop(metrics.validationLoss);
      if (earlyStopResult.triggered) {
        result.earlyStopTriggered = true;
        result.earlyStopPatienceRemaining = earlyStopResult.patienceRemaining;
        result.reason = `early stopping (patience: ${earlyStopResult.patienceRemaining})`;
      }
    }

    // 应用基于损失变化的调整
    const lossBasedAdjustment = this.computeLossBasedAdjustment(lossDelta);
    if (lossBasedAdjustment !== 1.0) {
      newRate *= lossBasedAdjustment;
      result.reason += `, loss-based scaling: ${lossBasedAdjustment.toFixed(3)}`;
    }

    // 应用梯度裁剪缩放
    if (metrics.gradientNorm > 1.0) {
      const clipScale = 1.0 / Math.min(metrics.gradientNorm, 10);
      newRate *= clipScale;
      result.reason += `, gradient clipping: ${clipScale.toFixed(3)}`;
    }

    // 限制学习率范围
    newRate = Math.max(this.config.minRate!, Math.min(this.config.maxRate!, newRate));

    // 如果学习率有变化
    if (Math.abs(newRate - this.state.currentRate) > 1e-12) {
      this.state.currentRate = newRate;
      result.appliedRate = newRate;
      result.suggestedRate = newRate;
    }

    this.state.gradientNorm = metrics.gradientNorm;
    this.state.updateCount++;

    log.debug(`[AdaptiveLearningRate] iter=${this.state.iteration} rate=${newRate.toExponential(3)} loss=${metrics.loss.toFixed(4)} delta=${lossDelta.toFixed(4)}`);

    return result;
  }

  /**
   * 手动设置学习率
   */
  public setRate(rate: number): void {
    this.state.currentRate = Math.max(this.config.minRate!, Math.min(this.config.maxRate!, rate));
    log.info(`[AdaptiveLearningRate] Rate manually set to: ${this.state.currentRate}`);
  }

  /**
   * 重置迭代计数器
   */
  public resetIteration(): void {
    this.state.iteration = 0;
    this.state.currentRate = this.config.initialRate;
    this.accumulatedGradient = 0;
    this.adamFirstMoment = 0;
    this.adamSecondMoment = 0;
    this.bestValidationLoss = Infinity;
    this.earlyStopCount = 0;
    this.lossHistory = [];
    this.gradientHistory = [];
    log.info('[AdaptiveLearningRate] State reset');
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<LearningRateConfig>): void {
    this.config = { ...this.config, ...config };
    log.info(`[AdaptiveLearningRate] Config updated: ${JSON.stringify(config)}`);
  }

  /**
   * 获取学习率调度器建议（用于可视化）
   */
  public getScheduleSuggestion(steps: number): Array<{ step: number; rate: number }> {
    const schedule: Array<{ step: number; rate: number }> = [];
    const originalState = { ...this.state };
    const originalConfig = { ...this.config };

    // 临时重置以计算调度
    this.state.iteration = 0;
    this.state.currentRate = this.config.initialRate;

    for (let i = 0; i < steps; i++) {
      schedule.push({ step: i, rate: this.state.currentRate });

      // 模拟一步更新
      const dummyMetrics: TrainingMetrics = {
        loss: 1.0,
        lossDelta: 0,
        gradientNorm: 1.0,
      };
      this.update(dummyMetrics);
    }

    // 恢复状态
    this.state = originalState;
    this.config = originalConfig;

    return schedule;
  }

  // ==================== 私有方法 ====================

  /**
   * 更新热启动状态
   */
  private updateWarmupState(): void {
    const warmupSteps = this.config.warmupSteps ?? 100;
    this.state.isWarmingUp = this.state.iteration < warmupSteps;
  }

  /**
   * AdaGrad 学习率计算
   */
  private computeAdaGradRate(gradientNorm: number): number {
    this.accumulatedGradient += gradientNorm * gradientNorm;
    const rate = this.config.initialRate / (Math.sqrt(this.accumulatedGradient) + (this.config.epsilon ?? 1e-8));
    return rate;
  }

  /**
   * RMSProp 学习率计算
   */
  private computeRMSPropRate(gradientNorm: number): number {
    const rho = this.config.rho ?? 0.9;
    this.accumulatedGradient = rho * this.accumulatedGradient + (1 - rho) * gradientNorm * gradientNorm;
    const rate = this.config.initialRate / (Math.sqrt(this.accumulatedGradient) + (this.config.epsilon ?? 1e-8));
    return rate;
  }

  /**
   * Adam 学习率计算
   */
  private computeAdamRate(gradientNorm: number): number {
    const beta1 = this.config.beta1 ?? 0.9;
    const beta2 = this.config.beta2 ?? 0.999;
    const epsilon = this.config.epsilon ?? 1e-8;

    // 更新一阶矩估计
    this.adamFirstMoment = beta1 * this.adamFirstMoment + (1 - beta1) * gradientNorm;
    // 更新二阶矩估计
    this.adamSecondMoment = beta2 * this.adamSecondMoment + (1 - beta2) * gradientNorm * gradientNorm;

    // 偏差校正
    const iter = this.state.iteration;
    const firstUnbiased = this.adamFirstMoment / (1 - Math.pow(beta1, iter));
    const secondUnbiased = this.adamSecondMoment / (1 - Math.pow(beta2, iter));

    const rate = this.config.initialRate * firstUnbiased / (Math.sqrt(secondUnbiased) + epsilon);
    return rate;
  }

  /**
   * 余弦退火学习率计算
   */
  private computeCosineAnnealingRate(): number {
    const period = this.config.cosAnnealingPeriod ?? 1000;
    const progress = this.state.iteration / period;
    const cosine = (1 + Math.cos(Math.PI * progress)) / 2;
    return this.config.minRate! + cosine * (this.config.initialRate - this.config.minRate!);
  }

  /**
   * 热启动 + 余弦退火学习率计算
   */
  private computeWarmupCosineRate(): number {
    const warmupSteps = this.config.warmupSteps ?? 100;
    const period = this.config.cosAnnealingPeriod ?? 1000;

    // 热启动阶段
    if (this.state.iteration < warmupSteps) {
      const warmupProgress = this.state.iteration / warmupSteps;
      return this.config.minRate! + warmupProgress * (this.config.initialRate - this.config.minRate!);
    }

    // 余弦退火阶段
    const cosineProgress = (this.state.iteration - warmupSteps) / (period - warmupSteps);
    const clampedProgress = Math.min(1, Math.max(0, cosineProgress));
    const cosine = (1 + Math.cos(Math.PI * clampedProgress)) / 2;

    return this.config.minRate! + cosine * (this.config.initialRate - this.config.minRate!);
  }

  /**
   * 基于损失变化率调整学习率
   */
  private computeLossBasedAdjustment(lossDelta: number): number {
    if (this.lossHistory.length < 3 || Math.abs(lossDelta) < 1e-6) {
      return 1.0;
    }

    // 检测损失趋势
    const recentLosses = this.lossHistory.slice(-5);
    const isIncreasing = recentLosses[recentLosses.length - 1] > recentLosses[0];

    if (isIncreasing) {
      // 损失上升：降低学习率
      const increaseRatio = recentLosses[recentLosses.length - 1] / Math.max(recentLosses[0], 1e-6);
      if (increaseRatio > 1.1) {
        return 0.5; // 大幅降低
      } else if (increaseRatio > 1.05) {
        return 0.8;
      }
    } else {
      // 损失下降：可以适当提高学习率
      const decreaseRatio = recentLosses[0] / Math.max(recentLosses[recentLosses.length - 1], 1e-6);
      if (decreaseRatio > 1.2) {
        return 1.2; // 小幅提高
      } else if (decreaseRatio > 1.1) {
        return 1.1;
      }
    }

    return 1.0;
  }

  /**
   * 早停检查
   */
  private checkEarlyStop(validationLoss: number): { triggered: boolean; patienceRemaining: number } {
    const minDelta = 1e-4;

    if (validationLoss < this.bestValidationLoss - minDelta) {
      // 损失改善
      this.bestValidationLoss = validationLoss;
      this.earlyStopCount = 0;
    } else {
      // 损失没有改善
      this.earlyStopCount++;

      if (this.earlyStopCount >= this.earlyStopPatience) {
        return { triggered: true, patienceRemaining: 0 };
      }
    }

    return { triggered: false, patienceRemaining: this.earlyStopPatience - this.earlyStopCount };
  }

  /**
   * 计算损失平滑值
   */
  public getSmoothedLoss(windowSize?: number): number {
    const window = windowSize ?? 5;
    const recent = this.lossHistory.slice(-window);
    if (recent.length === 0) return 0;
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * 获取梯度平滑值
   */
  public getSmoothedGradientNorm(windowSize?: number): number {
    const window = windowSize ?? 5;
    const recent = this.gradientHistory.slice(-window);
    if (recent.length === 0) return 0;
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * 导出当前状态（用于持久化）
   */
  public exportState(): {
    config: LearningRateConfig;
    state: LearningRateState;
    accumulatedGradient: number;
    bestValidationLoss: number;
  } {
    return {
      config: { ...this.config },
      state: { ...this.state },
      accumulatedGradient: this.accumulatedGradient,
      bestValidationLoss: this.bestValidationLoss,
    };
  }

  /**
   * 从持久化状态恢复
   */
  public importState(state: {
    config: LearningRateConfig;
    state: LearningRateState;
    accumulatedGradient: number;
    bestValidationLoss: number;
  }): void {
    this.config = { ...state.config };
    this.state = { ...state.state };
    this.accumulatedGradient = state.accumulatedGradient;
    this.bestValidationLoss = state.bestValidationLoss;
    log.info('[AdaptiveLearningRate] State restored from imported data');
  }
}
