import type { TaskArtifacts, WindowsTaskStatus } from './TaskEnvelope';

export interface TaskErrorInfo {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  status: WindowsTaskStatus;
  updatedAt: number;
  completedAt?: number;
  output?: unknown;
  checkpoint?: Record<string, unknown>;
  artifacts?: TaskArtifacts;
  error?: TaskErrorInfo;
  metadata?: Record<string, unknown>;
}
