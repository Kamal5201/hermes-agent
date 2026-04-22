/**
 * State machine states for the Hermes Companion
 * Defines the 5-state behavioral model for the companion assistant
 */

export enum CompanionState {
  /** Invisible, learning silently */
  STEALTH = 'STEALTH',
  /** Recording behavior, detecting patterns */
  OBSERVING = 'OBSERVING',
  /** Small light hint in corner */
  HINT = 'HINT',
  /** Proactively offering help */
  ACTIVE = 'ACTIVE',
  /** Graceful exit animation */
  RETREATING = 'RETREATING',
}

/**
 * Context information passed to state transition conditions
 * Contains all relevant data needed to evaluate transition rules
 */
export interface StateContext {
  /** Current timestamp in milliseconds */
  timestamp: number;
  /** User activity level (0-1, where 1 is highly active) */
  userActivityLevel: number;
  /** Whether user is currently idle */
  isUserIdle: boolean;
  /** Time since last user interaction in milliseconds */
  timeSinceLastInteraction: number;
  /** Confidence score for current detected patterns (0-1) */
  patternConfidence: number;
  /** Number of patterns detected in current session */
  patternsDetected: number;
  /** Whether user has explicitly requested help */
  userRequestedHelp: boolean;
  /** User attention level (0-1) */
  userAttentionLevel: number;
  /** Number of help suggestions made in current session */
  helpSuggestionsMade: number;
  /** Whether companion has been dismissed recently */
  wasRecentlyDismissed: boolean;
  /** Current learning progress (0-1) */
  learningProgress: number;
  /** Time spent in current state in milliseconds */
  timeInCurrentState: number;
}

/**
 * Condition function type for state transition rules
 * Returns true if the transition should occur
 */
export type TransitionCondition = (context: StateContext) => boolean;

/**
 * Defines a state transition rule for the state machine
 * Transitions are evaluated in priority order
 */
export interface StateTransitionRule {
  /** State to transition from */
  from: CompanionState;
  /** State to transition to */
  to: CompanionState;
  /** Condition function that determines if transition should occur */
  condition: TransitionCondition;
  /** Higher priority rules are evaluated first (default: 0) */
  priority: number;
}

/**
 * Event emitted when the companion state changes
 * Used for observers to react to state transitions
 */
export interface StateChangeEvent {
  /** The state before transition */
  previousState: CompanionState;
  /** The state after transition */
  currentState: CompanionState;
  /** Timestamp of the state change */
  timestamp: number;
  /** Context at the time of transition */
  context: StateContext;
  /** Reason or trigger for the transition */
  reason?: string;
}

/**
 * Observer interface for state changes
 * Implement this to receive notifications on state transitions
 */
export interface StateChangeObserver {
  /** Called when the companion state changes */
  onStateChange(event: StateChangeEvent): void;
}
