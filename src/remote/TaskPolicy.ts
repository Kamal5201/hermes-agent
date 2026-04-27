import type { TaskArtifacts, TaskEnvelope } from './contracts/TaskEnvelope';
import type { TaskArchivePaths } from './CheckpointStore';

export type TaskDispatchMode = 'initial' | 'retry' | 'resume';

export interface TaskPolicyState {
  attempt: number;
  retryCount: number;
  resumeCount: number;
  maxRetries: number;
  retryBudgetRemaining: number;
  nextRetryAt?: number;
  autoRetryExhausted: boolean;
}

export interface AutoRetryPlan {
  task: TaskEnvelope;
  delayMs: number;
  nextRetryAt: number;
}

export const RESUME_ELIGIBLE_TASK_STATUSES = new Set<TaskEnvelope['status']>([
  'wait_login',
  'blocked',
  'failed_retryable',
]);

export const ACTIVE_RECOVERABLE_TASK_STATUSES = new Set<TaskEnvelope['status']>([
  'queued',
  'routing',
  'running',
]);

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed_terminal']);

export class TaskPolicy {
  constructor(
    private readonly defaultMaxRetries: number = 2,
    private readonly baseBackoffMs: number = 1_000,
    private readonly maxBackoffMs: number = 10_000,
  ) {}

  public decorateNewTask(task: TaskEnvelope, archive: TaskArchivePaths, now: number = Date.now()): TaskEnvelope {
    const maxRetries = this.resolveMaxRetries(task);

    return cloneTask({
      ...task,
      status: 'queued',
      updatedAt: now,
      artifacts: mergeArtifacts(task.artifacts, {
        logs: [archive.checkpointsFileRelative],
      }),
      metadata: mergeRemoteMetadata(task.metadata, {
        archivePath: archive.rootRelative,
        taskFile: archive.taskFileRelative,
        resultFile: archive.resultFileRelative,
        checkpointsFile: archive.checkpointsFileRelative,
        attempt: 0,
        retryCount: 0,
        resumeCount: 0,
        maxRetries,
        retryBudgetRemaining: maxRetries,
        autoRetryExhausted: false,
        lastQueueEvent: 'task_created',
      }),
    });
  }

  public getState(task: TaskEnvelope): TaskPolicyState {
    const remote = getRemoteMetadata(task.metadata);
    const maxRetries = asNonNegativeInteger(remote.maxRetries, this.resolveMaxRetries(task));
    const retryCount = asNonNegativeInteger(remote.retryCount, 0);

    return {
      attempt: asNonNegativeInteger(remote.attempt, 0),
      retryCount,
      resumeCount: asNonNegativeInteger(remote.resumeCount, 0),
      maxRetries,
      retryBudgetRemaining: asNonNegativeInteger(remote.retryBudgetRemaining, Math.max(maxRetries - retryCount, 0)),
      nextRetryAt: typeof remote.nextRetryAt === 'number' && Number.isFinite(remote.nextRetryAt)
        ? remote.nextRetryAt
        : undefined,
      autoRetryExhausted: Boolean(remote.autoRetryExhausted),
    };
  }

  public canAutoRetry(task: TaskEnvelope): boolean {
    const state = this.getState(task);
    return task.status === 'failed_retryable' && state.retryBudgetRemaining > 0;
  }

  public scheduleAutoRetry(task: TaskEnvelope, now: number = Date.now()): AutoRetryPlan | null {
    const state = this.getState(task);
    if (task.status !== 'failed_retryable' || state.retryBudgetRemaining <= 0) {
      return null;
    }

    const nextRetryCount = state.retryCount + 1;
    const delayMs = this.calculateRetryDelay(nextRetryCount);
    const nextRetryAt = now + delayMs;
    const retryBudgetRemaining = Math.max(state.maxRetries - nextRetryCount, 0);

    return {
      delayMs,
      nextRetryAt,
      task: cloneTask({
        ...task,
        status: 'queued',
        updatedAt: now,
        metadata: mergeRemoteMetadata(task.metadata, {
          retryCount: nextRetryCount,
          retryBudgetRemaining,
          nextRetryAt,
          autoRetryExhausted: false,
          lastQueueEvent: 'retry_scheduled',
          lastFailureStatus: 'failed_retryable',
          lastFailureAt: now,
          lastFailureMessage: task.lastError,
        }),
      }),
    };
  }

  public markRetryBudgetExhausted(task: TaskEnvelope, now: number = Date.now()): TaskEnvelope {
    const state = this.getState(task);

    return cloneTask({
      ...task,
      updatedAt: now,
      metadata: mergeRemoteMetadata(task.metadata, {
        retryBudgetRemaining: state.retryBudgetRemaining,
        nextRetryAt: undefined,
        autoRetryExhausted: true,
        lastQueueEvent: 'retry_budget_exhausted',
      }),
    });
  }

  public prepareForResume(
    task: TaskEnvelope,
    checkpointPatch?: Record<string, unknown>,
    now: number = Date.now(),
  ): TaskEnvelope {
    return cloneTask({
      ...task,
      status: 'queued',
      updatedAt: now,
      checkpoint: checkpointPatch ? mergeObjects(task.checkpoint, checkpointPatch) : task.checkpoint,
      lastError: undefined,
      metadata: mergeRemoteMetadata(task.metadata, {
        nextRetryAt: undefined,
        autoRetryExhausted: false,
        lastQueueEvent: 'resume_requested',
      }),
    });
  }

  public prepareForDispatch(task: TaskEnvelope, mode: TaskDispatchMode, now: number = Date.now()): TaskEnvelope {
    const state = this.getState(task);

    return cloneTask({
      ...task,
      updatedAt: now,
      lastError: mode === 'retry' || mode === 'resume' ? undefined : task.lastError,
      metadata: mergeRemoteMetadata(task.metadata, {
        attempt: state.attempt + 1,
        resumeCount: mode === 'resume' ? state.resumeCount + 1 : state.resumeCount,
        nextRetryAt: undefined,
        autoRetryExhausted: false,
        lastDispatchMode: mode,
        lastQueueEvent: `dispatch_${mode}`,
      }),
    });
  }

  public isResumeEligible(task: TaskEnvelope): boolean {
    return RESUME_ELIGIBLE_TASK_STATUSES.has(task.status);
  }

  private resolveMaxRetries(task: TaskEnvelope): number {
    const configured = task.constraints?.maxRetries;
    return typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
      ? Math.floor(configured)
      : this.defaultMaxRetries;
  }

  private calculateRetryDelay(retryOrdinal: number): number {
    return Math.min(this.baseBackoffMs * Math.max(1, 2 ** Math.max(retryOrdinal - 1, 0)), this.maxBackoffMs);
  }
}

function cloneTask(task: TaskEnvelope): TaskEnvelope {
  return {
    ...task,
    input: task.input ? { ...task.input } : undefined,
    checkpoint: task.checkpoint ? { ...task.checkpoint } : undefined,
    constraints: task.constraints
      ? {
          ...task.constraints,
          requiredCapabilities: task.constraints.requiredCapabilities
            ? [...task.constraints.requiredCapabilities]
            : undefined,
        }
      : undefined,
    artifacts: task.artifacts
      ? {
          screenshots: task.artifacts.screenshots ? [...task.artifacts.screenshots] : undefined,
          snapshots: task.artifacts.snapshots ? [...task.artifacts.snapshots] : undefined,
          logs: task.artifacts.logs ? [...task.artifacts.logs] : undefined,
        }
      : undefined,
    metadata: task.metadata ? { ...task.metadata } : undefined,
  };
}

function mergeRemoteMetadata(
  metadata: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const remote = getRemoteMetadata(metadata);
  const mergedRemote = {
    ...remote,
    ...patch,
  };

  Object.keys(mergedRemote).forEach((key) => {
    if (mergedRemote[key] === undefined) {
      delete mergedRemote[key];
    }
  });

  return {
    ...(metadata ?? {}),
    remote: mergedRemote,
  };
}

function getRemoteMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const remote = metadata?.remote;
  return remote && typeof remote === 'object' && !Array.isArray(remote)
    ? { ...(remote as Record<string, unknown>) }
    : {};
}

function mergeArtifacts(current: TaskArtifacts | undefined, patch: TaskArtifacts | undefined): TaskArtifacts | undefined {
  if (!current && !patch) {
    return undefined;
  }

  return {
    screenshots: mergeStringArrays(current?.screenshots, patch?.screenshots),
    snapshots: mergeStringArrays(current?.snapshots, patch?.snapshots),
    logs: mergeStringArrays(current?.logs, patch?.logs),
  };
}

function mergeStringArrays(current: string[] | undefined, patch: string[] | undefined): string[] | undefined {
  const values = [...(current ?? []), ...(patch ?? [])].filter((value): value is string => Boolean(value));
  if (values.length === 0) {
    return undefined;
  }

  return Array.from(new Set(values));
}

function mergeObjects(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    ...patch,
  };
}

function asNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

export default TaskPolicy;
