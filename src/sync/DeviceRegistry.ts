import { randomUUID } from 'crypto';
import {
  type DevicePlatform,
  type DeviceStateSnapshot,
  type RegisteredDevice,
  normalizePlatform,
} from './Protocol';

export interface SyncKeyValueStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface DeviceRegistryOptions {
  deviceName?: string;
  platform?: DevicePlatform | string;
  capabilities?: string[];
}

const LOCAL_DEVICE_KEY = 'sync.localDevice';
const REMOTE_DEVICES_KEY = 'sync.remoteDevices';

export class DeviceRegistry {
  private localDevice: RegisteredDevice;
  private readonly remoteDevices = new Map<string, RegisteredDevice>();

  constructor(
    private readonly store: SyncKeyValueStore,
    options: DeviceRegistryOptions = {},
  ) {
    this.localDevice = this.loadOrCreateLocalDevice(options);
    this.loadRemoteDevices();
  }

  public getLocalDevice(): RegisteredDevice {
    return {
      ...this.localDevice,
      capabilities: [...this.localDevice.capabilities],
      metadata: this.localDevice.metadata ? { ...this.localDevice.metadata } : undefined,
      vectorClock: this.localDevice.vectorClock ? { ...this.localDevice.vectorClock } : undefined,
    };
  }

  public ensureLocalDevice(overrides: Partial<RegisteredDevice> = {}): RegisteredDevice {
    const now = Date.now();
    this.localDevice = {
      ...this.localDevice,
      ...overrides,
      lastSeen: overrides.lastSeen ?? now,
      lastSync: overrides.lastSync ?? this.localDevice.lastSync,
      capabilities: overrides.capabilities ?? this.localDevice.capabilities,
      metadata: overrides.metadata ?? this.localDevice.metadata,
      vectorClock: overrides.vectorClock ?? this.localDevice.vectorClock,
    };

    this.persistLocalDevice();
    return this.getLocalDevice();
  }

  public updateLocalState(state: Partial<DeviceStateSnapshot>): RegisteredDevice {
    const nextCounter = (this.localDevice.vectorClock?.counter ?? 0) + 1;
    const now = Date.now();

    return this.ensureLocalDevice({
      ...state,
      lastSeen: now,
      lastSync: state.lastSync ?? now,
      vectorClock: {
        counter: nextCounter,
        updatedAt: now,
      },
    });
  }

  public setLocalToken(token: string): RegisteredDevice {
    return this.ensureLocalDevice({ token });
  }

  public registerRemoteDevice(device: RegisteredDevice | DeviceStateSnapshot): RegisteredDevice {
    const existing = this.remoteDevices.get(device.deviceId);
    const now = Date.now();

    const normalized: RegisteredDevice = {
      ...existing,
      registeredAt: existing?.registeredAt ?? now,
      token: existing?.token,
      ...device,
      lastSeen: now,
      status: 'active',
      capabilities: Array.isArray((device as Partial<RegisteredDevice>).capabilities)
        ? [...((device as Partial<RegisteredDevice>).capabilities ?? [])]
        : [...(existing?.capabilities ?? [])],
      metadata: device.metadata ? { ...device.metadata } : existing?.metadata,
      vectorClock: device.vectorClock ? { ...device.vectorClock } : existing?.vectorClock,
    };

    this.remoteDevices.set(normalized.deviceId, normalized);
    this.persistRemoteDevices();
    return this.cloneDevice(normalized);
  }

  public updateRemoteState(state: DeviceStateSnapshot): RegisteredDevice {
    return this.registerRemoteDevice(state);
  }

  public removeRemoteDevice(deviceId: string): boolean {
    const deleted = this.remoteDevices.delete(deviceId);
    if (deleted) {
      this.persistRemoteDevices();
    }
    return deleted;
  }

  public markRemoteInactive(deviceId: string): void {
    const device = this.remoteDevices.get(deviceId);
    if (!device) {
      return;
    }

    device.status = 'inactive';
    device.lastSeen = Date.now();
    this.persistRemoteDevices();
  }

  public getRemoteDevice(deviceId: string): RegisteredDevice | undefined {
    const device = this.remoteDevices.get(deviceId);
    return device ? this.cloneDevice(device) : undefined;
  }

  public listRemoteDevices(): RegisteredDevice[] {
    return Array.from(this.remoteDevices.values()).map((device) => this.cloneDevice(device));
  }

  public listDevices(includeLocal = true): RegisteredDevice[] {
    const devices = this.listRemoteDevices();
    if (includeLocal) {
      devices.unshift(this.getLocalDevice());
    }
    return devices;
  }

  private loadOrCreateLocalDevice(options: DeviceRegistryOptions): RegisteredDevice {
    const stored = this.store.get(LOCAL_DEVICE_KEY);
    if (this.isRegisteredDevice(stored)) {
      return {
        ...stored,
        capabilities: Array.isArray(stored.capabilities) ? [...stored.capabilities] : [],
      };
    }

    const now = Date.now();
    const localDevice: RegisteredDevice = {
      deviceId: randomUUID(),
      deviceName: options.deviceName ?? `Hermes-${process.platform}`,
      platform: normalizePlatform(typeof options.platform === 'string' ? options.platform : process.platform),
      state: 'STEALTH',
      lastSync: now,
      registeredAt: now,
      lastSeen: now,
      status: 'active',
      capabilities: options.capabilities ?? ['state_sync', 'conflict_resolution'],
      vectorClock: {
        counter: 0,
        updatedAt: now,
      },
    };

    this.localDevice = localDevice;
    this.persistLocalDevice();
    return localDevice;
  }

  private loadRemoteDevices(): void {
    const stored = this.store.get(REMOTE_DEVICES_KEY);
    if (!Array.isArray(stored)) {
      return;
    }

    for (const device of stored) {
      if (this.isRegisteredDevice(device)) {
        this.remoteDevices.set(device.deviceId, {
          ...device,
          capabilities: [...device.capabilities],
        });
      }
    }
  }

  private persistLocalDevice(): void {
    this.store.set(LOCAL_DEVICE_KEY, this.localDevice);
  }

  private persistRemoteDevices(): void {
    this.store.set(REMOTE_DEVICES_KEY, this.listRemoteDevices());
  }

  private isRegisteredDevice(value: unknown): value is RegisteredDevice {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<RegisteredDevice>;
    return (
      typeof candidate.deviceId === 'string'
      && typeof candidate.deviceName === 'string'
      && typeof candidate.platform === 'string'
      && typeof candidate.state === 'string'
      && typeof candidate.lastSync === 'number'
      && typeof candidate.registeredAt === 'number'
      && typeof candidate.lastSeen === 'number'
      && typeof candidate.status === 'string'
      && Array.isArray(candidate.capabilities)
    );
  }

  private cloneDevice(device: RegisteredDevice): RegisteredDevice {
    return {
      ...device,
      capabilities: [...device.capabilities],
      metadata: device.metadata ? { ...device.metadata } : undefined,
      vectorClock: device.vectorClock ? { ...device.vectorClock } : undefined,
    };
  }
}
