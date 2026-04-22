import { LearningEngine } from '../learning/LearningEngine';
import DatabaseManager, { type OperationHistory } from '../database/DatabaseManager';
import {
  PredictionType,
  PredictionContext,
  Prediction,
} from './PredictionTypes';

export class PredictionEngine {
  private static instance: PredictionEngine | null = null;
  private learningEngine: LearningEngine;
  private db: DatabaseManager;

  // Configuration
  private readonly MIN_CONFIDENCE_THRESHOLD = 0.5;
  private readonly MAX_PREDICTIONS = 10;
  private readonly REPETITION_THRESHOLD = 3;
  private readonly LONG_STAY_THRESHOLD_SECONDS = 300; // 5 minutes

  private constructor(learningEngine: LearningEngine, db: DatabaseManager) {
    this.learningEngine = learningEngine;
    this.db = db;
  }

  /**
   * Get singleton instance of PredictionEngine
   */
  public static getInstance(learningEngine: LearningEngine, db: DatabaseManager): PredictionEngine {
    if (!PredictionEngine.instance) {
      PredictionEngine.instance = new PredictionEngine(learningEngine, db);
    }
    return PredictionEngine.instance;
  }

  /**
   * Reset singleton instance (useful for testing)
   */
  public static resetInstance(): void {
    PredictionEngine.instance = null;
  }

  /**
   * Main prediction method - aggregates all predictions
   */
  public async predict(context: PredictionContext): Promise<Prediction[]> {
    // Call all predictors in parallel
    const [
      nextAppPredictions,
      nextOperationPredictions,
      intentPredictions,
      helpPredictions,
      attentionPredictions,
    ] = await Promise.all([
      this.predictNextApp(context),
      this.predictNextOperation(context),
      this.predictIntent(context),
      this.predictNeededHelp(context),
      this.predictAttentionChange(context),
    ]);

    // Merge all predictions
    const allPredictions = [
      ...nextAppPredictions,
      ...nextOperationPredictions,
      ...intentPredictions,
      ...helpPredictions,
      ...attentionPredictions,
    ];

    // Sort by confidence descending
    allPredictions.sort((a, b) => b.confidence - a.confidence);

    // Filter by confidence threshold and limit results
    return allPredictions
      .filter(p => p.confidence >= this.MIN_CONFIDENCE_THRESHOLD)
      .slice(0, this.MAX_PREDICTIONS);
  }

  /**
   * Predict next app based on time patterns and app chains
   */
  public async predictNextApp(context: PredictionContext): Promise<Prediction[]> {
    const predictions: Prediction[] = [];
    const currentTime = Math.floor(Date.now() / 1000);

    // 1. Time-based prediction from LearningEngine
    const timePrediction = this.learningEngine.predictNextApp(
      context.currentApp,
      currentTime
    );

    if (timePrediction) {
      predictions.push({
        type: PredictionType.NEXT_APP,
        value: timePrediction.app,
        confidence: timePrediction.confidence,
        reasoning: `Based on time patterns for ${context.timeOfDay} on ${this.getDayName(context.dayOfWeek)}`,
        autoExecute: timePrediction.confidence > 0.8,
        suggestionText: `Switch to ${timePrediction.app}?`,
        context,
      });
    }

    // 2. App chain prediction - detect app sequences
    const recentWindows = this.db.getWindowHistory(20);
    const recentApps = recentWindows
      .filter(w => w.app_name)
      .map(w => w.app_name as string);

    if (recentApps.length >= 2) {
      const chainPrediction = this.predictFromAppChain(recentApps, context);
      if (chainPrediction) {
        predictions.push(chainPrediction);
      }
    }

    // 3. Frequency-based prediction
    const frequencyPrediction = this.predictFromFrequency(context);
    if (frequencyPrediction) {
      predictions.push(frequencyPrediction);
    }

    // Sort by confidence and return top 3
    predictions.sort((a, b) => b.confidence - a.confidence);
    return predictions.slice(0, 3);
  }

  /**
   * Predict next operation based on patterns
   */
  public async predictNextOperation(context: PredictionContext): Promise<Prediction[]> {
    const predictions: Prediction[] = [];
    const recentOperations = this.db.getRecentOperations(
      Math.floor(Date.now() / 1000) - 3600 // Last hour
    );

    if (recentOperations.length < 2) {
      return predictions;
    }

    // 1. Sequence completion based on operation patterns
    const operationSequence = recentOperations
      .slice(-10)
      .map(op => op.operation_type);

    const sequencePrediction = this.completeOperationSequence(operationSequence, context);
    if (sequencePrediction) {
      predictions.push(sequencePrediction);
    }

    // 2. Pattern-based prediction
    const patternPrediction = this.predictFromOperationPatterns(recentOperations, context);
    if (patternPrediction) {
      predictions.push(patternPrediction);
    }

    // 3. Context-aware operation prediction
    const contextPrediction = this.predictOperationFromContext(context, recentOperations);
    if (contextPrediction) {
      predictions.push(contextPrediction);
    }

    return predictions.slice(0, 3);
  }

  /**
   * Predict user intent based on context
   */
  public async predictIntent(context: PredictionContext): Promise<Prediction[]> {
    const predictions: Prediction[] = [];

    // 1. Detect work vs break intent
    const workBreakIntent = this.detectWorkBreakIntent(context);
    if (workBreakIntent) {
      predictions.push(workBreakIntent);
    }

    // 2. Detect communication intent
    const commIntent = this.detectCommunicationIntent(context);
    if (commIntent) {
      predictions.push(commIntent);
    }

    // 3. Detect creation intent (writing, coding, etc.)
    const creationIntent = this.detectCreationIntent(context);
    if (creationIntent) {
      predictions.push(creationIntent);
    }

    // 4. Detect browsing/research intent
    const browseIntent = this.detectBrowsingIntent(context);
    if (browseIntent) {
      predictions.push(browseIntent);
    }

    return predictions.slice(0, 3);
  }

  /**
   * Predict when user might need help
   */
  public async predictNeededHelp(context: PredictionContext): Promise<Prediction[]> {
    const predictions: Prediction[] = [];

    // 1. Detect repetitive operations (>3 times)
    const repetitiveHelp = this.detectRepetitiveOperations(context);
    if (repetitiveHelp) {
      predictions.push(repetitiveHelp);
    }

    // 2. Detect error states
    const errorHelp = this.detectErrorStates(context);
    if (errorHelp) {
      predictions.push(errorHelp);
    }

    // 3. Detect long stay in same app/operation
    const longStayHelp = this.detectLongStay(context);
    if (longStayHelp) {
      predictions.push(longStayHelp);
    }

    // 4. Detect struggle patterns (repeated undos, corrections)
    const struggleHelp = this.detectStrugglePatterns(context);
    if (struggleHelp) {
      predictions.push(struggleHelp);
    }

    return predictions;
  }

  /**
   * Predict attention changes (fatigue, distraction)
   */
  public async predictAttentionChange(context: PredictionContext): Promise<Prediction[]> {
    const predictions: Prediction[] = [];

    // 1. Detect fatigue patterns
    const fatiguePrediction = this.detectFatigue(context);
    if (fatiguePrediction) {
      predictions.push(fatiguePrediction);
    }

    // 2. Detect distraction
    const distractionPrediction = this.detectDistraction(context);
    if (distractionPrediction) {
      predictions.push(distractionPrediction);
    }

    // 3. Detect focus window (high productivity periods)
    const focusPrediction = this.detectFocusWindow(context);
    if (focusPrediction) {
      predictions.push(focusPrediction);
    }

    return predictions;
  }

  // ==================== PRIVATE HELPER METHODS ====================

  /**
   * Predict app from app chain patterns
   */
  private predictFromAppChain(recentApps: string[], context: PredictionContext): Prediction | null {
    if (recentApps.length < 2) {
      return null;
    }

    // Build app transition matrix from history
    const recentWindows = this.db.getWindowHistory(100);
    const transitions: Record<string, Record<string, number>> = {};

    for (let i = 0; i < recentWindows.length - 1; i++) {
      const fromApp = recentWindows[i]?.app_name;
      const toApp = recentWindows[i + 1]?.app_name;
      if (fromApp && toApp && fromApp !== toApp) {
        transitions[fromApp] = transitions[fromApp] || {};
        transitions[fromApp][toApp] = (transitions[fromApp][toApp] || 0) + 1;
      }
    }

    const lastApp = recentApps[0];
    if (transitions[lastApp]) {
      const nextApps = transitions[lastApp];
      let maxApp = '';
      let maxCount = 0;
      let totalTransitions = 0;

      for (const [app, count] of Object.entries(nextApps)) {
        totalTransitions += count;
        if (count > maxCount) {
          maxCount = count;
          maxApp = app;
        }
      }

      if (maxApp) {
        const confidence = maxCount / totalTransitions;
        return {
          type: PredictionType.NEXT_APP,
          value: maxApp,
          confidence: Math.min(confidence, 0.95),
          reasoning: `Based on app chain pattern: ${lastApp} → ${maxApp}`,
          autoExecute: false,
          suggestionText: `Continue to ${maxApp}?`,
          context,
        };
      }
    }

    return null;
  }

  /**
   * Predict app from frequency analysis
   */
  private predictFromFrequency(context: PredictionContext): Prediction | null {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Get usage stats for this time period
    const userProfile = this.getUserProfile();
    const usagePatterns = userProfile?.timePatterns || [];
    const matchingPattern = usagePatterns.find(p => {
      const patternHour = p.hour_start !== undefined ? p.hour_start : -1;
      const patternDay = p.day_of_week !== undefined ? p.day_of_week : -1;
      const endHour = p.hour_end !== undefined ? p.hour_end : 24;
      return (patternHour === -1 || (hour >= patternHour && hour < endHour))
        && (patternDay === -1 || patternDay === dayOfWeek);
    });

    if (matchingPattern?.metadata) {
      try {
        const metadata = JSON.parse(matchingPattern.metadata);
        if (metadata.top_app) {
          return {
            type: PredictionType.NEXT_APP,
            value: metadata.top_app,
            confidence: (matchingPattern.confidence || 0.5) * 0.7,
            reasoning: `Based on frequent usage at this time`,
            autoExecute: false,
            suggestionText: `Open ${metadata.top_app}?`,
            context,
          };
        }
      } catch {
        // Ignore parse errors
      }
    }

    return null;
  }

  /**
   * Complete an operation sequence based on patterns
   */
  private completeOperationSequence(
    sequence: string[],
    context: PredictionContext
  ): Prediction | null {
    const userProfile = this.getUserProfile();
    const patterns = userProfile?.operationPatterns || [];

    for (const pattern of patterns) {
      const patternSeq = pattern.operation_sequence.split('->');
      if (patternSeq.length < 2) continue;

      // Check if current sequence matches the start of this pattern
      const matchLength = this.sequenceMatchLength(sequence, patternSeq);
      if (matchLength >= 2 && matchLength < patternSeq.length) {
        const nextOp = patternSeq[matchLength];
        return {
          type: PredictionType.NEXT_OPERATION,
          value: nextOp,
          confidence: Math.min(pattern.frequency || 0.5, 0.9),
          reasoning: `Sequence completion: ${patternSeq.slice(0, matchLength).join('->')} → ${nextOp}`,
          autoExecute: false,
          suggestionText: `Next: ${nextOp}?`,
          context,
        };
      }
    }

    return null;
  }

  /**
   * Calculate how many elements match between two sequences
   */
  private sequenceMatchLength(actual: string[], expected: string[]): number {
    let matchCount = 0;
    const maxCheck = Math.min(actual.length, expected.length);

    for (let i = 0; i < maxCheck; i++) {
      if (actual[actual.length - 1 - i] === expected[expected.length - 1 - i]) {
        matchCount++;
      } else {
        break;
      }
    }

    return matchCount;
  }

  /**
   * Predict operation from patterns
   */
  private predictFromOperationPatterns(
    recentOperations: OperationHistory[],
    context: PredictionContext
  ): Prediction | null {
    const opTypes = recentOperations.map(op => op.operation_type);
    const userProfile = this.getUserProfile();
    const patterns = userProfile?.operationPatterns || [];

    for (const pattern of patterns) {
      const patternSeq = pattern.operation_sequence.split('->');
      const matchLen = this.sequenceMatchLength(opTypes, patternSeq);

      if (matchLen >= 2 && matchLen < patternSeq.length) {
        const nextOp = patternSeq[matchLen];
        return {
          type: PredictionType.NEXT_OPERATION,
          value: nextOp,
          confidence: Math.min((pattern.success_rate || 0.5) * (pattern.frequency || 0.3), 0.85),
          reasoning: `Pattern-based: ${pattern.pattern_name}`,
          autoExecute: false,
          suggestionText: `Continue with ${nextOp}?`,
          context,
        };
      }
    }

    return null;
  }

  /**
   * Predict operation from context
   */
  private predictOperationFromContext(
    context: PredictionContext,
    recentOperations: OperationHistory[]
  ): Prediction | null {
    // Simple context-aware prediction based on current app
    const contextOps: Record<string, string[]> = {
      'code': ['edit', 'save', 'debug', 'run'],
      'browser': ['click', 'scroll', 'type', 'navigate'],
      'terminal': ['type', 'execute', 'scroll', 'clear'],
      'editor': ['edit', 'save', 'format', 'find'],
    };

    const ops = contextOps[context.currentApp.toLowerCase()] ||
                ['click', 'type', 'scroll', 'select'];

    // Find most common recent operation
    const opCounts: Record<string, number> = {};
    for (const op of recentOperations.slice(-10)) {
      opCounts[op.operation_type] = (opCounts[op.operation_type] || 0) + 1;
    }

    const sortedOps = Object.entries(opCounts).sort((a, b) => b[1] - a[1]);
    if (sortedOps.length > 0) {
      const nextOp = ops.includes(sortedOps[0][0]) ? ops[(ops.indexOf(sortedOps[0][0]) + 1) % ops.length] : ops[0];

      return {
        type: PredictionType.NEXT_OPERATION,
        value: nextOp,
        confidence: 0.4,
        reasoning: `Context-based prediction for ${context.currentApp}`,
        autoExecute: false,
        suggestionText: `Try ${nextOp}?`,
        context,
      };
    }

    return null;
  }

  /**
   * Detect work vs break intent
   */
  private detectWorkBreakIntent(context: PredictionContext): Prediction | null {
    const attentionScore = context.attentionScore;
    const hour = new Date().getHours();

    // Low attention + long idle time = break intent
    if (attentionScore < 0.4 && (context.idleTimeSeconds || 0) > 120) {
      return {
        type: PredictionType.USER_INTENT,
        value: 'break',
        confidence: 0.8,
        reasoning: 'Low attention and idle detected - user may want a break',
        autoExecute: false,
        suggestionText: 'Take a break?',
        context,
      };
    }

    // High attention + productive hours = work intent
    if (attentionScore > 0.7 && hour >= 9 && hour <= 17) {
      return {
        type: PredictionType.USER_INTENT,
        value: 'focused_work',
        confidence: 0.75,
        reasoning: 'High focus during productive hours',
        autoExecute: false,
        suggestionText: 'Stay focused?',
        context,
      };
    }

    return null;
  }

  /**
   * Detect communication intent
   */
  private detectCommunicationIntent(context: PredictionContext): Prediction | null {
    const commApps = ['slack', 'discord', 'teams', 'email', 'mail', 'message', 'chat'];
    const isCommApp = commApps.some(app =>
      context.currentApp.toLowerCase().includes(app)
    );

    if (isCommApp) {
      return {
        type: PredictionType.USER_INTENT,
        value: 'communication',
        confidence: 0.85,
        reasoning: `Communication app detected: ${context.currentApp}`,
        autoExecute: false,
        suggestionText: 'Continue communicating?',
        context,
      };
    }

    return null;
  }

  /**
   * Detect creation intent
   */
  private detectCreationIntent(context: PredictionContext): Prediction | null {
    const creationApps = ['code', 'vscode', 'studio', 'editor', 'notion', 'obsidian', 'write'];
    const isCreationApp = creationApps.some(app =>
      context.currentApp.toLowerCase().includes(app)
    );

    if (isCreationApp) {
      return {
        type: PredictionType.USER_INTENT,
        value: 'creation',
        confidence: 0.8,
        reasoning: `Creation app detected: ${context.currentApp}`,
        autoExecute: false,
        suggestionText: 'Continue creating?',
        context,
      };
    }

    return null;
  }

  /**
   * Detect browsing/research intent
   */
  private detectBrowsingIntent(context: PredictionContext): Prediction | null {
    const browseApps = ['chrome', 'firefox', 'safari', 'browser', 'edge'];
    const isBrowseApp = browseApps.some(app =>
      context.currentApp.toLowerCase().includes(app)
    );

    if (isBrowseApp && (context.recentOperations.includes('click') || context.recentOperations.includes('scroll'))) {
      return {
        type: PredictionType.USER_INTENT,
        value: 'browsing',
        confidence: 0.7,
        reasoning: 'Browser activity detected',
        autoExecute: false,
        suggestionText: 'Continue browsing?',
        context,
      };
    }

    return null;
  }

  /**
   * Detect repetitive operations that might need automation
   */
  private detectRepetitiveOperations(context: PredictionContext): Prediction | null {
    const recentOps = this.db.getRecentOperations(
      Math.floor(Date.now() / 1000) - 1800 // Last 30 minutes
    );

    if (recentOps.length < this.REPETITION_THRESHOLD) {
      return null;
    }

    const opCounts: Record<string, number> = {};
    for (const op of recentOps) {
      opCounts[op.operation_type] = (opCounts[op.operation_type] || 0) + 1;
    }

    for (const [opType, count] of Object.entries(opCounts)) {
      if (count >= this.REPETITION_THRESHOLD) {
        return {
          type: PredictionType.NEEDED_HELP,
          value: `automate_${opType}`,
          confidence: Math.min(count / 10, 0.95),
          reasoning: `Detected ${count}x repetitions of "${opType}" - automation possible`,
          autoExecute: false,
          suggestionText: `Automate ${opType}?`,
          context,
        };
      }
    }

    return null;
  }

  /**
   * Detect error states from recent operations
   */
  private detectErrorStates(context: PredictionContext): Prediction | null {
    const recentOps = this.db.getRecentOperations(
      Math.floor(Date.now() / 1000) - 600 // Last 10 minutes
    );

    const errorOps = recentOps.filter(op => op.error || op.result === 'error');
    
    if (errorOps.length >= 2) {
      return {
        type: PredictionType.NEEDED_HELP,
        value: 'error_recovery',
        confidence: 0.9,
        reasoning: `${errorOps.length} errors detected - assistance available`,
        autoExecute: false,
        suggestionText: 'Get help with errors?',
        context,
      };
    }

    // Check for failed operations with details
    const failedOps = recentOps.filter(op => 
      op.details?.includes('failed') || 
      op.details?.includes('error') ||
      op.result === 'failed'
    );

    if (failedOps.length >= 1) {
      return {
        type: PredictionType.NEEDED_HELP,
        value: 'operation_failed',
        confidence: 0.75,
        reasoning: `Failed operation detected: ${failedOps[0].operation_type}`,
        autoExecute: false,
        suggestionText: `Retry or get help?`,
        context,
      };
    }

    return null;
  }

  /**
   * Detect long stay in same operation/app
   */
  private detectLongStay(context: PredictionContext): Prediction | null {
    if ((context.idleTimeSeconds || 0) > this.LONG_STAY_THRESHOLD_SECONDS) {
      return {
        type: PredictionType.NEEDED_HELP,
        value: 'stuck_possible',
        confidence: 0.6,
        reasoning: `Long idle time (${Math.floor((context.idleTimeSeconds || 0) / 60)} min) detected`,
        autoExecute: false,
        suggestionText: 'Need help moving forward?',
        context,
      };
    }

    // Check for same app usage over extended period
    const recentWindows = this.db.getWindowHistory(5);
    if (recentWindows.length >= 3) {
      const sameApp = recentWindows.every(w => w.app_name === recentWindows[0].app_name);
      const firstWindow = recentWindows[recentWindows.length - 1];
      const duration = firstWindow.duration || 0;

      if (sameApp && duration > this.LONG_STAY_THRESHOLD_SECONDS) {
        return {
          type: PredictionType.NEEDED_HELP,
          value: 'long_stay',
          confidence: 0.55,
          reasoning: `Using ${context.currentApp} for extended period`,
          autoExecute: false,
          suggestionText: 'Try something different?',
          context,
        };
      }
    }

    return null;
  }

  /**
   * Detect struggle patterns (repeated undos, corrections)
   */
  private detectStrugglePatterns(context: PredictionContext): Prediction | null {
    const recentOps = this.db.getRecentOperations(
      Math.floor(Date.now() / 1000) - 900 // Last 15 minutes
    );

    const struggleKeywords = ['undo', 'redo', 'delete', 'backspace', 'correct', 'edit'];
    const struggleCount = recentOps.filter(op =>
      struggleKeywords.some(kw =>
        op.operation_type.toLowerCase().includes(kw) ||
        op.details?.toLowerCase().includes(kw)
      )
    ).length;

    if (struggleCount >= 5) {
      return {
        type: PredictionType.NEEDED_HELP,
        value: 'struggling',
        confidence: 0.7,
        reasoning: `${struggleCount} potential struggle actions detected`,
        autoExecute: false,
        suggestionText: 'Need assistance?',
        context,
      };
    }

    return null;
  }

  /**
   * Detect fatigue patterns
   */
  private detectFatigue(context: PredictionContext): Prediction | null {
    const hour = new Date().getHours();
    const userProfile = this.getUserProfile();
    const attentionModel = userProfile?.attentionModel;

    // Check against known low focus hours
    if (attentionModel?.lowFocusHours?.includes(hour)) {
      return {
        type: PredictionType.ATTENTION_CHANGE,
        value: 'fatigue_risk',
        confidence: 0.8,
        reasoning: `Historically low focus hour (${hour}:00)`,
        autoExecute: false,
        suggestionText: 'Take a break?',
        context,
      };
    }

    // Detect slowing down (reduced keystroke rate + mouse speed)
    const keystrokeRate = context.keyStrokeRate || 0;
    const mouseSpeed = context.mouseSpeed || 0;

    if (keystrokeRate < 1 && mouseSpeed < 0.5 && (context.idleTimeSeconds || 0) < 60) {
      return {
        type: PredictionType.ATTENTION_CHANGE,
        value: 'possible_fatigue',
        confidence: 0.65,
        reasoning: 'Reduced activity indicators',
        autoExecute: false,
        suggestionText: 'Feeling tired?',
        context,
      };
    }

    // Late night fatigue risk
    if (hour >= 22 || hour <= 5) {
      return {
        type: PredictionType.ATTENTION_CHANGE,
        value: 'late_hours_fatigue',
        confidence: 0.7,
        reasoning: 'Late night hours - potential fatigue',
        autoExecute: false,
        suggestionText: 'Consider resting?',
        context,
      };
    }

    return null;
  }

  /**
   * Detect distraction
   */
  private detectDistraction(context: PredictionContext): Prediction | null {
    // Rapid app switching = distraction
    const recentWindows = this.db.getWindowHistory(10);
    if (recentWindows.length >= 5) {
      const timestamps = recentWindows
        .filter(w => w.start_time)
        .map(w => w.start_time)
        .sort((a, b) => (a || 0) - (b || 0));

      let rapidSwitches = 0;
      for (let i = 1; i < timestamps.length; i++) {
        const gap = (timestamps[i] || 0) - (timestamps[i - 1] || 0);
        if (gap < 30 && gap > 0) { // Less than 30 seconds between switches
          rapidSwitches++;
        }
      }

      if (rapidSwitches >= 3) {
        return {
          type: PredictionType.ATTENTION_CHANGE,
          value: 'distracted',
          confidence: 0.75,
          reasoning: `${rapidSwitches} rapid app switches detected`,
          autoExecute: false,
          suggestionText: 'Focus on one task?',
          context,
        };
      }
    }

    // Short attention spans (high switching with low engagement)
    if (context.attentionScore < 0.5 && recentWindows.length >= 3) {
      return {
        type: PredictionType.ATTENTION_CHANGE,
        value: 'scattered_attention',
        confidence: 0.6,
        reasoning: 'Low attention with multiple app switches',
        autoExecute: false,
        suggestionText: 'Need to refocus?',
        context,
      };
    }

    return null;
  }

  /**
   * Detect focus window (high productivity periods)
   */
  private detectFocusWindow(context: PredictionContext): Prediction | null {
    const hour = new Date().getHours();
    const userProfile = this.getUserProfile();
    const attentionModel = userProfile?.attentionModel;

    // Check against known peak focus hours
    if (attentionModel?.peakHours?.includes(hour)) {
      const productivity = attentionModel.productivityByHour?.[hour] || 0.7;
      return {
        type: PredictionType.ATTENTION_CHANGE,
        value: 'focus_window',
        confidence: productivity,
        reasoning: `Peak productivity hour (${hour}:00)`,
        autoExecute: false,
        suggestionText: 'Maximize this focus period?',
        context,
      };
    }

    // High attention + good time = good focus window
    if (context.attentionScore > 0.8 && hour >= 9 && hour <= 11) {
      return {
        type: PredictionType.ATTENTION_CHANGE,
        value: 'optimal_focus',
        confidence: 0.85,
        reasoning: 'Optimal focus conditions detected',
        autoExecute: false,
        suggestionText: 'Great time for deep work!',
        context,
      };
    }

    return null;
  }

  /**
   * Helper to get day name
   */
  private getDayName(dayOfWeek: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek] || 'Unknown';
  }

  private getUserProfile(): ReturnType<LearningEngine['getUserProfile']> {
    return this.learningEngine.getUserProfile();
  }
}

export default PredictionEngine;
