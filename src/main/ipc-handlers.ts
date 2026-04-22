import { ipcMain } from 'electron';
import type DatabaseManager from '../database/DatabaseManager';
import type { LearningEngine } from '../learning/LearningEngine';
import type { PerceptionModule } from '../perception/PerceptionModule';
import type { SecurityGuard } from '../security/SecurityGuard';
import type { StateEngine } from '../state/StateEngine';
import type { DeviceRegistry, StateSyncManager } from '../sync';
import type { ExecutionModule, MCPHandler, ConfigStore } from '../mcp';

export class DatabaseConfigStore implements ConfigStore {
  constructor(private readonly db: DatabaseManager) {}

  public get(key: string): unknown {
    const entry = this.db.getUserConfig(key);

    if (!entry) {
      return undefined;
    }

    return this.deserialize(entry.value, entry.value_type ?? 'string');
  }

  public set(key: string, value: unknown): void {
    const serialized = this.serialize(value);
    const existing = this.db.getUserConfig(key);

    if (existing) {
      this.db.updateUserConfig(key, serialized.value, serialized.type);
      return;
    }

    this.db.createUserConfig({
      key,
      value: serialized.value,
      value_type: serialized.type,
    });
  }

  private serialize(value: unknown): { value: string; type: string } {
    if (value === null) {
      return { value: 'null', type: 'null' };
    }

    switch (typeof value) {
      case 'boolean':
        return { value: String(value), type: 'boolean' };
      case 'number':
        return { value: String(value), type: 'number' };
      case 'string':
        return { value, type: 'string' };
      default:
        return {
          value: JSON.stringify(value),
          type: Array.isArray(value) ? 'array' : 'object',
        };
    }
  }

  private deserialize(value: string, type: string): unknown {
    switch (type) {
      case 'boolean':
        return value === 'true';
      case 'number':
        return Number(value);
      case 'null':
        return null;
      case 'array':
      case 'object':
        return JSON.parse(value);
      case 'string':
      default:
        return value;
    }
  }
}

export function setupIpcHandlers(
  perception: PerceptionModule,
  execution: ExecutionModule,
  state: StateEngine,
  learning: LearningEngine,
  mcp: MCPHandler,
  security: SecurityGuard,
  config: ConfigStore,
  sync: StateSyncManager,
  deviceRegistry: DeviceRegistry,
): void {
  const handle = <TArgs extends unknown[], TResult>(
    channel: string,
    listener: (_event: Electron.IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult,
  ): void => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  handle('perception:captureScreen', async () => {
    const data = await perception.captureBase64OnDemand(undefined, 'png');
    return {
      data,
      format: 'png',
      capturedAt: Date.now(),
    };
  });
  handle('perception:getWindows', async () => perception.getWindows());
  handle('perception:getRunningApps', async () => perception.getRunningApps());
  handle('perception:getClipboard', async () => perception.getClipboard());

  handle('execution:click', async (_event, x: number, y: number, button?: string) => execution.click(x, y, button as 'left' | 'middle' | 'right' | undefined));
  handle('execution:typeText', async (_event, text: string) => execution.typeText(text));
  handle('execution:pressKey', async (_event, key: string) => execution.pressKey(key));
  handle('execution:hotkey', async (_event, keys: string[]) => execution.hotkey(...keys));
  handle('execution:openApp', async (_event, bundleId: string) => execution.openApp(bundleId));
  handle('execution:closeApp', async (_event, bundleId: string) => execution.closeApp(bundleId));

  handle('state:getCurrent', async () => state.getCurrentState());

  handle('learning:getProfile', async () => learning.getUserProfile());
  handle('learning:getPatterns', async () => learning.getPatterns());
  handle('learning:setFeedback', async (_event, predictionId: string, correct: boolean) => {
    await learning.recordFeedback(
      'prediction_feedback',
      predictionId,
      correct ? predictionId : 'manual_override',
      JSON.stringify({ predictionId }),
      correct ? 'accept' : 'reject',
    );

    return {
      accepted: true,
      predictionId,
      correct,
      timestamp: Date.now(),
    };
  });

  handle('config:get', async (_event, key: string) => config.get(key));
  handle('config:set', async (_event, key: string, value: unknown) => {
    await config.set(key, value);
    return { key, value, updatedAt: Date.now() };
  });

  handle('security:check', async (_event, operation: string, source: string) => security.checkOperation(operation, source));

  handle('mcp:connect', async (_event, url: string) => mcp.connect(url));
  handle('mcp:disconnect', async () => {
    await mcp.disconnect();
    return { disconnected: true };
  });
  handle('mcp:send', async (_event, message: unknown) => {
    if (typeof message === 'string') {
      await mcp.send(message);
    } else {
      await mcp.send(message as never);
    }

    return { sent: true, timestamp: Date.now() };
  });

  handle('sync:getDevices', async () => deviceRegistry.listDevices());
  handle('sync:getStatus', async () => ({
    connectionState: sync.getConnectionState(),
    devices: deviceRegistry.listDevices(),
  }));
  handle('sync:connect', async (_event, url?: string) => sync.connect(url ? { url } : {}));
  handle('sync:disconnect', async () => {
    await sync.disconnect();
    return { disconnected: true };
  });
  handle('sync:broadcastState', async () => {
    await sync.broadcastState();
    return { broadcasted: true, timestamp: Date.now() };
  });
}
