import type { RemoteAdapter, RemoteDevice, RemoteSession } from './adapters/RemoteAdapter';
import type { TaskEnvelope } from './contracts/TaskEnvelope';

export interface TaskRouteRecord {
  adapterName: string;
  deviceId?: string;
}

export interface TaskRoutingContext {
  adapters: ReadonlyMap<string, RemoteAdapter>;
  devices: RemoteDevice[];
  currentSession?: RemoteSession | null;
}

export interface ResolvedTaskRoute {
  adapter: RemoteAdapter;
  device: RemoteDevice;
  route: TaskRouteRecord;
}

export class TaskRouter {
  public isRoutableDevice(device: RemoteDevice): boolean {
    return device.status === 'online' || device.status === 'degraded';
  }

  public resolveAdapterForDevice(
    device: RemoteDevice,
    adapters: ReadonlyMap<string, RemoteAdapter>,
  ): RemoteAdapter {
    if (!device.adapter) {
      throw new Error(`Remote device ${device.id} is missing an adapter binding`);
    }

    const adapter = adapters.get(device.adapter);
    if (!adapter) {
      throw new Error(`Remote adapter ${device.adapter} is not registered`);
    }

    if (adapter.platform !== device.platform) {
      throw new Error(
        `Adapter ${device.adapter} platform mismatch for device ${device.id}: expected ${device.platform}, got ${adapter.platform}`,
      );
    }

    return adapter;
  }

  public resolve(task: TaskEnvelope, context: TaskRoutingContext): ResolvedTaskRoute {
    const explicitDeviceId = task.deviceId;
    if (explicitDeviceId) {
      const device = context.devices.find((candidate) => candidate.id === explicitDeviceId);
      if (!device) {
        throw new Error(`Remote device ${explicitDeviceId} is not available`);
      }

      const adapter = this.resolveAdapterForTask(device, task, context.adapters);
      return {
        adapter,
        device,
        route: this.createRouteRecord(adapter.name, device.id),
      };
    }

    const activeSessionDevice = context.currentSession?.status === 'active'
      ? context.currentSession.device
      : undefined;
    if (activeSessionDevice && this.isRoutableDevice(activeSessionDevice) && this.deviceMatchesTask(activeSessionDevice, task)) {
      try {
        const adapter = this.resolveAdapterForTask(activeSessionDevice, task, context.adapters);
        return {
          adapter,
          device: activeSessionDevice,
          route: this.createRouteRecord(adapter.name, activeSessionDevice.id),
        };
      } catch {
        // fall through to broader candidate routing
      }
    }

    const candidates = context.devices
      .filter((device) => this.isRoutableDevice(device))
      .filter((device) => this.deviceMatchesTask(device, task))
      .sort((left, right) => this.scoreDevice(right) - this.scoreDevice(left));

    for (const device of candidates) {
      try {
        const adapter = this.resolveAdapterForTask(device, task, context.adapters);
        return {
          adapter,
          device,
          route: this.createRouteRecord(adapter.name, device.id),
        };
      } catch {
        continue;
      }
    }

    throw new Error(`No remote device can satisfy task ${task.id}`);
  }

  public createRouteRecord(adapterName: string, deviceId?: string): TaskRouteRecord {
    return {
      adapterName,
      deviceId,
    };
  }

  private resolveAdapterForTask(
    device: RemoteDevice,
    task: TaskEnvelope,
    adapters: ReadonlyMap<string, RemoteAdapter>,
  ): RemoteAdapter {
    const adapter = this.resolveAdapterForDevice(device, adapters);
    if (adapter.supports && !adapter.supports(device, task)) {
      throw new Error(`Adapter ${adapter.name} cannot satisfy task ${task.id}`);
    }

    return adapter;
  }

  private deviceMatchesTask(device: RemoteDevice, task: TaskEnvelope): boolean {
    if (device.platform !== task.target) {
      return false;
    }

    const requiredCapabilities = task.constraints?.requiredCapabilities;
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      return true;
    }

    return requiredCapabilities.every((capability) => device.capabilities.includes(capability));
  }

  private scoreDevice(device: RemoteDevice): number {
    switch (device.status) {
      case 'online':
        return 3;
      case 'degraded':
        return 2;
      case 'blocked':
        return 1;
      default:
        return 0;
    }
  }
}

export default TaskRouter;
