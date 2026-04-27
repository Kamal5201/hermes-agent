import type { RemoteTaskPriority, TaskEnvelope } from './contracts/TaskEnvelope';
import type { TaskDispatchMode } from './TaskPolicy';
import type { TaskRouteRecord } from './TaskRouter';

export type TaskQueueEntryState = 'queued' | 'scheduled' | 'inflight' | 'paused';

export interface TaskQueueEntry {
  taskId: string;
  priority: RemoteTaskPriority;
  createdAt: number;
  availableAt: number;
  state: TaskQueueEntryState;
  dispatchMode: TaskDispatchMode;
  route?: TaskRouteRecord;
  lastObservedFingerprint?: string;
}

export class TaskQueue {
  private readonly entries = new Map<string, TaskQueueEntry>();

  public enqueue(
    task: TaskEnvelope,
    options: {
      availableAt?: number;
      route?: TaskRouteRecord;
      dispatchMode?: TaskDispatchMode;
    } = {},
  ): TaskQueueEntry {
    const now = Date.now();
    const availableAt = options.availableAt ?? now;
    const existing = this.entries.get(task.id);
    const entry: TaskQueueEntry = {
      taskId: task.id,
      priority: task.priority,
      createdAt: existing?.createdAt ?? now,
      availableAt,
      state: availableAt > now ? 'scheduled' : 'queued',
      dispatchMode: options.dispatchMode ?? existing?.dispatchMode ?? 'initial',
      route: options.route ?? existing?.route,
      lastObservedFingerprint: existing?.lastObservedFingerprint,
    };

    this.entries.set(task.id, entry);
    return { ...entry, route: entry.route ? { ...entry.route } : undefined };
  }

  public upsert(
    task: TaskEnvelope,
    options: Partial<Pick<TaskQueueEntry, 'availableAt' | 'state' | 'dispatchMode' | 'route'>> = {},
  ): TaskQueueEntry {
    const now = Date.now();
    const existing = this.entries.get(task.id);
    const entry: TaskQueueEntry = {
      taskId: task.id,
      priority: task.priority,
      createdAt: existing?.createdAt ?? now,
      availableAt: options.availableAt ?? existing?.availableAt ?? now,
      state: options.state ?? existing?.state ?? 'paused',
      dispatchMode: options.dispatchMode ?? existing?.dispatchMode ?? 'initial',
      route: options.route ?? existing?.route,
      lastObservedFingerprint: existing?.lastObservedFingerprint,
    };

    this.entries.set(task.id, entry);
    return { ...entry, route: entry.route ? { ...entry.route } : undefined };
  }

  public get(taskId: string): TaskQueueEntry | null {
    const entry = this.entries.get(taskId);
    return entry ? { ...entry, route: entry.route ? { ...entry.route } : undefined } : null;
  }

  public setRoute(taskId: string, route: TaskRouteRecord): void {
    const entry = this.entries.get(taskId);
    if (!entry) {
      return;
    }

    this.entries.set(taskId, {
      ...entry,
      route: { ...route },
    });
  }

  public rename(taskId: string, nextTaskId: string): void {
    if (taskId === nextTaskId) {
      return;
    }

    const entry = this.entries.get(taskId);
    if (!entry) {
      return;
    }

    this.entries.delete(taskId);
    this.entries.set(nextTaskId, {
      ...entry,
      taskId: nextTaskId,
    });
  }

  public markInflight(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) {
      return;
    }

    this.entries.set(taskId, {
      ...entry,
      state: 'inflight',
      availableAt: Date.now(),
    });
  }

  public pause(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) {
      return;
    }

    this.entries.set(taskId, {
      ...entry,
      state: 'paused',
    });
  }

  public remove(taskId: string): void {
    this.entries.delete(taskId);
  }

  public takeDue(now: number = Date.now()): TaskQueueEntry | null {
    const dueEntries = [...this.entries.values()]
      .filter((entry) => (entry.state === 'queued' || entry.state === 'scheduled') && entry.availableAt <= now)
      .sort((left, right) => {
        const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        if (left.availableAt !== right.availableAt) {
          return left.availableAt - right.availableAt;
        }

        return left.createdAt - right.createdAt;
      });

    if (dueEntries.length === 0) {
      return null;
    }

    const nextEntry = dueEntries[0];
    this.markInflight(nextEntry.taskId);
    return this.get(nextEntry.taskId);
  }

  public listInflightTaskIds(): string[] {
    return [...this.entries.values()]
      .filter((entry) => entry.state === 'inflight')
      .map((entry) => entry.taskId);
  }

  public noteObservation(task: TaskEnvelope): boolean {
    const fingerprint = fingerprintTask(task);
    const existing = this.entries.get(task.id);
    const lastObservedFingerprint = existing?.lastObservedFingerprint;
    const changed = lastObservedFingerprint !== fingerprint;

    this.upsert(task, {
      state: existing?.state ?? 'paused',
      route: existing?.route,
      dispatchMode: existing?.dispatchMode,
      availableAt: existing?.availableAt,
    });

    const entry = this.entries.get(task.id);
    if (entry) {
      entry.lastObservedFingerprint = fingerprint;
      this.entries.set(task.id, entry);
    }

    return changed;
  }

  public hasPendingWork(_now: number = Date.now()): boolean {
    return [...this.entries.values()].some((entry) => (
      entry.state === 'inflight'
      || entry.state === 'queued'
      || entry.state === 'scheduled'
    ));
  }

  public nextDelayMs(now: number = Date.now(), inflightPollMs: number = 500): number | null {
    if (this.listInflightTaskIds().length > 0) {
      return inflightPollMs;
    }

    const scheduledEntries = [...this.entries.values()]
      .filter((entry) => entry.state === 'queued' || entry.state === 'scheduled')
      .sort((left, right) => left.availableAt - right.availableAt);

    if (scheduledEntries.length === 0) {
      return null;
    }

    return Math.max(scheduledEntries[0].availableAt - now, 0);
  }
}

function priorityScore(priority: RemoteTaskPriority): number {
  switch (priority) {
    case 'high':
      return 3;
    case 'normal':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function fingerprintTask(task: TaskEnvelope): string {
  return JSON.stringify({
    status: task.status,
    updatedAt: task.updatedAt,
    checkpoint: task.checkpoint ?? null,
    lastError: task.lastError ?? null,
  });
}

export default TaskQueue;
