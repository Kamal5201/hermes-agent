/**
 * StateEngine.ts - 5-State Machine Implementation for Hermes Companion
 * 
 * States: STEALTH, OBSERVING, HINT, ACTIVE, RETREATING
 * 
 * This module implements a hierarchical state machine with:
 * - Transition rules based on context
 * - State history tracking with duration calculation
 * - Transition counting per state
 * - Observer pattern for state changes
 * - Transition action execution
 */

import log from 'electron-log/main.js';

// ============================================================================
// State Definitions
// ============================================================================

export enum CompanionState {
  STEALTH = 'STEALTH',
  OBSERVING = 'OBSERVING',
  HINT = 'HINT',
  ACTIVE = 'ACTIVE',
  RETREATING = 'RETREATING'
}

// ============================================================================
// State Transition Rules
// ============================================================================

interface TransitionRule {
  from: CompanionState;
  to: CompanionState;
  condition: (context: StateContext) => boolean;
  priority: number;
}

interface StateContext {
  userActivity: number;
  lastActivityTimestamp: number;
  taskActive: boolean;
  attentionNeeded: boolean;
  systemLoad: number;
  errorCount: number;
  sessionDuration: number;
  manualOverride: boolean;
  clipboardChanged: boolean;
  screenCaptureAvailable: boolean;
}

// ============================================================================
// State History Entry
// ============================================================================

interface StateHistoryEntry {
  state: CompanionState;
  enteredAt: number;
  exitedAt: number | null;
  duration: number | null;
  transitionsFrom: number;
}

type StateChangeListener = (newState: CompanionState, previousState: CompanionState, context: StateContext) => void;
type TransitionAction = (from: CompanionState, to: CompanionState, context: StateContext) => void;

// ============================================================================
// State Engine Class
// ============================================================================

export class StateEngine {
  private currentState: CompanionState;
  private stateHistory: StateHistoryEntry[];
  private transitionCount: Map<CompanionState, number>;
  private stateChangeListeners: Set<StateChangeListener>;
  private transitionActions: Map<string, TransitionAction[]>;
  private currentContext: StateContext;
  private stateEntryTime: number;
  private initialized: boolean;
  private lastRetreatAt: number | null;

  constructor(initialState: CompanionState = CompanionState.STEALTH) {
    this.currentState = initialState;
    this.stateHistory = [];
    this.transitionCount = new Map();
    this.stateChangeListeners = new Set();
    this.transitionActions = new Map();
    this.stateEntryTime = Date.now();
    this.initialized = false;
    this.lastRetreatAt = null;

    // Initialize transition counts for all states
    Object.values(CompanionState).forEach(state => {
      this.transitionCount.set(state, 0);
    });

    // Initialize default context
    this.currentContext = this.createDefaultContext();

    // Initialize default transition rules
    this.initializeTransitionRules();

    // Record initial state entry
    this.recordStateEntry(initialState);

    this.initialized = true;
    log.info(`[StateEngine] Initialized with state: ${initialState}`);
  }

  private createDefaultContext(): StateContext {
    return {
      userActivity: 0,
      lastActivityTimestamp: Date.now(),
      taskActive: false,
      attentionNeeded: false,
      systemLoad: 0,
      errorCount: 0,
      sessionDuration: 0,
      manualOverride: false,
      clipboardChanged: false,
      screenCaptureAvailable: true
    };
  }

  private initializeTransitionRules(): void {
    // Register transition action handlers
    this.registerTransitionAction(CompanionState.STEALTH, CompanionState.OBSERVING, 
      (from, to, ctx) => this.executeStealthToObserving(from, to, ctx));
    this.registerTransitionAction(CompanionState.OBSERVING, CompanionState.STEALTH,
      (from, to, ctx) => this.executeObservingToStealth(from, to, ctx));
    this.registerTransitionAction(CompanionState.OBSERVING, CompanionState.HINT,
      (from, to, ctx) => this.executeObservingToHint(from, to, ctx));
    this.registerTransitionAction(CompanionState.HINT, CompanionState.OBSERVING,
      (from, to, ctx) => this.executeHintToObserving(from, to, ctx));
    this.registerTransitionAction(CompanionState.HINT, CompanionState.ACTIVE,
      (from, to, ctx) => this.executeHintToActive(from, to, ctx));
    this.registerTransitionAction(CompanionState.ACTIVE, CompanionState.HINT,
      (from, to, ctx) => this.executeActiveToHint(from, to, ctx));
    this.registerTransitionAction(CompanionState.ACTIVE, CompanionState.OBSERVING,
      (from, to, ctx) => this.executeActiveToObserving(from, to, ctx));
    // Register wildcard retreat action (fires from any state when RETREATING)
    this.registerWildcardTransitionAction(CompanionState.RETREATING,
      (from, to, ctx) => this.executeRetreat(from, to, ctx));
    this.registerTransitionAction(CompanionState.RETREATING, CompanionState.STEALTH,
      (from, to, ctx) => this.executeRetreatToStealth(from, to, ctx));
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get the current state
   */
  public getCurrentState(): CompanionState {
    return this.currentState;
  }

  /**
   * Get the full state history
   */
  public getStateHistory(): ReadonlyArray<StateHistoryEntry> {
    return [...this.stateHistory];
  }

  /**
   * Get transition count for a specific state
   */
  public getTransitionCount(state: CompanionState): number {
    return this.transitionCount.get(state) ?? 0;
  }

  /**
   * Get all transition counts
   */
  public getAllTransitionCounts(): Map<CompanionState, number> {
    return new Map(this.transitionCount);
  }

  /**
   * Get duration of current state in milliseconds
   */
  public getCurrentStateDuration(): number {
    return Date.now() - this.stateEntryTime;
  }

  /**
   * Get the last state from history (excluding current)
   */
  public getLastState(): CompanionState | null {
    if (this.stateHistory.length < 2) {
      return null;
    }
    return this.stateHistory[this.stateHistory.length - 2].state;
  }

  /**
   * Update the context for transition evaluation
   */
  public updateContext(context: Partial<StateContext>): void {
    this.currentContext = { ...this.currentContext, ...context };
    log.debug(`[StateEngine] Context updated:`, this.currentContext);
  }

  /**
   * Get current context
   */
  public getContext(): StateContext {
    return { ...this.currentContext };
  }

  /**
   * Find valid transition based on current context
   */
  public findValidTransition(context?: StateContext): CompanionState | null {
    const ctx = context ?? this.currentContext;
    
    // Check for RETREATING first - it's always allowed from any state
    if (this.shouldRetreat(ctx)) {
      return CompanionState.RETREATING;
    }

    // Evaluate transitions based on current state
    switch (this.currentState) {
      case CompanionState.STEALTH:
        return this.evaluateStealthTransitions(ctx);
      case CompanionState.OBSERVING:
        return this.evaluateObservingTransitions(ctx);
      case CompanionState.HINT:
        return this.evaluateHintTransitions(ctx);
      case CompanionState.ACTIVE:
        return this.evaluateActiveTransitions(ctx);
      case CompanionState.RETREATING:
        return this.evaluateRetreatingTransitions(ctx);
      default:
        return null;
    }
  }

  /**
   * Transition to a new state if valid
   */
  public transitionTo(newState: CompanionState, context?: StateContext): boolean {
    const ctx = context ?? this.currentContext;

    // Validate transition
    if (!this.isValidTransition(this.currentState, newState, ctx)) {
      log.warn(`[StateEngine] Invalid transition attempted: ${this.currentState} -> ${newState}`);
      return false;
    }

    const previousState = this.currentState;
    
    // Execute transition
    this.executeTransition(previousState, newState, ctx);
    
    return true;
  }

  /**
   * Force transition to a new state (bypasses rules, for manual override)
   */
  public forceTransition(newState: CompanionState, reason?: string): void {
    const previousState = this.currentState;
    
    log.info(`[StateEngine] Force transition: ${previousState} -> ${newState}${reason ? ` (${reason})` : ''}`);
    
    // Record exit of current state
    this.recordStateExit(this.currentState);

    // Track when we last exited RETREATING (for cooldown)
    if (this.currentState === CompanionState.RETREATING) {
      this.lastRetreatAt = Date.now();
    }

    // Update state
    this.currentState = newState;
    this.stateEntryTime = Date.now();
    
    // Increment transition count
    this.incrementTransitionCount(newState);
    
    // Record entry of new state
    this.recordStateEntry(newState);
    
    // Notify listeners
    this.notifyStateChange(newState, previousState);
  }

  /**
   * Check if a transition is valid
   */
  public isValidTransition(from: CompanionState, to: CompanionState, context?: StateContext): boolean {
    const ctx = context ?? this.currentContext;

    // Same state transition is not valid (unless it's a no-op)
    if (from === to) {
      return false;
    }

    // RETREATING is always reachable from any state
    if (to === CompanionState.RETREATING) {
      return true;
    }

    // Check specific transition rules
    switch (from) {
      case CompanionState.STEALTH:
        return to === CompanionState.OBSERVING;
      case CompanionState.OBSERVING:
        return to === CompanionState.STEALTH || to === CompanionState.HINT;
      case CompanionState.HINT:
        return to === CompanionState.OBSERVING || to === CompanionState.ACTIVE;
      case CompanionState.ACTIVE:
        return to === CompanionState.HINT || to === CompanionState.OBSERVING;
      case CompanionState.RETREATING:
        return to === CompanionState.STEALTH;
      default:
        return false;
    }
  }

  /**
   * Register a state change listener
   */
  public onStateChange(listener: StateChangeListener): void {
    this.stateChangeListeners.add(listener);
    log.debug(`[StateEngine] State change listener added. Total: ${this.stateChangeListeners.size}`);
  }

  /**
   * Remove a state change listener
   */
  public removeStateChangeListener(listener: StateChangeListener): void {
    this.stateChangeListeners.delete(listener);
    log.debug(`[StateEngine] State change listener removed. Total: ${this.stateChangeListeners.size}`);
  }

  /**
   * Register a transition action for a specific state pair
   * Use '*' as from to register a wildcard action for all transitions to 'to'
   */
  public registerTransitionAction(from: CompanionState, to: CompanionState, action: TransitionAction): void {
    const key = `${from}->${to}`;
    if (!this.transitionActions.has(key)) {
      this.transitionActions.set(key, []);
    }
    this.transitionActions.get(key)!.push(action);
  }

  /**
   * Register a wildcard transition action (fires for any transition to the target state)
   */
  public registerWildcardTransitionAction(to: CompanionState, action: TransitionAction): void {
    this.registerTransitionAction('*' as CompanionState, to, action);
  }

  /**
   * Process a tick (call periodically to evaluate transitions)
   */
  public tick(): CompanionState | null {
    const potentialNextState = this.findValidTransition();
    
    if (potentialNextState && potentialNextState !== this.currentState) {
      this.transitionTo(potentialNextState);
      return potentialNextState;
    }
    
    return null;
  }

  /**
   * Reset the state engine to initial state
   */
  public reset(): void {
    const initialState = CompanionState.STEALTH;
    
    log.info(`[StateEngine] Resetting to ${initialState}`);
    
    // Record exit of current state
    this.recordStateExit(this.currentState);
    
    // Clear history
    this.stateHistory = [];
    
    // Reset transition counts
    this.transitionCount.clear();
    Object.values(CompanionState).forEach(state => {
      this.transitionCount.set(state, 0);
    });
    
    // Set initial state
    this.currentState = initialState;
    this.stateEntryTime = Date.now();
    this.currentContext = this.createDefaultContext();
    
    // Record entry
    this.recordStateEntry(initialState);
    
    // Notify listeners
    this.notifyStateChange(initialState, initialState);
  }

  /**
   * Get statistics about the state machine
   */
  public getStatistics(): {
    currentState: CompanionState;
    totalTransitions: number;
    stateTransitions: Record<string, number>;
    currentStateDuration: number;
    totalHistoryEntries: number;
  } {
    let totalTransitions = 0;
    const stateTransitions: Record<string, number> = {};
    
    this.transitionCount.forEach((count, state) => {
      totalTransitions += count;
      stateTransitions[state] = count;
    });

    return {
      currentState: this.currentState,
      totalTransitions,
      stateTransitions,
      currentStateDuration: this.getCurrentStateDuration(),
      totalHistoryEntries: this.stateHistory.length
    };
  }

  // ============================================================================
  // Private Methods - State Evaluation
  // ============================================================================

  private shouldRetreat(context: StateContext): boolean {
    // Don't retreat if we just exited RETREATING (cooldown period)
    const RETREAT_COOLDOWN_MS = 30_000;
    if (this.lastRetreatAt !== null && Date.now() - this.lastRetreatAt < RETREAT_COOLDOWN_MS) {
      return false;
    }
    return context.manualOverride ||
           context.errorCount > 50 ||
           context.systemLoad > 0.9;
  }

  private evaluateStealthTransitions(context: StateContext): CompanionState | null {
    // STEALTH -> OBSERVING: When user activity detected or session starts
    if (context.userActivity > 0 || context.sessionDuration > 5000) {
      return CompanionState.OBSERVING;
    }
    return null;
  }

  private evaluateObservingTransitions(context: StateContext): CompanionState | null {
    // OBSERVING -> STEALTH: On inactivity
    if (context.userActivity === 0 && 
        Date.now() - context.lastActivityTimestamp > 30000) {
      return CompanionState.STEALTH;
    }
    
    // OBSERVING -> HINT: When attention needed or patterns detected
    if (context.attentionNeeded || context.clipboardChanged) {
      return CompanionState.HINT;
    }
    
    return null;
  }

  private evaluateHintTransitions(context: StateContext): CompanionState | null {
    // HINT -> OBSERVING: When hint acknowledged or attention no longer needed
    if (!context.attentionNeeded && !context.clipboardChanged) {
      return CompanionState.OBSERVING;
    }
    
    // HINT -> ACTIVE: When task requires direct intervention
    if (context.taskActive && context.attentionNeeded) {
      return CompanionState.ACTIVE;
    }
    
    return null;
  }

  private evaluateActiveTransitions(context: StateContext): CompanionState | null {
    // ACTIVE -> HINT: When task partially complete or user介入
    if (!context.taskActive || context.userActivity > 0) {
      return CompanionState.HINT;
    }
    
    // ACTIVE -> OBSERVING: When task complete
    if (!context.taskActive && !context.attentionNeeded) {
      return CompanionState.OBSERVING;
    }
    
    return null;
  }

  private evaluateRetreatingTransitions(context: StateContext): CompanionState | null {
    // RETREATING -> STEALTH: After cleanup, prepare for restart
    if (context.sessionDuration > 0) {
      return CompanionState.STEALTH;
    }
    return null;
  }

  // ============================================================================
  // Private Methods - Transition Execution
  // ============================================================================

  private executeTransition(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.info(`[StateEngine] Transition: ${from} -> ${to}`);

    // Record exit of current state
    this.recordStateExit(from);

    // Track when we last exited RETREATING (for cooldown)
    if (from === CompanionState.RETREATING) {
      this.lastRetreatAt = Date.now();
    }

    // Execute transition actions
    this.executeTransitionActions(from, to, context);

    // Update state
    this.currentState = to;
    this.stateEntryTime = Date.now();

    // Increment transition count
    this.incrementTransitionCount(to);

    // Record entry of new state
    this.recordStateEntry(to);

    // Notify listeners
    this.notifyStateChange(to, from);
  }

  private executeTransitionActions(from: CompanionState, to: CompanionState, context: StateContext): void {
    // Execute specific transition action
    const key = `${from}->${to}`;
    const actions = this.transitionActions.get(key);
    
    if (actions) {
      for (const action of actions) {
        try {
          action(from, to, context);
        } catch (error) {
          log.error(`[StateEngine] Transition action error: ${error}`);
        }
      }
    }

    // Execute wildcard RETREATING actions if transitioning to RETREATING
    if (to === CompanionState.RETREATING) {
      const wildcardKey = `*->${CompanionState.RETREATING}`;
      const wildcardActions = this.transitionActions.get(wildcardKey);
      if (wildcardActions) {
        for (const action of wildcardActions) {
          try {
            action(from, to, context);
          } catch (error) {
            log.error(`[StateEngine] Wildcard retreat action error: ${error}`);
          }
        }
      }
    }
  }

  // ============================================================================
  // Private Methods - Transition Action Handlers
  // ============================================================================

  private executeStealthToObserving(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: STEALTH -> OBSERVING`);
    // Enable perception monitoring
    // Start clipboard monitoring
    // Begin screen capture capabilities
  }

  private executeObservingToStealth(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: OBSERVING -> STEALTH`);
    // Reduce perception polling frequency
    // Minimize resource usage
    // Clear sensitive context data
  }

  private executeObservingToHint(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: OBSERVING -> HINT`);
    // Prepare UI for hint display
    // Analyze current screen context
    // Generate appropriate hint
  }

  private executeHintToObserving(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: HINT -> OBSERVING`);
    // Dismiss hint UI
    // Resume observation
  }

  private executeHintToActive(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: HINT -> ACTIVE`);
    // Show active assistance UI
    // Enable full interaction capabilities
    // Begin task-focused mode
  }

  private executeActiveToHint(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: ACTIVE -> HINT`);
    // Reduce UI presence
    // Continue monitoring
    // Prepare for hint mode
  }

  private executeActiveToObserving(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: ACTIVE -> OBSERVING`);
    // Complete task cleanup
    // Reset to observation mode
  }

  private executeRetreat(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: RETREAT from ${from}`);
    // Save state
    // Clear sensitive data
    // Prepare for graceful shutdown
  }

  private executeRetreatToStealth(from: CompanionState, to: CompanionState, context: StateContext): void {
    log.debug(`[StateEngine] Action: RETREAT -> STEALTH`);
    // Reset all modules
    // Prepare for fresh session
  }

  // ============================================================================
  // Private Methods - State History
  // ============================================================================

  private recordStateEntry(state: CompanionState): void {
    const entry: StateHistoryEntry = {
      state,
      enteredAt: Date.now(),
      exitedAt: null,
      duration: null,
      transitionsFrom: this.transitionCount.get(state) ?? 0
    };
    this.stateHistory.push(entry);
  }

  private recordStateExit(state: CompanionState): void {
    const lastEntry = this.stateHistory[this.stateHistory.length - 1];
    if (lastEntry && lastEntry.state === state && lastEntry.exitedAt === null) {
      lastEntry.exitedAt = Date.now();
      lastEntry.duration = lastEntry.exitedAt - lastEntry.enteredAt;
    }
  }

  private incrementTransitionCount(state: CompanionState): void {
    const current = this.transitionCount.get(state) ?? 0;
    this.transitionCount.set(state, current + 1);
  }

  private notifyStateChange(newState: CompanionState, previousState: CompanionState): void {
    const listeners = Array.from(this.stateChangeListeners);
    for (const listener of listeners) {
      try {
        listener(newState, previousState, this.currentContext);
      } catch (error) {
        log.error(`[StateEngine] State change listener error: ${error}`);
      }
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let stateEngineInstance: StateEngine | null = null;

export function getStateEngine(): StateEngine {
  if (!stateEngineInstance) {
    stateEngineInstance = new StateEngine();
  }
  return stateEngineInstance;
}

export function createStateEngine(initialState?: CompanionState): StateEngine {
  stateEngineInstance = new StateEngine(initialState);
  return stateEngineInstance;
}

// ============================================================================
// Exports
// ============================================================================

export default StateEngine;
export { StateContext, StateHistoryEntry, TransitionAction };
