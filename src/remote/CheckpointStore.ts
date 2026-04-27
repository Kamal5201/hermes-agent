import { promises as fs } from 'fs';
import path from 'path';
import type { TaskArtifacts, TaskEnvelope, WindowsTaskStatus } from './contracts/TaskEnvelope';
import type { TaskResult } from './contracts/TaskResult';

export interface TaskArchivePaths {
  taskId: string;
  rootAbs: string;
  rootRelative: string;
  logsDirAbs: string;
  logsDirRelative: string;
  taskFileAbs: string;
  taskFileRelative: string;
  resultFileAbs: string;
  resultFileRelative: string;
  checkpointsFileAbs: string;
  checkpointsFileRelative: string;
}

export interface TaskCheckpointRecord {
  ts: string;
  taskId: string;
  status: WindowsTaskStatus;
  reason: string;
  checkpoint?: Record<string, unknown>;
  lastError?: string;
  attempt: number;
  retryCount: number;
  resumeCount: number;
  retryBudgetRemaining: number;
  adapter?: string;
  deviceId?: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_ARTIFACTS_ROOT = path.resolve(process.cwd(), 'artifacts', 'windows-tasks');
const CHECKPOINTS_FILENAME = 'checkpoints.jsonl';

export class CheckpointStore {
  constructor(
    private readonly artifactsRoot: string = DEFAULT_ARTIFACTS_ROOT,
  ) {}

  public getTaskArchive(taskId: string): TaskArchivePaths {
    const rootAbs = path.join(this.artifactsRoot, taskId);
    const logsDirAbs = path.join(rootAbs, 'logs');
    const taskFileAbs = path.join(rootAbs, 'task.json');
    const resultFileAbs = path.join(rootAbs, 'result.json');
    const checkpointsFileAbs = path.join(rootAbs, CHECKPOINTS_FILENAME);

    return {
      taskId,
      rootAbs,
      rootRelative: toRelativePath(rootAbs),
      logsDirAbs,
      logsDirRelative: toRelativePath(logsDirAbs),
      taskFileAbs,
      taskFileRelative: toRelativePath(taskFileAbs),
      resultFileAbs,
      resultFileRelative: toRelativePath(resultFileAbs),
      checkpointsFileAbs,
      checkpointsFileRelative: toRelativePath(checkpointsFileAbs),
    };
  }

  public async persistTask(task: TaskEnvelope): Promise<TaskArchivePaths> {
    const archive = this.getTaskArchive(task.id);
    await this.ensureArchiveDirs(archive);
    await fs.writeFile(archive.taskFileAbs, safeJson(task), 'utf8');
    return archive;
  }

  public async appendCheckpoint(
    task: TaskEnvelope,
    options: {
      reason: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<TaskArchivePaths> {
    const archive = this.getTaskArchive(task.id);
    await this.ensureArchiveDirs(archive);

    const policy = getRemoteMetadata(task.metadata);
    const record: TaskCheckpointRecord = {
      ts: new Date().toISOString(),
      taskId: task.id,
      status: task.status,
      reason: options.reason,
      checkpoint: task.checkpoint ? { ...task.checkpoint } : undefined,
      lastError: task.lastError,
      attempt: asNumber(policy.attempt),
      retryCount: asNumber(policy.retryCount),
      resumeCount: asNumber(policy.resumeCount),
      retryBudgetRemaining: asNumber(policy.retryBudgetRemaining),
      adapter: task.adapter,
      deviceId: task.deviceId,
      metadata: options.metadata ? { ...options.metadata } : undefined,
    };

    await fs.appendFile(archive.checkpointsFileAbs, `${JSON.stringify(record)}\n`, 'utf8');
    return archive;
  }

  public async loadTask(taskId: string): Promise<TaskEnvelope | null> {
    const archive = this.getTaskArchive(taskId);
    return readJsonFile<TaskEnvelope>(archive.taskFileAbs);
  }

  public async loadResult(taskId: string): Promise<TaskResult | null> {
    const archive = this.getTaskArchive(taskId);
    return readJsonFile<TaskResult>(archive.resultFileAbs);
  }

  public async persistResult(result: TaskResult): Promise<TaskArchivePaths> {
    const archive = this.getTaskArchive(result.taskId);
    await this.ensureArchiveDirs(archive);
    await fs.writeFile(archive.resultFileAbs, safeJson(result), 'utf8');
    return archive;
  }

  public async hydrateTask(taskId: string): Promise<TaskEnvelope | null> {
    const [task, result] = await Promise.all([
      this.loadTask(taskId),
      this.loadResult(taskId),
    ]);

    if (!task) {
      return null;
    }

    if (!result) {
      return cloneTask(task);
    }

    const shouldOverlayResult = result.updatedAt >= task.updatedAt;
    if (!shouldOverlayResult) {
      return cloneTask(task);
    }

    return this.mergeTaskAndResult(task, result);
  }

  private mergeTaskAndResult(
    task: TaskEnvelope,
    result: TaskResult,
  ): TaskEnvelope {
    return cloneTask({
      ...task,
      status: result.status,
      updatedAt: Math.max(task.updatedAt, result.updatedAt),
      checkpoint: result.checkpoint ? { ...result.checkpoint } : task.checkpoint,
      artifacts: mergeArtifacts(task.artifacts, result.artifacts),
      metadata: mergeMetadata(task.metadata, result.metadata),
      lastError: result.error?.message ?? task.lastError,
    });
  }

  private async ensureArchiveDirs(archive: TaskArchivePaths): Promise<void> {
    await fs.mkdir(archive.rootAbs, { recursive: true });
    await fs.mkdir(archive.logsDirAbs, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string): Promise<T | null> {
  return fs.readFile(filePath, 'utf8')
    .then((content) => JSON.parse(content) as T)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
}

function mergeArtifacts(base: TaskArtifacts | undefined, patch: TaskArtifacts | undefined): TaskArtifacts | undefined {
  if (!base && !patch) {
    return undefined;
  }

  return {
    screenshots: mergeStringArrays(base?.screenshots, patch?.screenshots),
    snapshots: mergeStringArrays(base?.snapshots, patch?.snapshots),
    logs: mergeStringArrays(base?.logs, patch?.logs),
  };
}

function mergeStringArrays(current: string[] | undefined, next: string[] | undefined): string[] | undefined {
  const merged = [...(current ?? []), ...(next ?? [])].filter((value): value is string => Boolean(value));
  if (merged.length === 0) {
    return undefined;
  }

  return Array.from(new Set(merged));
}

function mergeMetadata(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!current && !next) {
    return undefined;
  }

  return {
    ...(current ?? {}),
    ...(next ?? {}),
  };
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

function safeJson(value: unknown): string {
  return JSON.stringify(value, replaceErrors, 2);
}

function replaceErrors(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

function toRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath) || '.';
}

function getRemoteMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const remote = metadata?.remote;
  return remote && typeof remote === 'object' && !Array.isArray(remote)
    ? { ...(remote as Record<string, unknown>) }
    : {};
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export default CheckpointStore;
