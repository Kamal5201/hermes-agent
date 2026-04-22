import { app } from 'electron';
import { getAppCoordinator, AppCoordinator } from './AppCoordinator';
import { HealthMonitor, type SystemHealth, type HealthStatus, type HealthAlert, type SystemMetrics, type HealthMonitorConfig, type HealthThresholds } from './HealthMonitor.js';
import { getLogger } from './logger';

const coordinator = getAppCoordinator();
const logger = getLogger('Main');
const healthMonitor = HealthMonitor.getInstance();

let healthMonitorBound = false;
let healthMonitorStarted = false;
let isQuitting = false;

async function bootstrap(): Promise<void> {
  bindHealthMonitor();
  await coordinator.bootstrap();

  if (!healthMonitorStarted) {
    healthMonitor.start();
    healthMonitorStarted = true;
  }

  const currentHealth = healthMonitor.getCurrentHealth();
  if (currentHealth) {
    await persistSystemHealth(currentHealth);
  }
}

function bindHealthMonitor(): void {
  if (healthMonitorBound) {
    return;
  }

  healthMonitor.on('healthCheck', (health: SystemHealth) => {
    void persistSystemHealth(health);
  });

  healthMonitor.on('alert', (alert: HealthAlert) => {
    logger.warn(`Health alert: ${alert.component} - ${alert.message}`);
  });

  healthMonitorBound = true;
}

async function persistSystemHealth(health: SystemHealth): Promise<void> {
  const services = coordinator.getServices();

  if (!services) {
    return;
  }

  try {
    await Promise.resolve(services.config.set('system_health', health));
  } catch (error) {
    logger.warn('Failed to persist system health', error);
  }
}

async function ensureMainWindow(): Promise<void> {
  await coordinator.ensureMainWindow();
}

async function shutdown(): Promise<void> {
  if (healthMonitorStarted) {
    healthMonitor.stop();
    healthMonitorStarted = false;
  }

  await coordinator.shutdown();
}

function setupAppLifecycle(): void {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    void ensureMainWindow();
  });

  app.on('before-quit', () => {
    if (isQuitting) {
      return;
    }

    isQuitting = true;
    void shutdown();
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  setupAppLifecycle();

  app.on('second-instance', () => {
    void ensureMainWindow();
  });

  app.whenReady().then(() => {
    void bootstrap();
  }).catch((error) => {
    logger.error('Application bootstrap failed', error);
    void shutdown().finally(() => app.quit());
  });
}

export const envConfig = coordinator.getConfig();

export function activateCompanion(reason: string): void {
  coordinator.activateCompanion(reason);
}

export function getMainWindow() {
  return coordinator.getMainWindow();
}

export { AppCoordinator, getAppCoordinator } from './AppCoordinator';
export { HealthMonitor } from './HealthMonitor.js';
export type { HealthStatus, SystemHealth, HealthAlert, SystemMetrics, HealthMonitorConfig, HealthThresholds } from './HealthMonitor.js';
