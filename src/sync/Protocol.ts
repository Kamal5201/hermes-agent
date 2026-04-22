import { randomUUID } from 'crypto';
import { CompanionState } from '../state/CompanionState';

export type DevicePlatform = 'windows' | 'macos' | 'ios' | 'android' | 'linux' | 'unknown';
export type SyncPriority = 'high' | 'normal' | 'low';

export interface DeviceVectorClock {
  counter: number;
  updatedAt: number;
}

export interface DeviceStateSnapshot {
  deviceId: string;
  deviceName: string;
  platform: DevicePlatform;
  state: CompanionState | string;
  lastSync: number;
  batteryLevel?: number;
  isCharging?: boolean;
  metadata?: Record<string, unknown>;
  vectorClock?: DeviceVectorClock;
}

export interface RegisteredDevice extends DeviceStateSnapshot {
  registeredAt: number;
  lastSeen: number;
  status: 'active' | 'inactive';
  token?: string;
  capabilities: string[];
}

export interface HermesConnection {
  url: string;
  token?: string;
  reconnect: boolean;
  heartbeat: number;
}

export enum SyncMessageType {
  STATE_SYNC = 'state_sync',
  STATE_REQUEST = 'state_request',
  STATE_RESPONSE = 'state_response',
  HEARTBEAT = 'heartbeat',
  DEVICE_REGISTER = 'device_register',
  DEVICE_UNREGISTER = 'device_unregister',
  DEVICE_LIST = 'device_list',
}

export interface DeviceRegisterPayload {
  device: RegisteredDevice;
  issuedToken?: string;
}

export interface DeviceStatePayload {
  source: DeviceStateSnapshot;
  target?: string;
}

export interface StateRequestPayload {
  requesterId: string;
  target?: string;
}

export interface HeartbeatPayload {
  deviceId: string;
  sentAt: number;
}

export interface DeviceListPayload {
  devices: RegisteredDevice[];
}

export type SyncPayload =
  | DeviceRegisterPayload
  | DeviceStatePayload
  | StateRequestPayload
  | HeartbeatPayload
  | DeviceListPayload;

export interface SyncMessage<TPayload = SyncPayload> {
  id: string;
  type: SyncMessageType;
  payload: TPayload;
  timestamp: number;
  priority: SyncPriority;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  token?: string;
}

export interface ConflictResolutionResult {
  resolved: DeviceStateSnapshot;
  strategy: 'active_priority' | 'latest_wins' | 'vector_clock';
  localState: DeviceStateSnapshot;
  remoteState: DeviceStateSnapshot;
}

export function createSyncMessage<TPayload>(
  type: SyncMessageType,
  payload: TPayload,
  options: Partial<Pick<SyncMessage<TPayload>, 'priority' | 'sourceDeviceId' | 'targetDeviceId' | 'token'>> = {},
): SyncMessage<TPayload> {
  return {
    id: randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
    priority: options.priority ?? 'normal',
    sourceDeviceId: options.sourceDeviceId,
    targetDeviceId: options.targetDeviceId,
    token: options.token,
  };
}

export function isSyncMessage(value: unknown): value is SyncMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<SyncMessage>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.timestamp === 'number'
    && typeof candidate.priority === 'string'
    && 'payload' in candidate
  );
}

export function normalizePlatform(platform: string): DevicePlatform {
  switch (platform) {
    case 'darwin':
    case 'macos':
      return 'macos';
    case 'win32':
    case 'windows':
      return 'windows';
    case 'ios':
      return 'ios';
    case 'android':
      return 'android';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

export function resolveStateConflict(
  localState: DeviceStateSnapshot,
  remoteState: DeviceStateSnapshot,
): ConflictResolutionResult {
  const localVector = localState.vectorClock?.counter ?? 0;
  const remoteVector = remoteState.vectorClock?.counter ?? 0;

  if (localState.state === CompanionState.ACTIVE || remoteState.state === CompanionState.ACTIVE) {
    const resolved = localState.state === CompanionState.ACTIVE ? localState : remoteState;
    return {
      resolved,
      strategy: 'active_priority',
      localState,
      remoteState,
    };
  }

  if (localVector !== remoteVector) {
    const resolved = remoteVector > localVector ? remoteState : localState;
    return {
      resolved,
      strategy: 'vector_clock',
      localState,
      remoteState,
    };
  }

  const resolved = remoteState.lastSync >= localState.lastSync ? remoteState : localState;
  return {
    resolved,
    strategy: 'latest_wins',
    localState,
    remoteState,
  };
}
