/**
 * ConfidenceCalibrator.ts - 置信度校准器
 *
 * 使用统计方法对预测置信度进行校准，使其更符合实际准确率
 * 支持多种校准方法：Platt Scaling、Isotonic Regression、温度调节
 *
 * 主要功能：
 * - 历史预测-实际结果对比分析
 * - 置信度与准确率的映射校准
 * - 预测不确定性量化
 * - 校准质量评估（ECE、MCE）
 */

import log from 'electron-log/main.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface CalibrationConfig {
  /** 校准方法 */
  method: 'platt' | 'isotonic' | 'temperature' | 'histogram';
  /** 温度参数（用于温度调节法） */
  temperature?: number;
  /** 直方图分桶数（用于直方图校准） */
  numBins?: number;
  /** 最小样本数才开始校准 */
  minSamples?: number;
  /** 滑动窗口大小（用于持续校准） */
  windowSize?: number;
}

export interface CalibrationResult {
  /** 校准后的置信度 */
  calibratedConfidence: number;
  /** 原始置信度 */
  rawConfidence: number;
  /** 校准偏移量 */
  calibrationOffset: number;
  /** 预测间隔（下限） */
  lowerBound: number;
  /** 预测间隔（上限） */
  upperBound: number;
  /** 不确定性得分 */
  uncertainty: number;
}

export interface PredictionRecord {
  id: string;
  rawConfidence: number;
  actualOutcome: boolean;
  timestamp: number;
  predictionType: string;
}

export interface CalibrationMetrics {
  /** 期望校准误差（ECE） */
  expectedCalibrationError: number;
  /** 最大校准误差（MCE） */
  maxCalibrationError: number;
  /** 总样本数 */
  totalSamples: number;
  /** 准确率 */
  accuracy: number;
  /** Brier Score */
  brierScore: number;
  /** 校准质量评级 */
  qualityGrade: 'excellent' | 'good' | 'fair' | 'poor';
}

// ============================================================================
// Platt Scaling 校准器
// ============================================================================

class PlattScaler {
  private a = 1.0; // 斜率
  private b = 0.0; // 截距
  private fitted = false;

  /**
   * 使用二元交叉熵损失拟合参数
   */
  public fit(positives: number[], negatives: number[]): void {
    const n = positives.length + negatives.length;
    if (n < 2) {
      log.warn('[PlattScaler] Insufficient samples for fitting');
      return;
    }

    // 简单线性回归拟合
    // 使用 sigmoid 变换: p = 1 / (1 + exp(-(a*x + b)))
    // 转换为 logit 空间进行线性回归

    const allScores: Array<{ score: number; label: number }> = [
      ...positives.map(s => ({ score: s, label: 1 })),
      ...negatives.map(s => ({ score: s, label: 0 })),
    ];

    // 过滤掉极端值
    const validScores = allScores.filter(s => s.score > 0.001 && s.score < 0.999);

    if (validScores.length < 2) {
      log.warn('[PlattScaler] No valid scores for fitting');
      return;
    }

    // 计算均值和方差
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const { score, label } of validScores) {
      const logit = Math.log(score / (1 - score));
      sumX += logit;
      sumY += label;
      sumXY += logit * label;
      sumX2 += logit * logit;
    }

    const m = validScores.length;
    const xMean = sumX / m;
    const yMean = sumY / m;

    const denominator = sumX2 - sumX * sumX / m;
    if (Math.abs(denominator) < 1e-10) {
      log.warn('[PlattScaler] Singular matrix during fitting');
      return;
    }

    this.a = (sumXY - sumX * sumY / m) / denominator;
    this.b = yMean - this.a * xMean;

    // 限制参数范围以防止过拟合
    this.a = Math.max(0.1, Math.min(10, this.a));
    this.b = Math.max(-5, Math.min(5, this.b));

    this.fitted = true;
    log.debug(`[PlattScaler] Fitted: a=${this.a.toFixed(3)}, b=${this.b.toFixed(3)}`);
  }

  /**
   * 校准单个置信度
   */
  public calibrate(confidence: number): number {
    if (!this.fitted) {
      return confidence;
    }

    const logit = Math.log(Math.max(1e-10, confidence) / Math.max(1e-10, 1 - confidence));
    const calibratedLogit = this.a * logit + this.b;
    const calibrated = 1 / (1 + Math.exp(-calibratedLogit));

    return Math.max(0, Math.min(1, calibrated));
  }
}

// ============================================================================
// 直方图校准器
// ============================================================================

class HistogramCalibrator {
  private bins: Array<{ lower: number; upper: number; count: number; positives: number }> = [];
  private numBins: number;
  private minSamplesPerBin: number;

  constructor(numBins: number = 10, minSamplesPerBin: number = 5) {
    this.numBins = numBins;
    this.minSamplesPerBin = minSamplesPerBin;
    this.initializeBins();
  }

  private initializeBins(): void {
    this.bins = [];
    for (let i = 0; i < this.numBins; i++) {
      this.bins.push({
        lower: i / this.numBins,
        upper: (i + 1) / this.numBins,
        count: 0,
        positives: 0,
      });
    }
  }

  /**
   * 添加样本进行校准
   */
  public addSample(confidence: number, positive: boolean): void {
    const binIndex = Math.min(Math.floor(confidence * this.numBins), this.numBins - 1);
    this.bins[binIndex].count++;
    if (positive) {
      this.bins[binIndex].positives++;
    }
  }

  /**
   * 批量添加样本
   */
  public addSamples(records: PredictionRecord[]): void {
    for (const record of records) {
      this.addSample(record.rawConfidence, record.actualOutcome);
    }
  }

  /**
   * 校准单个置信度
   */
  public calibrate(confidence: number): number {
    const binIndex = Math.min(Math.floor(confidence * this.numBins), this.numBins - 1);
    const bin = this.bins[binIndex];

    if (bin.count < this.minSamplesPerBin) {
      // 样本不足，使用加权平均
      let weightedSum = 0;
      let totalWeight = 0;

      for (let i = 0; i < this.bins.length; i++) {
        if (this.bins[i].count > 0) {
          const weight = this.bins[i].count;
          const avgConfidence = this.bins[i].positives / this.bins[i].count;
          weightedSum += weight * avgConfidence;
          totalWeight += weight;
        }
      }

      return totalWeight > 0 ? weightedSum / totalWeight : confidence;
    }

    return bin.positives / bin.count;
  }

  /**
   * 获取校准后的映射表
   */
  public getCalibrationTable(): Array<{ bin: string; raw: number; calibrated: number; count: number }> {
    return this.bins.map((bin, i) => {
      const raw = (bin.lower + bin.upper) / 2;
      const calibrated = bin.count > 0 ? bin.positives / bin.count : raw;
      return {
        bin: `${(bin.lower * 100).toFixed(0)}-${(bin.upper * 100).toFixed(0)}%`,
        raw,
        calibrated: Math.max(0, Math.min(1, calibrated)),
        count: bin.count,
      };
    });
  }

  /**
   * 重置校准器
   */
  public reset(): void {
    this.initializeBins();
  }
}

// ============================================================================
// 置信度校准器主类
// ============================================================================

export class ConfidenceCalibrator {
  private static instance: ConfidenceCalibrator | null = null;

  private config: CalibrationConfig;
  private plattScaler: PlattScaler;
  private histogramCalibrator: HistogramCalibrator;
  private predictionHistory: PredictionRecord[] = [];
  private temperature: number;

  /** 历史统计 */
  private totalPredictions = 0;
  private correctPredictions = 0;

  private constructor(config?: Partial<CalibrationConfig>) {
    this.config = {
      method: config?.method ?? 'histogram',
      temperature: config?.temperature ?? 1.0,
      numBins: config?.numBins ?? 10,
      minSamples: config?.minSamples ?? 20,
      windowSize: config?.windowSize ?? 1000,
    };

    this.temperature = this.config.temperature ?? 1.0;
    this.plattScaler = new PlattScaler();
    this.histogramCalibrator = new HistogramCalibrator(this.config.numBins ?? 10);

    log.info(`[ConfidenceCalibrator] Initialized with method: ${this.config.method}`);
  }

  /**
   * 获取单例实例
   */
  public static getInstance(config?: Partial<CalibrationConfig>): ConfidenceCalibrator {
    if (!ConfidenceCalibrator.instance) {
      ConfidenceCalibrator.instance = new ConfidenceCalibrator(config);
    }
    return ConfidenceCalibrator.instance;
  }

  /**
   * 重置单例
   */
  public static resetInstance(config?: Partial<CalibrationConfig>): void {
    ConfidenceCalibrator.instance = null;
    if (config) {
      ConfidenceCalibrator.instance = new ConfidenceCalibrator(config);
    }
  }

  /**
   * 记录预测结果
   */
  public recordPrediction(
    id: string,
    rawConfidence: number,
    actualOutcome: boolean,
    predictionType: string
  ): void {
    const record: PredictionRecord = {
      id,
      rawConfidence,
      actualOutcome,
      timestamp: Date.now(),
      predictionType,
    };

    this.predictionHistory.push(record);
    this.totalPredictions++;
    if (actualOutcome) {
      this.correctPredictions++;
    }

    // 保持窗口大小
    if (this.predictionHistory.length > (this.config.windowSize ?? 1000)) {
      this.predictionHistory.shift();
    }

    // 添加到直方图校准器
    this.histogramCalibrator.addSample(rawConfidence, actualOutcome);

    // 如果样本足够，触发 Platt 重新拟合
    if (this.shouldRefitPlatt()) {
      this.refitPlattScaler();
    }

    log.debug(`[ConfidenceCalibrator] Recorded prediction ${id}: conf=${rawConfidence.toFixed(3)}, actual=${actualOutcome}`);
  }

  /**
   * 校准置信度
   */
  public calibrate(rawConfidence: number): CalibrationResult {
    const { calibratedConfidence, lowerBound, upperBound, uncertainty } = this.computeCalibratedConfidence(rawConfidence);

    return {
      calibratedConfidence,
      rawConfidence,
      calibrationOffset: calibratedConfidence - rawConfidence,
      lowerBound,
      upperBound,
      uncertainty,
    };
  }

  /**
   * 批量校准
   */
  public calibrateBatch(rawConfidences: number[]): CalibrationResult[] {
    return rawConfidences.map(c => this.calibrate(c));
  }

  /**
   * 获取校准质量指标
   */
  public getCalibrationMetrics(): CalibrationMetrics {
    const ece = this.computeECE();
    const accuracy = this.totalPredictions > 0 ? this.correctPredictions / this.totalPredictions : 0;
    const brier = this.computeBrierScore();

    return {
      expectedCalibrationError: ece,
      maxCalibrationError: this.computeMCE(),
      totalSamples: this.totalPredictions,
      accuracy,
      brierScore: brier,
      qualityGrade: this.computeQualityGrade(ece),
    };
  }

  /**
   * 获取校准后的预测间隔（不确定性量化）
   */
  public getPredictionInterval(rawConfidence: number, confidenceLevel: number = 0.95): { lower: number; upper: number } {
    const { uncertainty } = this.computeCalibratedConfidence(rawConfidence);
    const zScore = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.99 ? 2.576 : 1.645;

    // 使用 uncertainty 调整间隔
    const intervalWidth = zScore * uncertainty;
    const center = rawConfidence; // 使用原始置信度作为中心

    return {
      lower: Math.max(0, center - intervalWidth / 2),
      upper: Math.min(1, center + intervalWidth / 2),
    };
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<CalibrationConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.numBins !== undefined) {
      this.histogramCalibrator = new HistogramCalibrator(config.numBins);
      // 重新添加历史数据
      for (const record of this.predictionHistory) {
        this.histogramCalibrator.addSample(record.rawConfidence, record.actualOutcome);
      }
    }

    if (config.temperature !== undefined) {
      this.temperature = config.temperature;
    }

    log.info(`[ConfidenceCalibrator] Configuration updated: ${JSON.stringify(config)}`);
  }

  /**
   * 重置所有校准数据
   */
  public reset(): void {
    this.predictionHistory = [];
    this.totalPredictions = 0;
    this.correctPredictions = 0;
    this.plattScaler = new PlattScaler();
    this.histogramCalibrator.reset();

    log.info('[ConfidenceCalibrator] All calibration data reset');
  }

  /**
   * 导出校准状态（用于持久化）
   */
  public exportState(): {
    config: CalibrationConfig;
    totalPredictions: number;
    correctPredictions: number;
    calibrationTable: ReturnType<HistogramCalibrator['getCalibrationTable']>;
  } {
    return {
      config: this.config,
      totalPredictions: this.totalPredictions,
      correctPredictions: this.correctPredictions,
      calibrationTable: this.histogramCalibrator.getCalibrationTable(),
    };
  }

  // ==================== 私有方法 ====================

  /**
   * 计算校准后的置信度及其不确定性
   */
  private computeCalibratedConfidence(rawConfidence: number): {
    calibratedConfidence: number;
    lowerBound: number;
    upperBound: number;
    uncertainty: number;
  } {
    let calibrated: number;

    switch (this.config.method) {
      case 'platt':
        calibrated = this.plattScaler.calibrate(rawConfidence);
        break;

      case 'temperature':
        calibrated = this.applyTemperatureScaling(rawConfidence);
        break;

      case 'histogram':
      default:
        calibrated = this.histogramCalibrator.calibrate(rawConfidence);
        break;
    }

    // 计算不确定性（基于局部样本密度）
    const uncertainty = this.computeLocalUncertainty(rawConfidence);

    // 使用不确定性计算预测间隔
    const intervalWidth = 2 * uncertainty; // 约 95% 间隔
    const lowerBound = Math.max(0, calibrated - intervalWidth / 2);
    const upperBound = Math.min(1, calibrated + intervalWidth / 2);

    return {
      calibratedConfidence: calibrated,
      lowerBound,
      upperBound,
      uncertainty,
    };
  }

  /**
   * 温度调节法
   */
  private applyTemperatureScaling(confidence: number): number {
    // 使用温度调节 softmax 温度
    const logit = Math.log(confidence / (1 - confidence));
    const scaledLogit = logit / this.temperature;
    return 1 / (1 + Math.exp(-scaledLogit));
  }

  /**
   * 计算局部不确定性
   */
  private computeLocalUncertainty(confidence: number): number {
    // 基于最近样本计算局部准确率方差
    const windowSize = Math.min(50, this.predictionHistory.length);
    if (windowSize < 5) {
      return 0.5; // 缺乏数据时返回高不确定性
    }

    const recentRecords = this.predictionHistory.slice(-windowSize);

    // 按置信度分组计算方差
    const nearbyRecords = recentRecords.filter(
      r => Math.abs(r.rawConfidence - confidence) < 0.1
    );

    if (nearbyRecords.length < 3) {
      return 0.3; // 局部样本不足
    }

    const accuracies: number[] = nearbyRecords.map(r => r.actualOutcome ? 1 : 0);
    const mean = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
    const variance = accuracies.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / accuracies.length;

    return Math.sqrt(variance);
  }

  /**
   * 判断是否应该重新拟合 Platt
   */
  private shouldRefitPlatt(): boolean {
    const minPositives = 10;
    const minNegatives = 10;
    const recentRecords = this.predictionHistory.slice(-100);

    const positives = recentRecords.filter(r => r.actualOutcome).length;
    const negatives = recentRecords.length - positives;

    return positives >= minPositives && negatives >= minNegatives;
  }

  /**
   * 重新拟合 Platt Scaler
   */
  private refitPlattScaler(): void {
    const recentRecords = this.predictionHistory.slice(-500);
    const positives = recentRecords.filter(r => r.actualOutcome).map(r => r.rawConfidence);
    const negatives = recentRecords.filter(r => !r.actualOutcome).map(r => r.rawConfidence);

    this.plattScaler.fit(positives, negatives);
  }

  /**
   * 计算期望校准误差 (ECE)
   */
  private computeECE(): number {
    const numBins = 10;
    const binSize = 1 / numBins;
    let totalEce = 0;

    for (let i = 0; i < numBins; i++) {
      const binLower = i * binSize;
      const binUpper = (i + 1) * binSize;

      const binRecords = this.predictionHistory.filter(
        r => r.rawConfidence >= binLower && r.rawConfidence < binUpper
      );

      if (binRecords.length === 0) continue;

      const avgConfidence = binRecords.reduce((sum, r) => sum + r.rawConfidence, 0) / binRecords.length;
      const accuracy = binRecords.filter(r => r.actualOutcome).length / binRecords.length;
      const binWeight = binRecords.length / this.predictionHistory.length;

      totalEce += binWeight * Math.abs(avgConfidence - accuracy);
    }

    return totalEce;
  }

  /**
   * 计算最大校准误差 (MCE)
   */
  private computeMCE(): number {
    const numBins = 10;
    const binSize = 1 / numBins;
    let maxEce = 0;

    for (let i = 0; i < numBins; i++) {
      const binLower = i * binSize;
      const binUpper = (i + 1) * binSize;

      const binRecords = this.predictionHistory.filter(
        r => r.rawConfidence >= binLower && r.rawConfidence < binUpper
      );

      if (binRecords.length === 0) continue;

      const avgConfidence = binRecords.reduce((sum, r) => sum + r.rawConfidence, 0) / binRecords.length;
      const accuracy = binRecords.filter(r => r.actualOutcome).length / binRecords.length;

      maxEce = Math.max(maxEce, Math.abs(avgConfidence - accuracy));
    }

    return maxEce;
  }

  /**
   * 计算 Brier Score
   */
  private computeBrierScore(): number {
    if (this.predictionHistory.length === 0) return 0;

    const sum = this.predictionHistory.reduce((acc, r) => {
      const calibrated = this.histogramCalibrator.calibrate(r.rawConfidence);
      return acc + Math.pow(calibrated - (r.actualOutcome ? 1 : 0), 2);
    }, 0);

    return sum / this.predictionHistory.length;
  }

  /**
   * 根据 ECE 计算校准质量等级
   */
  private computeQualityGrade(ece: number): CalibrationMetrics['qualityGrade'] {
    if (ece < 0.05) return 'excellent';
    if (ece < 0.10) return 'good';
    if (ece < 0.20) return 'fair';
    return 'poor';
  }
}
