import DatabaseManager from '../database/DatabaseManager';
import {
  WindowHistory,
  OperationHistory,
  AppUsageStats,
  TimePattern,
  OperationPattern,
  UserHabit,
  AttentionRecord,
  LearningProgress,
  PredictionCache,
} from '../database/DatabaseManager';

export interface UserProfile {
  userId: string;
  learningDay: number;
  lastLearningTimestamp: number;
  appUsageFrequency: Record<string, number>;
  timePatterns: TimePattern[];
  operationPatterns: OperationPattern[];
  habits: UserHabit[];
  attentionModel: AttentionModel | null;
  predictionWeights: PredictionWeights;
  feedbackCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AttentionModel {
  avgFocusScore: number;
  avgAttentionRate: number;
  peakHours: number[];
  lowFocusHours: number[];
  interruptionFrequency: number;
  productivityByHour: Record<number, number>;
}

export interface PredictionWeights {
  timePattern: number;
  operationPattern: number;
  appFrequency: number;
  attention: number;
  recency: number;
}

export interface RepetitionResult {
  isRepetitive: boolean;
  patternHash: string | null;
  confidence: number;
  nextExpected: string | null;
}

export interface FeedbackRecord {
  id?: number;
  predictionType: string;
  predictedApp: string;
  actualApp: string;
  context: string;
  feedback: 'accept' | 'reject' | 'modify';
  timestamp: number;
}

export class LearningEngine {
  private db: DatabaseManager;
  private userProfile: UserProfile;
  private learningDay: number = 1;
  private continuousLearningInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly CYCLE_DAYS = 7;
  private readonly MIN_PATTERN_FREQUENCY = 3;
  private readonly REPETITION_THRESHOLD = 0.7;

  constructor(db: DatabaseManager) {
    this.db = db;
    this.userProfile = this.initializeProfile();
  }

  private initializeProfile(): UserProfile {
    const now = Math.floor(Date.now() / 1000);
    return {
      userId: 'default',
      learningDay: 1,
      lastLearningTimestamp: now,
      appUsageFrequency: {},
      timePatterns: [],
      operationPatterns: [],
      habits: [],
      attentionModel: null,
      predictionWeights: {
        timePattern: 0.25,
        operationPattern: 0.25,
        appFrequency: 0.25,
        attention: 0.15,
        recency: 0.10,
      },
      feedbackCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ==================== DAY 1: BASIC COLLECTION ====================

  /**
   * Day 1: Collect window history data
   */
  public async day1_BasicCollection(): Promise<void> {
    console.log('[LearningEngine] Day 1: Starting basic data collection...');

    try {
      // Collect recent window history
      const windowHistory = this.db.getWindowHistory(1000);
      
      // Aggregate app usage frequency from window history
      const appFrequency: Record<string, number> = {};
      for (const window of windowHistory) {
        if (window.app_name) {
          appFrequency[window.app_name] = (appFrequency[window.app_name] || 0) + 1;
        }
      }

      // Store app usage stats from window history
      const appUsageMap = new Map<string, AppUsageStats>();
      for (const window of windowHistory) {
        if (window.app_name && window.start_time) {
          const date = new Date(window.start_time * 1000).toISOString().split('T')[0];
          const existing = appUsageMap.get(window.app_name);
          if (existing) {
            existing.duration = (existing.duration || 0) + (window.duration || 0);
          } else {
            appUsageMap.set(window.app_name, {
              app_name: window.app_name,
              app_path: window.url || undefined,
              duration: window.duration || 0,
              start_time: window.start_time,
              end_time: window.end_time,
              date,
              focus_time: 0,
              idle_time: 0,
            });
          }
        }
      }

      // Save app usage stats
      for (const stats of Array.from(appUsageMap.values())) {
        try {
          this.db.createAppUsageStats(stats);
        } catch (e) {
          // Ignore duplicates or errors
        }
      }

      // Update user profile
      this.userProfile.appUsageFrequency = appFrequency;
      this.userProfile.learningDay = Math.max(this.userProfile.learningDay, 1);
      this.userProfile.lastLearningTimestamp = Math.floor(Date.now() / 1000);

      console.log(`[LearningEngine] Day 1: Collected ${windowHistory.length} window history records`);
      console.log(`[LearningEngine] Day 1: Identified ${Object.keys(appFrequency).length} unique apps`);
    } catch (error) {
      console.error('[LearningEngine] Day 1: Error during basic collection:', error);
      throw error;
    }
  }

  /**
   * Collect operation history for Day 1
   */
  public async collectOperationHistory(): Promise<void> {
    try {
      const operations = this.db.getOperationHistory(500);
      console.log(`[LearningEngine] Day 1: Collected ${operations.length} operation history records`);
    } catch (error) {
      console.error('[LearningEngine] Day 1: Error collecting operation history:', error);
    }
  }

  /**
   * Collect app usage for Day 1
   */
  public async collectAppUsage(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const appUsage = this.db.getAppUsageStats(today);
      console.log(`[LearningEngine] Day 1: Today's app usage has ${appUsage.length} records`);
    } catch (error) {
      console.error('[LearningEngine] Day 1: Error collecting app usage:', error);
    }
  }

  // ==================== DAY 2: TIME PATTERN DISCOVERY ====================

  /**
   * Day 2: Identify time-based patterns (what apps at what times)
   */
  public async day2_TimePatternDiscovery(): Promise<void> {
    console.log('[LearningEngine] Day 2: Starting time pattern discovery...');

    try {
      const windowHistory = this.db.getWindowHistory(2000);
      const hourAppCounts: Record<number, Record<string, number>> = {};
      const dayOfWeekAppCounts: Record<number, Record<string, number>> = {};

      // Initialize hour buckets (0-23)
      for (let hour = 0; hour < 24; hour++) {
        hourAppCounts[hour] = {};
      }
      // Initialize day of week buckets (0-6)
      for (let day = 0; day < 7; day++) {
        dayOfWeekAppCounts[day] = {};
      }

      // Aggregate app usage by hour and day of week
      for (const window of windowHistory) {
        if (window.app_name && window.start_time) {
          const date = new Date(window.start_time * 1000);
          const hour = date.getHours();
          const dayOfWeek = date.getDay();
          const duration = window.duration || 1;

          hourAppCounts[hour][window.app_name] = (hourAppCounts[hour][window.app_name] || 0) + duration;
          dayOfWeekAppCounts[dayOfWeek][window.app_name] = (dayOfWeekAppCounts[dayOfWeek][window.app_name] || 0) + duration;
        }
      }

      // Find high-usage patterns for each hour
      const patterns: TimePattern[] = [];
      
      for (let hour = 0; hour < 24; hour++) {
        const appsInHour = hourAppCounts[hour];
        const totalDuration = Object.values(appsInHour).reduce((a, b) => a + b, 0);
        
        if (totalDuration > 0) {
          // Find most used app in this hour
          let maxApp = '';
          let maxDuration = 0;
          for (const [app, duration] of Object.entries(appsInHour)) {
            if (duration > maxDuration) {
              maxDuration = duration;
              maxApp = app;
            }
          }

          const confidence = totalDuration > 3600 ? 0.9 : totalDuration > 1800 ? 0.7 : 0.5;
          
          patterns.push({
            pattern_type: 'hourly_app',
            day_of_week: undefined,
            hour_start: hour,
            hour_end: hour + 1,
            frequency: totalDuration,
            avg_duration: totalDuration,
            confidence,
            metadata: JSON.stringify({ top_app: maxApp, all_apps: appsInHour }),
          });
        }
      }

      // Find patterns for days of week
      for (let day = 0; day < 7; day++) {
        const appsOnDay = dayOfWeekAppCounts[day];
        const totalDuration = Object.values(appsOnDay).reduce((a, b) => a + b, 0);
        
        if (totalDuration > 0) {
          patterns.push({
            pattern_type: 'daily_app',
            day_of_week: day,
            hour_start: undefined,
            hour_end: undefined,
            frequency: totalDuration,
            avg_duration: totalDuration / 24,
            confidence: 0.6,
            metadata: JSON.stringify({ apps: appsOnDay }),
          });
        }
      }

      // Save patterns to database
      for (const pattern of patterns) {
        try {
          this.db.createTimePattern(pattern);
        } catch (e) {
          // Ignore errors
        }
      }

      // Update user profile
      this.userProfile.timePatterns = patterns;
      this.userProfile.learningDay = Math.max(this.userProfile.learningDay, 2);

      console.log(`[LearningEngine] Day 2: Discovered ${patterns.length} time patterns`);
    } catch (error) {
      console.error('[LearningEngine] Day 2: Error during time pattern discovery:', error);
      throw error;
    }
  }

  /**
   * Identify time patterns (public wrapper)
   */
  public async identifyTimePatterns(): Promise<TimePattern[]> {
    await this.day2_TimePatternDiscovery();
    return this.userProfile.timePatterns;
  }

  // ==================== DAY 3: FIND OPERATION PATTERNS ====================

  /**
   * Day 3: Find repetitive operation sequences
   */
  public async day3_findOperationPatterns(): Promise<void> {
    console.log('[LearningEngine] Day 3: Starting operation pattern discovery...');

    try {
      const operations = this.db.getOperationHistory(1000);
      
      // Build sequences of operations
      const sequences: string[] = [];
      const sequenceWindow = 5; // Look at sequences of 5 operations

      for (let i = 0; i < operations.length - sequenceWindow + 1; i++) {
        const sequence = operations
          .slice(i, i + sequenceWindow)
          .map(op => op.operation_type)
          .join('->');
        sequences.push(sequence);
      }

      // Count sequence frequencies
      const sequenceCounts: Record<string, number> = {};
      for (const seq of sequences) {
        sequenceCounts[seq] = (sequenceCounts[seq] || 0) + 1;
      }

      // Find patterns with minimum frequency
      const patterns: OperationPattern[] = [];
      
      for (const [sequence, count] of Object.entries(sequenceCounts)) {
        if (count >= this.MIN_PATTERN_FREQUENCY) {
          const hash = this.hashString(sequence);
          const existing = this.db.getOperationPatternByHash(hash);
          
          if (!existing) {
            patterns.push({
              pattern_name: `Sequence_${count}x`,
              pattern_hash: hash,
              operation_sequence: sequence,
              frequency: count,
              avg_duration: 0,
              success_rate: 1.0,
              last_occurrence: Math.floor(Date.now() / 1000),
            });
          }
        }
      }

      // Save patterns to database
      for (const pattern of patterns) {
        try {
          this.db.createOperationPattern(pattern);
        } catch (e) {
          // Ignore errors
        }
      }

      // Update user profile
      this.userProfile.operationPatterns = this.db.getAllOperationPatterns();
      this.userProfile.learningDay = Math.max(this.userProfile.learningDay, 3);

      console.log(`[LearningEngine] Day 3: Discovered ${patterns.length} operation patterns`);
    } catch (error) {
      console.error('[LearningEngine] Day 3: Error during operation pattern discovery:', error);
      throw error;
    }
  }

  /**
   * Find operation patterns (public wrapper)
   */
  public async findOperationPatterns(): Promise<OperationPattern[]> {
    await this.day3_findOperationPatterns();
    return this.userProfile.operationPatterns;
  }

  // ==================== DAY 4: INTENT UNDERSTANDING ====================

  /**
   * Day 4: Build intent model from operation context correlation
   */
  public async day4_IntentUnderstanding(): Promise<void> {
    console.log('[LearningEngine] Day 4: Starting intent understanding...');

    try {
      const windowHistory = this.db.getWindowHistory(500);
      const operations = this.db.getOperationHistory(500);

      // Correlate operations with window/app context
      const intentMap: Record<string, { operations: string[], count: number }> = {};

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const timestamp = op.timestamp || 0;
        
        // Find the active window at this time
        const activeWindow = windowHistory.find(
          w => w.start_time <= timestamp && (w.end_time === undefined || w.end_time >= timestamp)
        );
        
        if (activeWindow && activeWindow.app_name) {
          const key = `${activeWindow.app_name}_${op.operation_type}`;
          if (!intentMap[key]) {
            intentMap[key] = { operations: [], count: 0 };
          }
          intentMap[key].operations.push(op.operation_type);
          intentMap[key].count++;
        }
      }

      // Create user habits from intent correlations
      const habits: UserHabit[] = [];
      
      for (const [key, data] of Object.entries(intentMap)) {
        const [appName, triggerType] = key.split('_');
        if (data.count >= this.MIN_PATTERN_FREQUENCY) {
          const habit: UserHabit = {
            habit_name: `${appName}_habit`,
            trigger_context: appName,
            trigger_type: triggerType,
            action_sequence: Array.from(new Set(data.operations)).join('->'),
            frequency: data.count,
            confidence: Math.min(data.count / 10, 1.0),
            last_triggered: Math.floor(Date.now() / 1000),
            is_active: 1,
            metadata: JSON.stringify({ app: appName }),
          };
          
          try {
            this.db.createUserHabit(habit);
            habits.push(habit);
          } catch (e) {
            // Ignore errors
          }
        }
      }

      // Update user profile
      this.userProfile.habits = this.db.getActiveUserHabits();
      this.userProfile.learningDay = Math.max(this.userProfile.learningDay, 4);

      console.log(`[LearningEngine] Day 4: Built ${habits.length} user habits`);
    } catch (error) {
      console.error('[LearningEngine] Day 4: Error during intent understanding:', error);
      throw error;
    }
  }

  /**
   * Build intent model (public wrapper)
   */
  public async buildIntentModel(): Promise<UserHabit[]> {
    await this.day4_IntentUnderstanding();
    return this.userProfile.habits;
  }

  // ==================== DAY 5: ATTENTION MODELING ====================

  /**
   * Day 5: Model attention/focus/fatigue patterns
   */
  public async day5_AttentionModeling(): Promise<void> {
    console.log('[LearningEngine] Day 5: Starting attention modeling...');

    try {
      const attentionRecords = this.db.getAttentionRecords(200);
      
      if (attentionRecords.length === 0) {
        console.log('[LearningEngine] Day 5: No attention records found, generating model from window patterns');
        // Generate a basic attention model from window history
        await this.generateAttentionFromWindowHistory();
        return;
      }

      // Calculate average focus and attention metrics
      let totalFocusScore = 0;
      let totalAttentionRate = 0;
      let totalInterruptions = 0;
      const hourFocusMap: Record<number, number[]> = {};

      for (const record of attentionRecords) {
        totalFocusScore += record.focus_score || 0;
        totalAttentionRate += record.attention_rate || 0;
        totalInterruptions += record.interruptions || 0;

        if (record.start_time) {
          const hour = new Date(record.start_time * 1000).getHours();
          if (!hourFocusMap[hour]) {
            hourFocusMap[hour] = [];
          }
          hourFocusMap[hour].push(record.focus_score || 0);
        }
      }

      const avgFocusScore = totalFocusScore / attentionRecords.length;
      const avgAttentionRate = totalAttentionRate / attentionRecords.length;
      const avgInterruptions = totalInterruptions / attentionRecords.length;

      // Find peak and low focus hours
      const productivityByHour: Record<number, number> = {};
      const peakHours: number[] = [];
      const lowFocusHours: number[] = [];

      for (const [hour, scores] of Object.entries(hourFocusMap)) {
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        productivityByHour[parseInt(hour)] = avgScore;
      }

      const sortedHours = Object.entries(productivityByHour)
        .sort(([, a], [, b]) => b - a)
        .map(([h]) => parseInt(h));

      // Top 3 hours are peak, bottom 3 are low focus
      peakHours.push(...sortedHours.slice(0, 3));
      lowFocusHours.push(...sortedHours.slice(-3));

      const attentionModel: AttentionModel = {
        avgFocusScore,
        avgAttentionRate,
        peakHours,
        lowFocusHours,
        interruptionFrequency: avgInterruptions,
        productivityByHour,
      };

      // Save learning progress
      const progress: LearningProgress = {
        model_type: 'attention_model',
        model_name: 'attention_v1',
        accuracy: avgAttentionRate,
        training_samples: attentionRecords.length,
        validation_samples: 0,
        metrics: JSON.stringify(attentionModel),
        trained_at: Math.floor(Date.now() / 1000),
      };

      try {
        this.db.createLearningProgress(progress);
      } catch (e) {
        // Ignore
      }

      // Update user profile
      this.userProfile.attentionModel = attentionModel;
      this.userProfile.learningDay = Math.max(this.userProfile.learningDay, 5);

      console.log(`[LearningEngine] Day 5: Built attention model with avg focus ${avgFocusScore.toFixed(2)}`);
    } catch (error) {
      console.error('[LearningEngine] Day 5: Error during attention modeling:', error);
      throw error;
    }
  }

  private async generateAttentionFromWindowHistory(): Promise<void> {
    const windowHistory = this.db.getWindowHistory(500);
    
    // Analyze focus patterns from window switching frequency
    const hourSwitchCounts: Record<number, number> = {};
    
    for (let i = 1; i < windowHistory.length; i++) {
      const prev = windowHistory[i - 1];
      const curr = windowHistory[i];
      
      if (prev.end_time && curr.start_time) {
        const hour = new Date(curr.start_time * 1000).getHours();
        hourSwitchCounts[hour] = (hourSwitchCounts[hour] || 0) + 1;
      }
    }

    // Low switches = high focus, high switches = low focus
    const maxSwitches = Math.max(...Object.values(hourSwitchCounts), 1);
    const productivityByHour: Record<number, number> = {};
    
    for (let hour = 0; hour < 24; hour++) {
      const switches = hourSwitchCounts[hour] || 0;
      // Invert: fewer switches = higher focus score
      productivityByHour[hour] = 1 - (switches / maxSwitches);
    }

    const productivityValues = Object.values(productivityByHour);
    const avgFocusScore = productivityValues.reduce((a, b) => a + b, 0) / 24;

    const sortedHours = Object.entries(productivityByHour)
      .sort(([, a], [, b]) => b - a)
      .map(([h]) => parseInt(h));

    const attentionModel: AttentionModel = {
      avgFocusScore,
      avgAttentionRate: avgFocusScore,
      peakHours: sortedHours.slice(0, 3),
      lowFocusHours: sortedHours.slice(-3),
      interruptionFrequency: Object.values(hourSwitchCounts).reduce((a, b) => a + b, 0) / 24,
      productivityByHour,
    };

    this.userProfile.attentionModel = attentionModel;
    console.log('[LearningEngine] Day 5: Generated attention model from window history');
  }

  /**
   * Model attention (public wrapper)
   */
  public async modelAttention(): Promise<AttentionModel | null> {
    await this.day5_AttentionModeling();
    return this.userProfile.attentionModel;
  }

  // ==================== DAY 6: PREDICTION OPTIMIZATION ====================

  /**
   * Day 6: Optimize prediction model weights
   */
  public async day6_PredictionOptimization(): Promise<void> {
    console.log('[LearningEngine] Day 6: Starting prediction optimization...');

    try {
      const progressHistory = this.db.getLearningProgress('prediction_weights');
      const recentAccuracy = progressHistory.length > 0 
        ? progressHistory[0].accuracy || 0.5 
        : 0.5;

      // Adjust weights based on learning progress
      // Higher accuracy = trust the model more
      const confidenceMultiplier = recentAccuracy > 0.7 ? 1.2 : recentAccuracy < 0.4 ? 0.8 : 1.0;

      const weights: PredictionWeights = {
        timePattern: 0.25 * confidenceMultiplier,
        operationPattern: 0.25 * confidenceMultiplier,
        appFrequency: 0.25 / confidenceMultiplier,
        attention: 0.15,
        recency: 0.10,
      };

      // Normalize weights to sum to 1
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      for (const key of Object.keys(weights) as (keyof PredictionWeights)[]) {
        weights[key] = weights[key] / total;
      }

      // Save learning progress
      const progress: LearningProgress = {
        model_type: 'prediction_weights',
        model_name: 'weights_v6',
        accuracy: recentAccuracy,
        training_samples: progressHistory.length,
        validation_samples: 0,
        learning_rate: 0.01,
        epoch: this.userProfile.learningDay,
        metrics: JSON.stringify(weights),
        trained_at: Math.floor(Date.now() / 1000),
      };

      try {
        this.db.createLearningProgress(progress);
      } catch (e) {
        // Ignore
      }

      // Update user profile
      this.userProfile.predictionWeights = weights;
      this.userProfile.learningDay = Math.max(this.userProfile.learningDay, 6);

      console.log(`[LearningEngine] Day 6: Optimized prediction weights, total: ${Object.values(weights).reduce((a, b) => a + b, 0).toFixed(2)}`);
    } catch (error) {
      console.error('[LearningEngine] Day 6: Error during prediction optimization:', error);
      throw error;
    }
  }

  /**
   * Optimize predictions (public wrapper)
   */
  public async optimizePredictions(): Promise<PredictionWeights> {
    await this.day6_PredictionOptimization();
    return this.userProfile.predictionWeights;
  }

  // ==================== DAY 7: PERSONALIZATION ====================

  /**
   * Day 7: Personalize based on user feedback
   */
  public async day7_Personalization(): Promise<void> {
    console.log('[LearningEngine] Day 7: Starting personalization...');

    try {
      // Apply feedback to adjust patterns and weights
      const activeHabits = this.db.getActiveUserHabits();
      
      // Increase confidence for frequently triggered habits
      for (const habit of activeHabits) {
        if (habit.frequency && habit.frequency > 10) {
          const newConfidence = Math.min((habit.confidence || 0) * 1.1, 1.0);
          if (habit.id) {
            this.db.updateUserHabit(habit.id, { confidence: newConfidence });
          }
        }
      }

      // Boost time patterns with high frequency
      const timePatterns = this.db.getTimePatterns();
      for (const pattern of timePatterns) {
        if (pattern.frequency && pattern.frequency > 100 && pattern.confidence) {
          const newConfidence = Math.min(pattern.confidence * 1.05, 1.0);
          if (pattern.id) {
            this.db.updateTimePattern(pattern.id, { confidence: newConfidence });
          }
        }
      }

      // Adjust prediction weights based on feedback
      if (this.userProfile.feedbackCount > 0) {
        const positiveRatio = 0.5; // This would be calculated from actual feedback
        if (positiveRatio > 0.6) {
          // More positive feedback = trust the model more
          this.userProfile.predictionWeights.appFrequency *= 1.1;
        } else if (positiveRatio < 0.4) {
          // More negative feedback = be more conservative
          this.userProfile.predictionWeights.appFrequency *= 0.9;
        }
      }

      // Refresh patterns from database
      this.userProfile.habits = this.db.getActiveUserHabits();
      this.userProfile.timePatterns = this.db.getTimePatterns();
      this.userProfile.operationPatterns = this.db.getAllOperationPatterns();
      this.userProfile.learningDay = Math.max(this.userProfile.learningDay, 7);
      this.userProfile.updatedAt = Math.floor(Date.now() / 1000);

      console.log(`[LearningEngine] Day 7: Personalization complete with ${activeHabits.length} active habits`);
    } catch (error) {
      console.error('[LearningEngine] Day 7: Error during personalization:', error);
      throw error;
    }
  }

  /**
   * Personalize (public wrapper)
   */
  public async personalize(): Promise<void> {
    await this.day7_Personalization();
  }

  // ==================== MAIN LEARNING METHODS ====================

  /**
   * Execute learning for a specific day (1-7)
   */
  public async learnFromDay(day: number): Promise<void> {
    console.log(`[LearningEngine] Starting learning for day ${day}...`);

    switch (day) {
      case 1:
        await this.day1_BasicCollection();
        break;
      case 2:
        await this.day2_TimePatternDiscovery();
        break;
      case 3:
        await this.day3_findOperationPatterns();
        break;
      case 4:
        await this.day4_IntentUnderstanding();
        break;
      case 5:
        await this.day5_AttentionModeling();
        break;
      case 6:
        await this.day6_PredictionOptimization();
        break;
      case 7:
        await this.day7_Personalization();
        break;
      default:
        console.warn(`[LearningEngine] Invalid day ${day}, running full cycle`);
        await this.runFullCycle();
    }

    console.log(`[LearningEngine] Completed learning for day ${day}`);
  }

  /**
   * Run the complete 7-day learning cycle
   */
  public async runFullCycle(): Promise<void> {
    console.log('[LearningEngine] Starting full 7-day learning cycle...');
    
    for (let day = 1; day <= this.CYCLE_DAYS; day++) {
      await this.learnFromDay(day);
    }
    
    console.log('[LearningEngine] Completed full 7-day learning cycle');
  }

  /**
   * Start continuous background learning
   */
  public startContinuousLearning(intervalMs: number = 3600000): void {
    console.log(`[LearningEngine] Starting continuous learning (interval: ${intervalMs}ms)`);
    
    if (this.continuousLearningInterval) {
      this.stopContinuousLearning();
    }

    // Run initial learning cycle
    this.runFullCycle().catch(console.error);

    // Set up periodic learning
    this.continuousLearningInterval = setInterval(async () => {
      try {
        // Increment learning day (cycle back after day 7)
        this.userProfile.learningDay = (this.userProfile.learningDay % this.CYCLE_DAYS) + 1;
        await this.learnFromDay(this.userProfile.learningDay);
        
        // Refresh app usage frequency
        const windowHistory = this.db.getWindowHistory(100);
        const appFrequency: Record<string, number> = {};
        for (const window of windowHistory) {
          if (window.app_name) {
            appFrequency[window.app_name] = (appFrequency[window.app_name] || 0) + 1;
          }
        }
        this.userProfile.appUsageFrequency = appFrequency;
      } catch (error) {
        console.error('[LearningEngine] Error during continuous learning:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop continuous background learning
   */
  public stopContinuousLearning(): void {
    if (this.continuousLearningInterval) {
      clearInterval(this.continuousLearningInterval);
      this.continuousLearningInterval = null;
      console.log('[LearningEngine] Stopped continuous learning');
    }
  }

  /**
   * Learn continuously in background (async, non-blocking)
   */
  public async learnContinuously(): Promise<void> {
    this.startContinuousLearning();
  }

  // ==================== PREDICTION METHODS ====================

  /**
   * Predict the next app the user will open
   */
  public predictNextApp(currentApp?: string, currentTime?: number): { app: string; confidence: number } | null {
    const time = currentTime || Math.floor(Date.now() / 1000);
    const hour = new Date(time * 1000).getHours();
    const dayOfWeek = new Date(time * 1000).getDay();
    const weights = this.userProfile.predictionWeights;

    const scores: Record<string, number> = {};

    // Time pattern score
    if (this.userProfile.timePatterns.length > 0) {
      const matchingPatterns = this.userProfile.timePatterns.filter(
        p => p.hour_start !== undefined && p.hour_start <= hour && (p.hour_end === undefined || p.hour_end > hour)
      );
      
      for (const pattern of matchingPatterns) {
        const metadata = pattern.metadata ? JSON.parse(pattern.metadata) : {};
        if (metadata.top_app) {
          scores[metadata.top_app] = (scores[metadata.top_app] || 0) + (pattern.confidence ?? 0.5) * weights.timePattern;
        }
      }
    }

    // App frequency score
    for (const [app, count] of Object.entries(this.userProfile.appUsageFrequency)) {
      scores[app] = (scores[app] || 0) + (count / 100) * weights.appFrequency;
    }

    // Habit-based score
    if (currentApp) {
      const relevantHabits = this.userProfile.habits.filter(
        h => h.trigger_context === currentApp || h.metadata?.includes(currentApp)
      );
      
      for (const habit of relevantHabits) {
        // This is simplified - in reality we'd parse the action_sequence
        scores[currentApp] = (scores[currentApp] || 0) + (habit.confidence ?? 0.5) * weights.operationPattern;
      }
    }

    // Attention-based adjustment
    if (this.userProfile.attentionModel) {
      const attentionModel = this.userProfile.attentionModel;
      if (attentionModel.peakHours.includes(hour)) {
        // User is likely focused, predict productivity apps
        const productivityApps = ['code', 'vscode', 'terminal', 'editor', ' IDE'];
        for (const app of Object.keys(scores)) {
          if (productivityApps.some(p => app.toLowerCase().includes(p))) {
            scores[app] *= (1 + attentionModel.avgFocusScore * weights.attention);
          }
        }
      }
    }

    // Recency bonus
    const recentWindows = this.db.getWindowHistory(10);
    for (const window of recentWindows) {
      if (window.app_name) {
        scores[window.app_name] = (scores[window.app_name] || 0) + weights.recency;
      }
    }

    // Find highest scoring app
    let maxApp = '';
    let maxScore = 0;
    for (const [app, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxApp = app;
      }
    }

    if (maxApp) {
      // Normalize confidence to 0-1 range
      const confidence = Math.min(maxScore, 1.0);
      return { app: maxApp, confidence };
    }

    return null;
  }

  /**
   * Predict the next app to open (public wrapper)
   */
  public async predictApp(context?: { currentApp?: string; time?: number }): Promise<{ app: string; confidence: number } | null> {
    return this.predictNextApp(context?.currentApp, context?.time);
  }

  /**
   * Detect if the current sequence is part of a known repetitive pattern
   */
  public detectRepetition(recentApps: string[]): RepetitionResult {
    if (recentApps.length < 3) {
      return { isRepetitive: false, patternHash: null, confidence: 0, nextExpected: null };
    }

    const sequence = recentApps.join('->');
    const hash = this.hashString(sequence);

    // Check if we have this exact pattern
    const existingPattern = this.userProfile.operationPatterns.find(
      p => p.pattern_hash === hash
    );

    if (existingPattern) {
      // Predict next app based on pattern extension
      const apps = recentApps.slice(-4); // Look at last 4 apps
      const nextExpected = apps.length > 1 ? apps[apps.length - 2] : apps[0];
      
      return {
        isRepetitive: true,
        patternHash: hash,
        confidence: existingPattern.frequency 
          ? Math.min(existingPattern.frequency / 10, this.REPETITION_THRESHOLD) 
          : 0.5,
        nextExpected,
      };
    }

    // Check for similar patterns (one app difference)
    for (const pattern of this.userProfile.operationPatterns) {
      const patternApps = pattern.operation_sequence.split('->');
      const recentSeq = recentApps.slice(-patternApps.length);
      
      let matches = 0;
      for (let i = 0; i < Math.min(patternApps.length, recentSeq.length); i++) {
        if (patternApps[i] === recentSeq[i]) {
          matches++;
        }
      }
      
      const similarity = matches / patternApps.length;
      if (similarity >= 0.7) {
        return {
          isRepetitive: true,
          patternHash: pattern.pattern_hash,
          confidence: similarity * (pattern.success_rate || 0.5),
          nextExpected: patternApps[recentSeq.length] || null,
        };
      }
    }

    return { isRepetitive: false, patternHash: null, confidence: 0, nextExpected: null };
  }

  // ==================== USER FEEDBACK METHODS ====================

  /**
   * Record user feedback on predictions
   */
  public async recordFeedback(
    predictionType: string,
    predictedApp: string,
    actualApp: string,
    context: string,
    feedback: 'accept' | 'reject' | 'modify'
  ): Promise<void> {
    console.log(`[LearningEngine] Recording feedback: ${feedback} for ${predictionType} (predicted: ${predictedApp}, actual: ${actualApp})`);

    try {
      // Update pattern frequencies based on feedback
      if (feedback === 'accept') {
        // Prediction was correct - boost confidence
        const patterns = this.userProfile.operationPatterns.filter(
          p => p.operation_sequence.includes(predictedApp)
        );
        
        for (const pattern of patterns) {
          if (pattern.id) {
            const newFreq = (pattern.frequency || 1) + 1;
            const newConfidence = Math.min((pattern.success_rate || 0.5) * 1.1, 1.0);
            this.db.updateOperationPattern(pattern.id, { frequency: newFreq });
          }
        }
      } else if (feedback === 'reject') {
        // Prediction was wrong - reduce confidence
        const patterns = this.userProfile.operationPatterns.filter(
          p => p.operation_sequence.includes(predictedApp)
        );
        
        for (const pattern of patterns) {
          if (pattern.id) {
            const newSuccessRate = Math.max((pattern.success_rate || 0.5) * 0.9, 0.1);
            this.db.updateOperationPattern(pattern.id, { success_rate: newSuccessRate });
          }
        }

        // Add the actual app to frequency if it's new
        this.userProfile.appUsageFrequency[actualApp] = (this.userProfile.appUsageFrequency[actualApp] || 0) + 1;
      }

      // Update app usage frequency
      if (feedback === 'accept' && predictedApp !== actualApp) {
        // User accepted wrong prediction, note the correction
        this.userProfile.appUsageFrequency[actualApp] = (this.userProfile.appUsageFrequency[actualApp] || 0) + 1;
      }

      this.userProfile.feedbackCount++;
      this.userProfile.lastLearningTimestamp = Math.floor(Date.now() / 1000);

      // Store in prediction cache for learning
      const cacheEntry: PredictionCache = {
        prediction_key: `feedback_${Date.now()}`,
        prediction_type: predictionType,
        prediction_data: JSON.stringify({ predictedApp, actualApp, feedback }),
        confidence: feedback === 'accept' ? 1.0 : 0.0,
        model_version: `v${this.userProfile.learningDay}`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days
      };

      try {
        this.db.createPredictionCache(cacheEntry);
      } catch (e) {
        // Ignore cache errors
      }

      console.log(`[LearningEngine] Feedback recorded, total feedback count: ${this.userProfile.feedbackCount}`);
    } catch (error) {
      console.error('[LearningEngine] Error recording feedback:', error);
      throw error;
    }
  }

  // ==================== GETTER METHODS ====================

  /**
   * Get the current user profile
   */
  public getUserProfile(): UserProfile {
    return { ...this.userProfile };
  }

  /**
   * Get all learned patterns
   */
  public getPatterns(): {
    timePatterns: TimePattern[];
    operationPatterns: OperationPattern[];
    habits: UserHabit[];
  } {
    return {
      timePatterns: [...this.userProfile.timePatterns],
      operationPatterns: [...this.userProfile.operationPatterns],
      habits: [...this.userProfile.habits],
    };
  }

  // ==================== UTILITY METHODS ====================

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get the current learning day
   */
  public getCurrentLearningDay(): number {
    return this.userProfile.learningDay;
  }

  /**
   * Reset learning data
   */
  public async reset(): Promise<void> {
    this.stopContinuousLearning();
    this.userProfile = this.initializeProfile();
    console.log('[LearningEngine] Learning data reset');
  }
}

export default LearningEngine;
