import { EventEmitter } from 'events';
import WebSocket, { RawData } from 'ws';
import log from 'electron-log/main.js';
import type { DeviceRegistry } from './DeviceRegistry';
import {
  createSyncMessage,
  type ConflictResolutionResult,
  type DeviceRegisterPayload,
  type DeviceStatePayload,
  type DeviceStateSnapshot,
  type HermesConnection,
  type RegisteredDevice,
  type StateRequestPayload,
  type SyncMessage,
  SyncMessageType,
  isSyncMessage,
  resolveStateConflict,
} from './Protocol';

export interface StateSyncManagerOptions {
  connection?: Partial<HermesConnection>;
  getLocalState: () => Partial<DeviceStateSnapshot>;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export enum SyncConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
}

export interface ResolvedStateRecord {
  deviceId: string;
  resolvedAt: number;
  result: ConflictResolutionResult;
}

const DEFAULT_CONNECTION: HermesConnection = {
  url: '',
  reconnect: true,
  heartbeat: 30_000,
};

export class StateSyncManager extends EventEmitter {
  private socket: WebSocket | null = null;
  private state = SyncConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private connection: HermesConnection;
  private readonly resolvedStates = new Map<string, ResolvedStateRecord>();

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly options: StateSyncManagerOptions,
  ) {
    super();
    this.connection = {
      ...DEFAULT_CONNECTION,
      ...options.connection,
    };
  }

  public getConnectionState(): SyncConnectionState {
    return this.state;
  }

  public getKnownDevices(): RegisteredDevice[] {
    return this.registry.listDevices();
  }

  public getResolvedStates(): ResolvedStateRecord[] {
    return Array.from(this.resolvedStates.values()).map((record) => ({
      deviceId: record.deviceId,
      resolvedAt: record.resolvedAt,
      result: {
        ...record.result,
        resolved: { ...record.result.resolved },
        localState: { ...record.result.localState },
        remoteState: { ...record.result.remoteState },
      },
    }));
  }

  public async connect(overrides: Partial<HermesConnection> = {}): Promise<SyncConnectionState> {
    this.connection = {
      ...this.connection,
      ...overrides,
    };

    if (!this.connection.url) {
      throw new Error('Sync connection URL is required');
    }

    this.clearReconnectTimer();
    this.clearHeartbeatTimer();

    if (this.socket) {
      this.cleanupSocket();
    }

    await this.createSocket(this.connection.url);
    return this.state;
  }

  public async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();

    if (!this.socket) {
      this.updateState(SyncConnectionState.DISCONNECTED);
      return;
    }

    await this.safeSend(createSyncMessage(
      SyncMessageType.DEVICE_UNREGISTER,
      {
        device: this.registry.getLocalDevice(),
      } satisfies DeviceRegisterPayload,
      {
        sourceDeviceId: this.registry.getLocalDevice().deviceId,
        token: this.registry.getLocalDevice().token,
      },
    ));

    const socket = this.socket;
    this.socket = null;
    socket.removeAllListeners();
    socket.close();

    this.updateState(SyncConnectionState.DISCONNECTED);
  }

  public async registerDevice(): Promise<void> {
    const localDevice = this.buildLocalSnapshot();
    const registered = this.registry.ensureLocalDevice(localDevice as Partial<RegisteredDevice>);

    await this.safeSend(createSyncMessage(
      SyncMessageType.DEVICE_REGISTER,
      {
        device: registered,
      } satisfies DeviceRegisterPayload,
      {
        priority: 'high',
        sourceDeviceId: registered.deviceId,
        token: registered.token,
      },
    ));
  }

  public async broadcastState(snapshot?: Partial<DeviceStateSnapshot>): Promise<void> {
    const localState = this.buildLocalSnapshot(snapshot);
    this.registry.updateLocalState(localState);

    await this.safeSend(createSyncMessage(
      SyncMessageType.STATE_SYNC,
      {
        source: this.registry.getLocalDevice(),
      } satisfies DeviceStatePayload,
      {
        sourceDeviceId: this.registry.getLocalDevice().deviceId,
        token: this.registry.getLocalDevice().token,
      },
    ));
  }

  public async requestState(targetDeviceId?: string): Promise<void> {
    const localDevice = this.registry.getLocalDevice();
    await this.safeSend(createSyncMessage(
      SyncMessageType.STATE_REQUEST,
      {
        requesterId: localDevice.deviceId,
        target: targetDeviceId,
      } satisfies StateRequestPayload,
      {
        priority: 'high',
        sourceDeviceId: localDevice.deviceId,
        targetDeviceId,
        token: localDevice.token,
      },
    ));
  }

  private async createSocket(url: string): Promise<void> {
    this.updateState(this.reconnectAttempts > 0 ? SyncConnectionState.RECONNECTING : SyncConnectionState.CONNECTING);

    await new Promise<void>((resolve, reject) => {
      const headers: Record<string, string> = {};
      const token = this.registry.getLocalDevice().token ?? this.connection.token;
      if (token) {
        headers.authorization = `Bearer ${token}`;
      }

      const socket = new WebSocket(url, { headers });
      this.socket = socket;

      socket.once('open', () => {
        this.reconnectAttempts = 0;
        this.updateState(SyncConnectionState.CONNECTED);
        this.startHeartbeat();
        void this.registerDevice();
        void this.requestState();
        resolve();
      });

      socket.once('error', (error) => {
        this.emit('error', error);
        log.error('[StateSyncManager] WebSocket error', error);

        if (this.state !== SyncConnectionState.CONNECTED) {
          reject(error);
        }
      });

      socket.on('close', (code, reason) => {
        log.warn(`[StateSyncManager] Connection closed (${code}): ${reason.toString() || 'no reason'}`);
        this.clearHeartbeatTimer();
        this.cleanupSocket();
        this.updateState(SyncConnectionState.DISCONNECTED);

        if (this.connection.reconnect) {
          this.scheduleReconnect();
        }
      });

      socket.on('message', (data) => {
        void this.handleIncomingData(data);
      });
    });
  }

  private async handleIncomingData(data: RawData): Promise<void> {
    const raw = typeof data === 'string' ? data : data.toString();

    let message: SyncMessage;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isSyncMessage(parsed)) {
        throw new Error('Invalid sync message');
      }
      message = parsed;
    } catch (error) {
      this.emit('error', error);
      log.warn('[StateSyncManager] Ignoring invalid sync payload');
      return;
    }

    this.emit('message', message);

    switch (message.type) {
      case SyncMessageType.DEVICE_REGISTER:
        this.handleDeviceRegister(message.payload as DeviceRegisterPayload);
        break;
      case SyncMessageType.DEVICE_LIST:
        this.handleDeviceList(message.payload as { devices: RegisteredDevice[] });
        break;
      case SyncMessageType.STATE_SYNC:
      case SyncMessageType.STATE_RESPONSE:
        this.handleStatePayload(message.payload as DeviceStatePayload);
        break;
      case SyncMessageType.STATE_REQUEST:
        await this.handleStateRequest(message.payload as StateRequestPayload, message.sourceDeviceId);
        break;
      case SyncMessageType.HEARTBEAT:
        this.handleHeartbeat(message.payload as { deviceId: string; sentAt: number });
        break;
      case SyncMessageType.DEVICE_UNREGISTER:
        if (message.sourceDeviceId) {
          this.registry.markRemoteInactive(message.sourceDeviceId);
          this.emit('deviceUnregistered', message.sourceDeviceId);
        }
        break;
      default:
        break;
    }
  }

  private handleDeviceRegister(payload: DeviceRegisterPayload): void {
    if (payload.device.deviceId === this.registry.getLocalDevice().deviceId) {
      if (payload.issuedToken) {
        this.registry.setLocalToken(payload.issuedToken);
      }
      return;
    }

    const remote = this.registry.registerRemoteDevice(payload.device);
    this.emit('deviceRegistered', remote);
  }

  private handleDeviceList(payload: { devices: RegisteredDevice[] }): void {
    for (const device of payload.devices) {
      if (device.deviceId !== this.registry.getLocalDevice().deviceId) {
        this.registry.registerRemoteDevice(device);
      }
    }

    this.emit('deviceList', this.registry.listRemoteDevices());
  }

  private handleStatePayload(payload: DeviceStatePayload): void {
    const remoteState = payload.source;
    if (remoteState.deviceId === this.registry.getLocalDevice().deviceId) {
      return;
    }

    const localState = this.buildLocalSnapshot();
    const result = resolveStateConflict(localState, remoteState);

    this.registry.updateRemoteState(remoteState);
    this.resolvedStates.set(remoteState.deviceId, {
      deviceId: remoteState.deviceId,
      resolvedAt: Date.now(),
      result,
    });

    this.emit('stateResolved', {
      deviceId: remoteState.deviceId,
      resolvedAt: Date.now(),
      result,
    } satisfies ResolvedStateRecord);
  }

  private async handleStateRequest(payload: StateRequestPayload, sourceDeviceId?: string): Promise<void> {
    if (payload.target && payload.target !== this.registry.getLocalDevice().deviceId) {
      return;
    }

    const localState = this.buildLocalSnapshot();
    this.registry.updateLocalState(localState);

    await this.safeSend(createSyncMessage(
      SyncMessageType.STATE_RESPONSE,
      {
        source: this.registry.getLocalDevice(),
        target: sourceDeviceId,
      } satisfies DeviceStatePayload,
      {
        priority: 'high',
        sourceDeviceId: this.registry.getLocalDevice().deviceId,
        targetDeviceId: sourceDeviceId,
        token: this.registry.getLocalDevice().token,
      },
    ));
  }

  private handleHeartbeat(payload: { deviceId: string; sentAt: number }): void {
    if (payload.deviceId !== this.registry.getLocalDevice().deviceId) {
      const device = this.registry.getRemoteDevice(payload.deviceId);
      if (device) {
        this.registry.registerRemoteDevice({
          ...device,
          lastSeen: payload.sentAt,
        });
      }
    }

    this.emit('heartbeat', payload);
  }

  private buildLocalSnapshot(overrides: Partial<DeviceStateSnapshot> = {}): DeviceStateSnapshot {
    const localDevice = this.registry.getLocalDevice();
    const partial = this.options.getLocalState();
    const now = Date.now();
    const nextCounter = (localDevice.vectorClock?.counter ?? 0) + 1;

    return {
      deviceId: localDevice.deviceId,
      deviceName: localDevice.deviceName,
      platform: localDevice.platform,
      state: partial.state ?? localDevice.state,
      lastSync: overrides.lastSync ?? partial.lastSync ?? now,
      batteryLevel: overrides.batteryLevel ?? partial.batteryLevel ?? localDevice.batteryLevel,
      isCharging: overrides.isCharging ?? partial.isCharging ?? localDevice.isCharging,
      metadata: {
        ...(localDevice.metadata ?? {}),
        ...(partial.metadata ?? {}),
        ...(overrides.metadata ?? {}),
      },
      vectorClock: {
        counter: nextCounter,
        updatedAt: now,
      },
    };
  }

  private startHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      const localDevice = this.registry.getLocalDevice();
      void this.safeSend(createSyncMessage(
        SyncMessageType.HEARTBEAT,
        {
          deviceId: localDevice.deviceId,
          sentAt: Date.now(),
        },
        {
          priority: 'low',
          sourceDeviceId: localDevice.deviceId,
          token: localDevice.token,
        },
      ));
    }, this.connection.heartbeat);
  }

  private scheduleReconnect(): void {
    if (!this.connection.reconnect || this.reconnectTimer || !this.connection.url) {
      return;
    }

    this.reconnectAttempts += 1;
    const base = this.options.reconnectBaseDelayMs ?? 1_000;
    const max = this.options.reconnectMaxDelayMs ?? 30_000;
    const delay = Math.min(base * (2 ** (this.reconnectAttempts - 1)), max);

    this.updateState(SyncConnectionState.RECONNECTING);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        this.emit('error', error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private updateState(nextState: SyncConnectionState): void {
    if (this.state === nextState) {
      return;
    }

    const previousState = this.state;
    this.state = nextState;
    this.emit('stateChange', nextState, previousState);
  }

  private async safeSend(message: SyncMessage): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.socket?.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }).catch((error) => {
      this.emit('error', error);
      log.error('[StateSyncManager] Failed to send sync message', error);
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
  }
}
