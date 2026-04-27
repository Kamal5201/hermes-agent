export type RemoteTaskKind = 'browser' | 'desktop' | 'hybrid';
export type RemoteTaskTarget = 'windows';
export type RemoteTaskPriority = 'high' | 'normal' | 'low';

export type WindowsTaskStatus =
  | 'queued'
  | 'routing'
  | 'running'
  | 'wait_login'
  | 'blocked'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'completed'
  | 'cancelled';

export interface TaskConstraints {
  interactiveSessionRequired?: boolean;
  browserPreferred?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  requiredCapabilities?: string[];
}

export interface TaskArtifacts {
  screenshots?: string[];
  snapshots?: string[];
  logs?: string[];
}

export interface TaskEnvelope {
  id: string;
  kind: RemoteTaskKind;
  target: RemoteTaskTarget;
  intent: string;
  priority: RemoteTaskPriority;
  createdAt: number;
  updatedAt: number;
  status: WindowsTaskStatus;
  deviceId?: string;
  adapter?: string;
  input?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  constraints?: TaskConstraints;
  artifacts?: TaskArtifacts;
  metadata?: Record<string, unknown>;
  lastError?: string;
}

export const TERMINAL_TASK_STATUSES: WindowsTaskStatus[] = [
  'failed_terminal',
  'completed',
  'cancelled',
];

export function isTerminalTaskStatus(status: WindowsTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}
