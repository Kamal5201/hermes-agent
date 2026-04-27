import type { TaskEnvelope } from '../contracts/TaskEnvelope';

export type RemoteAdapterPlatform = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'unknown';
export type RemoteDeviceStatus = 'online' | 'offline' | 'degraded' | 'blocked';
export type RemoteSessionStatus = 'active' | 'paused' | 'ended';

export interface RemoteDevice {
  id: string;
  name: string;
  platform: RemoteAdapterPlatform;
  status: RemoteDeviceStatus;
  lastSeen: number;
  capabilities: string[];
  adapter: string;
  endpoint?: string;
  ip?: string;
  port?: number;
  metadata?: Record<string, unknown>;
}

export interface RemoteSession {
  id: string;
  device: RemoteDevice;
  adapter: string;
  startTime: number;
  status: RemoteSessionStatus;
  metadata?: Record<string, unknown>;
}

export interface AdapterProbeResult {
  available: boolean;
  checkedAt: number;
  devices: RemoteDevice[];
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RemoteAdapter {
  readonly name: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  probe(): Promise<AdapterProbeResult>;
  connect(deviceId: string): Promise<RemoteSession>;
  submitTask(task: TaskEnvelope): Promise<{ taskId: string }>;
  getTask(taskId: string): Promise<TaskEnvelope | null>;
  cancelTask(taskId: string): Promise<void>;
  supports?(device: RemoteDevice, task?: TaskEnvelope): boolean;
}
