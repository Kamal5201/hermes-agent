/**
 * Learning System Type Definitions
 * 
 * 7-Day Learning Cycle:
 * - Day 1: Basic data collection (window history, operations)
 * - Day 2: Time pattern discovery
 * - Day 3: Operation sequence patterns
 * - Day 4: Intent understanding
 * - Day 5: Attention modeling
 * - Day 6: Prediction optimization
 * - Day 7: Personalization
 */

import type DatabaseManager from '../database/DatabaseManager';

/**
 * Time of day categories for pattern analysis
 */
export enum TimeOfDay {
  MORNING = 'morning',      // 6:00 AM - 12:00 PM
  AFTERNOON = 'afternoon', // 12:00 PM - 6:00 PM
  EVENING = 'evening',      // 6:00 PM - 10:00 PM
  NIGHT = 'night'          // 10:00 PM - 6:00 AM
}

/**
 * Learning phase enumeration matching the 7-day cycle
 */
export enum LearningPhase {
  DATA_COLLECTION = 1,      // Day 1: Basic data collection
  TIME_PATTERNS = 2,        // Day 2: Time pattern discovery
  OPERATION_SEQUENCES = 3,  // Day 3: Operation sequence patterns
  INTENT_UNDERSTANDING = 4, // Day 4: Intent understanding
  ATTENTION_MODELING = 5,   // Day 5: Attention modeling
  PREDICTION_OPTIMIZATION = 6, // Day 6: Prediction optimization
  PERSONALIZATION = 7       // Day 7: Personalization
}

/**
 * Types of user operations tracked by the system
 */
export enum OperationType {
  WINDOW_SWITCH = 'window_switch',
  APPLICATION_LAUNCH = 'application_launch',
  APPLICATION_CLOSE = 'application_close',
  KEYBOARD_INPUT = 'keyboard_input',
  MOUSE_CLICK = 'mouse_click',
  MOUSE_MOVE = 'mouse_move',
  SCROLL = 'scroll',
  DRAG = 'drag',
  FOCUS_CHANGE = 'focus_change',
  SCREEN_CHANGE = 'screen_change'
}

/**
 * Represents time-based patterns in user behavior
 */
export interface TimePattern {
  /** Unique identifier for the pattern */
  id: string;
  /** User identifier this pattern belongs to */
  userId: string;
  /** Time of day when this pattern is most active */
  timeOfDay: TimeOfDay;
  /** Day of week (0-6, Sunday-Saturday) */
  dayOfWeek: number;
  /** Typical start time for this pattern (minutes from midnight) */
  typicalStartTime: number;
  /** Typical end time for this pattern (minutes from midnight) */
  typicalEndTime: number;
  /** Probability of activity during this time slot */
  activityProbability: number;
  /** Confidence score for this pattern (0-1) */
  confidence: number;
  /** Number of observations supporting this pattern */
  observationCount: number;
  /** Timestamp when pattern was last updated */
  lastUpdated: Date;
}

/**
 * Represents sequences of operations that form behavioral patterns
 */
export interface OperationPattern {
  /** Unique identifier for the pattern */
  id: string;
  /** User identifier this pattern belongs to */
  userId: string;
  /** Sequence of operation types that form the pattern */
  operationSequence: OperationType[];
  /** Applications involved in this pattern */
  involvedApplications: string[];
  /** Average time gap between operations in the sequence (ms) */
  averageTimeGap: number;
  /** Variance in time gap between operations (ms) */
  timeGapVariance: number;
  /** Frequency of this pattern occurrence (per day) */
  frequency: number;
  /** Confidence score for this pattern (0-1) */
  confidence: number;
  /** Whether this is a habitual sequence */
  isHabitual: boolean;
  /** Timestamp when pattern was last observed */
  lastObserved: Date;
  /** Total number of times this pattern has been observed */
  totalOccurrences: number;
}

/**
 * Represents a habitual behavior of the user
 */
export interface UserHabit {
  /** Unique identifier for the habit */
  id: string;
  /** User identifier this habit belongs to */
  userId: string;
  /** Name/description of the habit */
  name: string;
  /** Type of habit */
  habitType: 'routine' | 'workflow' | 'temporal' | 'application';
  /** Related time pattern if temporal habit */
  relatedTimePattern?: string;
  /** Related operation patterns if workflow habit */
  relatedOperationPatterns: string[];
  /** Applications typically used during this habit */
  applications: string[];
  /** Time of day when this habit typically occurs */
  typicalTimeOfDay: TimeOfDay[];
  /** Days of week when this habit occurs (0-6) */
  typicalDaysOfWeek: number[];
  /** Strength of habit detection (0-1) */
  strength: number;
  /** Number of times this habit has been confirmed */
  confirmationCount: number;
  /** Timestamp when habit was first detected */
  firstDetected: Date;
  /** Timestamp when habit was last observed */
  lastObserved: Date;
}

/**
 * Statistics about application usage
 */
export interface AppUsageStats {
  /** Application identifier (bundle ID or process name) */
  appId: string;
  /** User identifier */
  userId: string;
  /** Application name */
  appName: string;
  /** Total time spent using this application (ms) */
  totalUsageTime: number;
  /** Number of times application was launched */
  launchCount: number;
  /** Average session duration (ms) */
  averageSessionDuration: number;
  /** Typical time of day when used */
  typicalTimeOfDay: TimeOfDay[];
  /** Days of week when typically used (0-6) */
  typicalDaysOfWeek: number[];
  /** Time of last use */
  lastUsed: Date;
  /** Usage frequency (sessions per day on average) */
  dailyFrequency: number;
  /** Most common operation sequences in this app */
  commonSequences: string[];
}

/**
 * Record of user attention during a session
 */
export interface AttentionRecord {
  /** Unique identifier for the record */
  id: string;
  /** User identifier */
  userId: string;
  /** Session identifier */
  sessionId: string;
  /** Application in focus */
  focusedApplication: string;
  /** Window title in focus */
  focusedWindowTitle: string;
  /** Duration of focus on this element (ms) */
  focusDuration: number;
  /** Type of attention target */
  attentionType: 'application' | 'window' | 'element' | 'region';
  /** Is this a primary or secondary focus area */
  isPrimaryFocus: boolean;
  /** Estimated attention level (0-1) */
  attentionLevel: number;
  /** Timestamp when focus started */
  focusStartTime: Date;
  /** Timestamp when focus ended */
  focusEndTime: Date;
  /** Interruptions during this focus period */
  interruptionCount: number;
}

/**
 * Progress tracking for the learning system
 */
export interface LearningProgress {
  /** Current learning phase (1-7) */
  currentPhase: LearningPhase;
  /** Progress percentage within current phase (0-100) */
  phaseProgress: number;
  /** Number of data points collected */
  dataPointsCollected: number;
  /** Number of patterns identified */
  patternsIdentified: number;
  /** Number of habits detected */
  habitsDetected: number;
  /** Model accuracy for predictions (0-1) */
  modelAccuracy: number;
  /** Learning rate / convergence metric */
  learningRate: number;
  /** Timestamp when current phase started */
  phaseStartTime: Date;
  /** Last update timestamp */
  lastUpdated: Date;
  /** Is the learning system fully initialized */
  isInitialized: boolean;
  /** Collection of completed phases */
  completedPhases: LearningPhase[];
  /** Errors or warnings during learning */
  warnings: string[];
}

/**
 * Result of a prediction query
 */
export interface PredictionResult {
  /** Unique identifier for this prediction */
  id: string;
  /** User identifier */
  userId: string;
  /** Type of prediction */
  predictionType: 'next_application' | 'next_operation' | 'attention_shift' | 'habit_occurrence' | 'intent';
  /** Predicted value/action */
  predictedValue: string;
  /** Confidence score for this prediction (0-1) */
  confidence: number;
  /** Relevant patterns supporting this prediction */
  supportingPatterns: string[];
  /** Relevant habits supporting this prediction */
  supportingHabits: string[];
  /** Context factors that influenced the prediction */
  contextFactors: Record<string, number>;
  /** Timestamp when prediction was made */
  predictedAt: Date;
  /** Time window for this prediction (ms) */
  predictionWindow: number;
  /** Whether this prediction was correct (after validation) */
  wasCorrect?: boolean;
}

/**
 * Complete user profile aggregating all learning data
 */
export interface UserProfile {
  /** Unique identifier for the user */
  userId: string;
  /** Display name for the user */
  displayName: string;
  /** Time patterns discovered for this user */
  timePatterns: TimePattern[];
  /** Operation patterns discovered for this user */
  operationPatterns: OperationPattern[];
  /** Habits detected for this user */
  habits: UserHabit[];
  /** Application usage statistics */
  appUsageStats: AppUsageStats[];
  /** Attention records */
  attentionRecords: AttentionRecord[];
  /** Current learning progress */
  learningProgress: LearningProgress;
  /** Recent predictions made for this user */
  recentPredictions: PredictionResult[];
  /** Profile creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  lastUpdated: Date;
  /** User preferences for learning system */
  preferences: UserLearningPreferences;
}

/**
 * User preferences for the learning system
 */
export interface UserLearningPreferences {
  /** Is learning enabled for this user */
  learningEnabled: boolean;
  /** Types of data to collect */
  dataCollectionTypes: ('window_history' | 'operations' | 'attention' | 'habits')[];
  /** Sensitivity level for pattern detection */
  patternSensitivity: 'low' | 'medium' | 'high';
  /** Minimum confidence threshold for predictions */
  minConfidenceThreshold: number;
  /** Maximum days to retain historical data */
  dataRetentionDays: number;
  /** Custom time windows for learning (overrides defaults) */
  customTimeWindows?: {
    morningStart: number;
    morningEnd: number;
    afternoonStart: number;
    afternoonEnd: number;
    eveningStart: number;
    eveningEnd: number;
    nightStart: number;
    nightEnd: number;
  };
}

export interface PersistedUserProfileEnvelope<TProfile> {
  version: number;
  profile: TProfile;
  savedAt: number;
}

export interface UserProfilePersistenceMetadata {
  exists: boolean;
  version: number;
  savedAt: number | null;
}

export class UserProfileStore<TProfile> {
  constructor(
    private readonly db: DatabaseManager,
    private readonly key: string = 'learning.userProfile',
    private readonly version: number = 2,
  ) {}

  public load(fallbackFactory: () => TProfile): TProfile {
    const entry = this.db.getUserConfig(this.key);
    if (!entry) {
      const profile = fallbackFactory();
      this.save(profile);
      return profile;
    }

    try {
      const envelope = JSON.parse(entry.value) as PersistedUserProfileEnvelope<TProfile>;
      if (!this.isPersistedEnvelope(envelope)) {
        throw new Error('Invalid persisted user profile');
      }

      return envelope.profile;
    } catch {
      const profile = fallbackFactory();
      this.save(profile);
      return profile;
    }
  }

  public save(profile: TProfile): void {
    const envelope: PersistedUserProfileEnvelope<TProfile> = {
      version: this.version,
      profile,
      savedAt: Date.now(),
    };

    const serialized = JSON.stringify(envelope);
    const existing = this.db.getUserConfig(this.key);

    if (existing) {
      this.db.updateUserConfig(this.key, serialized, 'object');
      return;
    }

    this.db.createUserConfig({
      key: this.key,
      value: serialized,
      value_type: 'object',
    });
  }

  public reset(profile: TProfile): void {
    this.save(profile);
  }

  public getMetadata(): UserProfilePersistenceMetadata {
    const entry = this.db.getUserConfig(this.key);
    if (!entry) {
      return {
        exists: false,
        version: this.version,
        savedAt: null,
      };
    }

    try {
      const envelope = JSON.parse(entry.value) as PersistedUserProfileEnvelope<TProfile>;
      return {
        exists: true,
        version: typeof envelope.version === 'number' ? envelope.version : this.version,
        savedAt: typeof envelope.savedAt === 'number' ? envelope.savedAt : null,
      };
    } catch {
      return {
        exists: true,
        version: this.version,
        savedAt: null,
      };
    }
  }

  private isPersistedEnvelope(value: unknown): value is PersistedUserProfileEnvelope<TProfile> {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const envelope = value as Partial<PersistedUserProfileEnvelope<TProfile>>;
    return (
      typeof envelope.version === 'number'
      && typeof envelope.savedAt === 'number'
      && 'profile' in envelope
    );
  }
}
