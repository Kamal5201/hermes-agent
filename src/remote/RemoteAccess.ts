/**
 * Remote Access - 远程控制模块
 *
 * Task 1: refactor the old mock discovery layer into an adapter registry that
 * can route Windows takeover work toward platform-specific backends.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import log from 'electron-log/main.js';
import type { RemoteAdapter, RemoteDevice, RemoteSession } from './adapters/RemoteAdapter';
import { WindowsMcpAdapter, type WindowsMcpAdapterOptions } from './adapters/WindowsMcpAdapter';
import { CheckpointStore } from './CheckpointStore';
import { isTerminalTaskStatus, type TaskArtifacts, type TaskEnvelope } from './contracts/TaskEnvelope';
import type { TaskResult } from './contracts/TaskResult';
import { ACTIVE_RECOVERABLE_TASK_STATUSES, TaskPolicy, type TaskDispatchMode } from './TaskPolicy';
import { TaskQueue } from './TaskQueue';
import { TaskRouter, type ResolvedTaskRoute, type TaskRouteRecord } from './TaskRouter';

export interface RemoteProbeFilters {
  platform?: RemoteDevice['platform'];
  capabilities?: string[];
}

export interface RemoteAccessOptions {
  adapters?: RemoteAdapter[];
  registerDefaultAdapters?: boolean;
  windowsMcpAdapter?: WindowsMcpAdapterOptions;
}

const TASK_POLL_INTERVAL_MS = 500;

export class RemoteAccess extends EventEmitter {
  private readonly adapters = new Map<string, RemoteAdapter>();
  private readonly devices = new Map<string, RemoteDevice>();
  private readonly sessions = new Map<string, RemoteSession>();
  private readonly tasks = new Map<string, TaskEnvelope>();
  private readonly taskRoutes = new Map<string, TaskRouteRecord>();
  private readonly checkpointStore = new CheckpointStore();
  private readonly taskPolicy = new TaskPolicy();
  private readonly taskQueue = new TaskQueue();
  private readonly taskRouter = new TaskRouter();
  private currentSession: RemoteSession | null = null;
  private taskPumpTimer: NodeJS.Timeout | null = null;
  private taskPumpRunning = false;

  constructor(options: RemoteAccessOptions = {}) {
    super();

    const shouldRegisterDefaultAdapters = options.registerDefaultAdapters
      ?? ((options.adapters?.length ?? 0) === 0);

    if (shouldRegisterDefaultAdapters) {
      this.registerAdapter(new WindowsMcpAdapter(options.windowsMcpAdapter));
    }

    for (const adapter of options.adapters ?? []) {
      this.registerAdapter(adapter);
    }
  }

  public registerAdapter(adapter: RemoteAdapter): void {
    if (this.adapters.has(adapter.name)) {
      this.clearAdapterState(adapter.name);
      log.warn(`[RemoteAccess] Replacing adapter registration: ${adapter.name}`);
    }

    this.adapters.set(adapter.name, adapter);
    log.info(`[RemoteAccess] Registered adapter: ${adapter.name} (${adapter.platform})`);
    this.emit('adapterRegistered', adapter.name);
  }

  public unregisterAdapter(adapterName: string): boolean {
    const removed = this.adapters.delete(adapterName);
    if (removed) {
      this.clearAdapterState(adapterName);

      log.info(`[RemoteAccess] Unregistered adapter: ${adapterName}`);
      this.emit('adapterUnregistered', adapterName);
    }

    return removed;
  }

  public listAdapters(): string[] {
    return Array.from(this.adapters.keys());
  }

  public async probe(filters: RemoteProbeFilters = {}): Promise<RemoteDevice[]> {
    if (this.adapters.size === 0) {
      log.warn('[RemoteAccess] probe requested with no registered adapters');
      return [];
    }

    const discoveredDevices: RemoteDevice[] = [];

    for (const adapter of this.adapters.values()) {
      if (filters.platform && adapter.platform !== filters.platform) {
        continue;
      }

      try {
        const probeResult = await adapter.probe();
        this.mergeProbeDevices(adapter.name, probeResult.devices);

        for (const device of probeResult.devices) {
          const normalized = this.cloneDevice({
            ...device,
            adapter: device.adapter || adapter.name,
          });

          if (this.matchesFilters(normalized, filters)) {
            discoveredDevices.push(normalized);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`[RemoteAccess] Probe failed for adapter ${adapter.name}: ${message}`);
        this.emit('probeFailed', {
          adapter: adapter.name,
          error: message,
        });
      }
    }

    this.emit('devicesDiscovered', discoveredDevices);
    return discoveredDevices;
  }

  /**
   * Backward-compatible alias for older call sites that still use discoverDevices.
   */
  public async discoverDevices(filters: RemoteProbeFilters = {}): Promise<RemoteDevice[]> {
    return this.probe(filters);
  }

  public async connect(deviceId: string): Promise<RemoteSession> {
    let device = this.devices.get(deviceId);
    if (!device) {
      await this.probe();
      device = this.devices.get(deviceId);
    }

    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    if (!this.taskRouter.isRoutableDevice(device)) {
      throw new Error(`Device is not routable: ${deviceId}`);
    }

    const adapter = this.taskRouter.resolveAdapterForDevice(device, this.adapters);
    const session = await adapter.connect(deviceId);
    const normalizedSessionDevice = this.cloneDevice({
      ...(session.device ?? device),
      adapter: session.device?.adapter || session.adapter || adapter.name,
    });
    const normalizedSession = this.cloneSession({
      ...session,
      adapter: session.adapter || adapter.name,
      device: normalizedSessionDevice,
    });

    this.devices.set(normalizedSession.device.id, this.cloneDevice(normalizedSession.device));
    this.sessions.set(normalizedSession.id, normalizedSession);
    this.currentSession = normalizedSession;

    log.info(`[RemoteAccess] Connected to ${normalizedSession.device.name} via ${normalizedSession.adapter}`);
    this.emit('connected', normalizedSession);

    return this.cloneSession(normalizedSession);
  }

  public async submitTask(task: TaskEnvelope): Promise<{ taskId: string }> {
    await this.ensureTaskRoutingContext(task);

    const resolvedRoute = this.resolveTaskRoute(task);
    const now = Date.now();
    const archive = this.checkpointStore.getTaskArchive(task.id);
    const normalizedTask = this.taskPolicy.decorateNewTask(this.cloneTask({
      ...task,
      deviceId: resolvedRoute.device.id,
      adapter: resolvedRoute.adapter.name,
      updatedAt: now,
    }), archive, now);

    const storedTask = this.cacheTask(normalizedTask, resolvedRoute.route);
    this.taskQueue.enqueue(storedTask, {
      availableAt: now,
      route: resolvedRoute.route,
      dispatchMode: 'initial',
    });

    await this.persistLocalTaskState(storedTask, 'task_created', {
      adapter: resolvedRoute.adapter.name,
      deviceId: resolvedRoute.device.id,
      archivePath: archive.rootRelative,
      taskFile: archive.taskFileRelative,
      resultFile: archive.resultFileRelative,
      checkpointsFile: archive.checkpointsFileRelative,
    });

    log.info(`[RemoteAccess] Queued task ${storedTask.id} for ${resolvedRoute.adapter.name} (${resolvedRoute.device.id})`);
    this.emit('taskQueued', {
      taskId: storedTask.id,
      deviceId: resolvedRoute.device.id,
      adapter: resolvedRoute.adapter.name,
      archivePath: archive.rootRelative,
    });

    await this.runTaskPump();
    return { taskId: storedTask.id };
  }

  public async getTask(taskId: string): Promise<TaskEnvelope | null> {
    await this.runTaskPump();

    const route = this.taskRoutes.get(taskId) ?? this.restoreTaskRouteFromCache(taskId);
    if (route) {
      const liveTask = await this.fetchTaskFromRoute(taskId, route);
      if (liveTask) {
        return this.cloneTask(liveTask);
      }
    }

    if (!route) {
      for (const adapter of this.adapters.values()) {
        try {
          const task = await adapter.getTask(taskId);
          if (!task) {
            continue;
          }

          const observedTask = await this.observeAdapterTask(taskId, task, adapter.name, task.deviceId);
          return this.cloneTask(observedTask);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(`[RemoteAccess] getTask fallback scan failed for adapter ${adapter.name} (${taskId}): ${message}`);
        }
      }
    }

    const cachedTask = this.tasks.get(taskId) ?? await this.loadPersistedTask(taskId);
    return cachedTask ? this.cloneTask(cachedTask) : null;
  }

  public async writeTaskCheckpoint(
    taskId: string,
    checkpoint: Record<string, unknown>,
    options: {
      status?: TaskEnvelope['status'];
      reason?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<TaskEnvelope> {
    const task = await this.getKnownTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const updatedTask = this.cacheTask(this.cloneTask({
      ...task,
      checkpoint: {
        ...(task.checkpoint ?? {}),
        ...checkpoint,
      },
      status: options.status ?? task.status,
      updatedAt: Date.now(),
      metadata: options.metadata
        ? {
            ...(task.metadata ?? {}),
            ...options.metadata,
          }
        : task.metadata,
    }), this.taskRoutes.get(task.id) ?? this.restoreTaskRouteFromCache(task.id) ?? undefined);

    this.taskQueue.noteObservation(updatedTask);
    await this.persistLocalTaskState(updatedTask, options.reason ?? 'checkpoint_write', options.metadata);
    await this.reconcileTaskState(updatedTask, true, 'local');
    this.emit('taskCheckpoint', {
      taskId: updatedTask.id,
      status: updatedTask.status,
      reason: options.reason ?? 'checkpoint_write',
    });

    await this.runTaskPump();
    return this.cloneTask(updatedTask);
  }

  public async resumeTask(
    taskId: string,
    checkpointPatch?: Record<string, unknown>,
  ): Promise<{ taskId: string }> {
    const task = await this.getKnownTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (!this.taskPolicy.isResumeEligible(task)) {
      throw new Error(`Task ${taskId} cannot be resumed from status ${task.status}`);
    }

    const queueEntry = this.taskQueue.get(taskId);
    if (queueEntry?.state === 'inflight') {
      throw new Error(`Task ${taskId} is already active and cannot be resumed`);
    }

    const route = await this.resolveOrRestoreTaskRoute(task);
    const resumedTask = this.taskPolicy.prepareForResume(task, checkpointPatch, Date.now());
    const storedTask = this.cacheTask(resumedTask, route);
    this.taskQueue.enqueue(storedTask, {
      availableAt: Date.now(),
      route,
      dispatchMode: 'resume',
    });

    await this.persistLocalTaskState(storedTask, 'resume_requested', {
      adapter: route.adapterName,
      deviceId: route.deviceId,
    });

    this.emit('taskResumed', {
      taskId: storedTask.id,
      adapter: route.adapterName,
      deviceId: route.deviceId,
    });

    await this.runTaskPump();
    return { taskId: storedTask.id };
  }

  public async cancelTask(taskId: string): Promise<void> {
    const cachedTask = await this.getKnownTask(taskId);
    if (!cachedTask) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const route = this.taskRoutes.get(taskId) ?? this.restoreTaskRouteFromCache(taskId);
    if (route?.adapterName) {
      const adapter = this.adapters.get(route.adapterName);
      if (!adapter) {
        throw new Error(`Adapter not found for task ${taskId}: ${route.adapterName}`);
      }

      await adapter.cancelTask(taskId);
    }

    const cancelledTask = this.cacheTask(this.cloneTask({
      ...cachedTask,
      status: 'cancelled',
      updatedAt: Date.now(),
    }), route ?? undefined);

    this.taskQueue.remove(taskId);
    this.taskQueue.noteObservation(cancelledTask);
    await this.persistLocalTaskState(cancelledTask, 'task_cancelled', {
      adapter: route?.adapterName,
      deviceId: route?.deviceId,
    });

    log.info(`[RemoteAccess] Cancelled task ${taskId}`);
    this.emit('taskCancelled', {
      taskId,
      adapter: route?.adapterName,
    });
  }

  /**
   * Legacy shim: convert a direct command into a routed task.
   */
  public async sendCommand(command: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    if (this.currentSession.device.platform !== 'windows') {
      throw new Error(`Legacy command bridge only supports windows tasks, got ${this.currentSession.device.platform}`);
    }

    const submitted = await this.submitTask({
      id: randomUUID(),
      kind: 'desktop',
      target: 'windows',
      intent: command,
      priority: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'queued',
      deviceId: this.currentSession.device.id,
      input: {
        params,
      },
      metadata: {
        source: 'legacy-sendCommand',
      },
    });

    const task = await this.getTask(submitted.taskId);
    const status = task?.status ?? 'queued';
    return {
      success: status === 'completed',
      accepted: Boolean(task),
      taskId: submitted.taskId,
      status,
      terminal: isTerminalTaskStatus(status),
      lastError: task?.lastError,
      result: this.describeLegacyCommandResult(command, status, task?.lastError),
    };
  }

  public disconnect(): void {
    if (!this.currentSession) {
      return;
    }

    const endedSession = this.cloneSession({
      ...this.currentSession,
      status: 'ended',
    });

    this.sessions.set(endedSession.id, endedSession);
    this.currentSession = null;
    this.emit('disconnected', endedSession);
  }

  public getDevices(): RemoteDevice[] {
    return Array.from(this.devices.values()).map((device) => this.cloneDevice(device));
  }

  public getCurrentSession(): RemoteSession | null {
    return this.currentSession ? this.cloneSession(this.currentSession) : null;
  }

  private mergeProbeDevices(adapterName: string, devices: RemoteDevice[]): void {
    for (const [deviceId, device] of this.devices.entries()) {
      if (device.adapter === adapterName) {
        this.devices.delete(deviceId);
      }
    }

    for (const device of devices) {
      this.devices.set(device.id, this.cloneDevice({
        ...device,
        adapter: device.adapter || adapterName,
      }));
    }

    this.reconcileSessionsForAdapter(adapterName);
  }

  private matchesFilters(device: RemoteDevice, filters: RemoteProbeFilters): boolean {
    if (filters.platform && device.platform !== filters.platform) {
      return false;
    }

    const requiredCapabilities = filters.capabilities ?? [];
    return requiredCapabilities.every((capability) => device.capabilities.includes(capability));
  }

  private async ensureTaskRoutingContext(task: TaskEnvelope): Promise<void> {
    const explicitDeviceId = task.deviceId;
    if (explicitDeviceId) {
      if (!this.devices.has(explicitDeviceId)) {
        await this.probe({ platform: task.target });
      }
      return;
    }

    const hasCachedTargetDevice = Array.from(this.devices.values())
      .some((device) => device.platform === task.target);

    if (!hasCachedTargetDevice) {
      await this.probe({ platform: task.target });
    }
  }

  private resolveTaskRoute(task: TaskEnvelope): ResolvedTaskRoute {
    return this.taskRouter.resolve(task, {
      adapters: this.adapters,
      devices: this.getDevices(),
      currentSession: this.currentSession,
    });
  }

  private async resolveOrRestoreTaskRoute(task: TaskEnvelope): Promise<TaskRouteRecord> {
    const cachedRoute = this.taskRoutes.get(task.id) ?? this.restoreTaskRouteFromCache(task.id);
    if (cachedRoute) {
      return cachedRoute;
    }

    await this.ensureTaskRoutingContext(task);
    const resolvedRoute = this.resolveTaskRoute(task);
    this.taskRoutes.set(task.id, resolvedRoute.route);
    return resolvedRoute.route;
  }

  private clearAdapterState(adapterName: string): void {
    for (const [deviceId, device] of this.devices.entries()) {
      if (device.adapter === adapterName) {
        this.devices.delete(deviceId);
      }
    }

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.adapter === adapterName) {
        this.sessions.delete(sessionId);
      }
    }

    for (const [taskId, task] of this.tasks.entries()) {
      if (task.adapter === adapterName) {
        this.tasks.delete(taskId);
        this.taskQueue.remove(taskId);
      }
    }

    for (const [taskId, route] of this.taskRoutes.entries()) {
      if (route.adapterName === adapterName) {
        this.taskRoutes.delete(taskId);
      }
    }

    if (this.currentSession?.adapter === adapterName) {
      this.currentSession = null;
    }

    this.scheduleTaskPump();
  }

  private reconcileSessionsForAdapter(adapterName: string): void {
    const adapterDevices = new Map<string, RemoteDevice>();
    for (const device of this.devices.values()) {
      if (device.adapter === adapterName) {
        adapterDevices.set(device.id, this.cloneDevice(device));
      }
    }

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.adapter !== adapterName) {
        continue;
      }

      const liveDevice = adapterDevices.get(session.device.id);
      if (!liveDevice) {
        if (session.status === 'active') {
          const endedSession = this.cloneSession({
            ...session,
            status: 'ended',
          });
          this.sessions.set(sessionId, endedSession);
          if (this.currentSession?.id === sessionId) {
            this.currentSession = null;
          }
        }
        continue;
      }

      const updatedSession = this.cloneSession({
        ...session,
        device: liveDevice,
      });

      this.sessions.set(sessionId, updatedSession);
      if (this.currentSession?.id === sessionId) {
        this.currentSession = updatedSession;
      }
    }
  }

  private restoreTaskRouteFromCache(taskId: string): TaskRouteRecord | null {
    const cachedTask = this.tasks.get(taskId);
    if (!cachedTask?.adapter) {
      return null;
    }

    const route: TaskRouteRecord = {
      adapterName: cachedTask.adapter,
      deviceId: cachedTask.deviceId,
    };

    this.taskRoutes.set(taskId, route);
    return route;
  }

  private async fetchTaskFromRoute(taskId: string, route: TaskRouteRecord): Promise<TaskEnvelope | null> {
    const adapter = this.adapters.get(route.adapterName);
    if (!adapter) {
      this.taskRoutes.delete(taskId);
      return null;
    }

    try {
      const task = await adapter.getTask(taskId);
      if (!task) {
        const archivedTask = await this.loadPersistedTask(taskId);
        if (archivedTask) {
          this.restoreQueueEntryFromTask(archivedTask, route);
          if (this.taskPolicy.isResumeEligible(archivedTask)) {
            this.emitTaskAwaitingResume(archivedTask, route);
          }
        }
        return archivedTask;
      }

      return this.observeAdapterTask(taskId, task, adapter.name, route.deviceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[RemoteAccess] getTask failed for adapter ${adapter.name} (${taskId}): ${message}`);
      return this.tasks.get(taskId) ?? null;
    }
  }

  private async observeAdapterTask(
    requestedTaskId: string,
    task: TaskEnvelope,
    adapterName: string,
    fallbackDeviceId?: string,
  ): Promise<TaskEnvelope> {
    const existingTask = this.tasks.get(task.id) ?? this.tasks.get(requestedTaskId);
    const queueEntry = this.taskQueue.get(task.id) ?? this.taskQueue.get(requestedTaskId);
    if (
      existingTask
      && queueEntry
      && queueEntry.state !== 'inflight'
      && existingTask.updatedAt > task.updatedAt
    ) {
      return this.cloneTask(existingTask);
    }

    const normalizedTask = this.storeResolvedTask(requestedTaskId, task, adapterName, fallbackDeviceId);
    const changed = this.taskQueue.noteObservation(normalizedTask);

    if (changed) {
      await this.persistLocalTaskState(normalizedTask, 'status_update', {
        adapter: adapterName,
        deviceId: normalizedTask.deviceId ?? fallbackDeviceId,
      });
      this.emit('taskUpdated', {
        taskId: normalizedTask.id,
        status: normalizedTask.status,
        adapter: adapterName,
        deviceId: normalizedTask.deviceId ?? fallbackDeviceId,
      });
    }

    await this.reconcileTaskState(normalizedTask, changed, 'adapter');
    return this.cloneTask(this.tasks.get(normalizedTask.id) ?? normalizedTask);
  }

  private async reconcileTaskState(
    task: TaskEnvelope,
    changed: boolean,
    source: 'adapter' | 'local',
  ): Promise<void> {
    switch (task.status) {
      case 'failed_retryable': {
        if (!changed) {
          return;
        }

        const retryPlan = this.taskPolicy.scheduleAutoRetry(task, Date.now());
        if (!retryPlan) {
          const exhaustedTask = this.cacheTask(this.taskPolicy.markRetryBudgetExhausted(task, Date.now()), this.taskRoutes.get(task.id) ?? undefined);
          this.taskQueue.pause(exhaustedTask.id);
          await this.persistLocalTaskState(exhaustedTask, 'retry_budget_exhausted');
          this.emit('taskAwaitingResume', {
            taskId: exhaustedTask.id,
            status: exhaustedTask.status,
            adapter: exhaustedTask.adapter,
            deviceId: exhaustedTask.deviceId,
          });
          return;
        }

        const route = this.taskRoutes.get(task.id) ?? this.restoreTaskRouteFromCache(task.id) ?? undefined;
        const scheduledTask = this.cacheTask(retryPlan.task, route);
        this.taskQueue.enqueue(scheduledTask, {
          availableAt: retryPlan.nextRetryAt,
          route,
          dispatchMode: 'retry',
        });
        await this.persistLocalTaskState(scheduledTask, 'retry_scheduled', {
          delayMs: retryPlan.delayMs,
          nextRetryAt: retryPlan.nextRetryAt,
        });
        this.emit('taskRetryScheduled', {
          taskId: scheduledTask.id,
          adapter: scheduledTask.adapter,
          deviceId: scheduledTask.deviceId,
          delayMs: retryPlan.delayMs,
          nextRetryAt: retryPlan.nextRetryAt,
        });
        return;
      }
      case 'wait_login':
      case 'blocked':
        this.taskQueue.pause(task.id);
        if (changed || source === 'local') {
          this.emit('taskAwaitingResume', {
            taskId: task.id,
            status: task.status,
            adapter: task.adapter,
            deviceId: task.deviceId,
          });
        }
        return;
      case 'completed':
      case 'cancelled':
      case 'failed_terminal':
        this.taskQueue.remove(task.id);
        return;
      default:
        if (source === 'adapter' && !isTerminalTaskStatus(task.status)) {
          this.taskQueue.markInflight(task.id);
        }
    }
  }

  private async runTaskPump(): Promise<void> {
    if (this.taskPumpRunning) {
      return;
    }

    this.taskPumpRunning = true;
    try {
      await this.dispatchDueTasks();
      await this.refreshInflightTasks();
    } finally {
      this.taskPumpRunning = false;
      this.scheduleTaskPump();
    }
  }

  private scheduleTaskPump(): void {
    if (this.taskPumpTimer) {
      clearTimeout(this.taskPumpTimer);
      this.taskPumpTimer = null;
    }

    if (!this.taskQueue.hasPendingWork()) {
      return;
    }

    const delayMs = this.taskQueue.nextDelayMs(Date.now(), TASK_POLL_INTERVAL_MS);
    if (delayMs === null) {
      return;
    }

    this.taskPumpTimer = setTimeout(() => {
      void this.runTaskPump();
    }, delayMs);
  }

  private async dispatchDueTasks(): Promise<void> {
    while (true) {
      const entry = this.taskQueue.takeDue();
      if (!entry) {
        return;
      }

      const task = this.tasks.get(entry.taskId) ?? await this.loadPersistedTask(entry.taskId);
      if (!task) {
        this.taskQueue.remove(entry.taskId);
        continue;
      }

      let route = entry.route ?? this.taskRoutes.get(task.id) ?? this.restoreTaskRouteFromCache(task.id) ?? undefined;
      if (!route) {
        route = await this.resolveOrRestoreTaskRoute(task);
      }
      this.taskQueue.setRoute(task.id, route);

      const adapter = this.adapters.get(route.adapterName);
      if (!adapter) {
        this.taskQueue.pause(task.id);
        log.warn(`[RemoteAccess] Pausing task ${task.id}; adapter ${route.adapterName} is unavailable`);
        continue;
      }

      const dispatchTask = this.taskPolicy.prepareForDispatch(task, entry.dispatchMode, Date.now());
      const storedTask = this.cacheTask(dispatchTask, route);
      this.taskQueue.markInflight(storedTask.id);
      await this.persistLocalTaskState(storedTask, `dispatch_${entry.dispatchMode}`, {
        adapter: route.adapterName,
        deviceId: route.deviceId,
      });
      this.emit('taskDispatching', {
        taskId: storedTask.id,
        adapter: route.adapterName,
        deviceId: route.deviceId,
        mode: entry.dispatchMode,
      });

      try {
        const result = await adapter.submitTask(storedTask);
        if (result.taskId && result.taskId !== storedTask.id) {
          try {
            await adapter.cancelTask(result.taskId);
          } catch (cancelError) {
            const cancelMessage = cancelError instanceof Error ? cancelError.message : String(cancelError);
            log.warn(
              `[RemoteAccess] Failed to cancel remapped task ${result.taskId} from adapter ${route.adapterName}: ${cancelMessage}`,
            );
          }

          throw new Error(
            `Adapter ${route.adapterName} remapped task ${storedTask.id} to ${result.taskId}; stable task IDs are required`,
          );
        }

        const activeTaskId = storedTask.id;
        this.taskQueue.markInflight(activeTaskId);
        this.emit('taskSubmitted', {
          taskId: activeTaskId,
          adapter: route.adapterName,
          deviceId: route.deviceId,
          mode: entry.dispatchMode,
        });
      } catch (error) {
        await this.handleDispatchFailure(storedTask, route, entry.dispatchMode, error);
      }
    }
  }

  private async refreshInflightTasks(): Promise<void> {
    for (const taskId of this.taskQueue.listInflightTaskIds()) {
      const route = this.taskRoutes.get(taskId) ?? this.restoreTaskRouteFromCache(taskId);
      if (!route) {
        this.taskQueue.pause(taskId);
        continue;
      }

      const adapter = this.adapters.get(route.adapterName);
      if (!adapter) {
        this.taskQueue.pause(taskId);
        continue;
      }

      try {
        const task = await adapter.getTask(taskId);
        if (!task) {
          const archivedTask = await this.loadPersistedTask(taskId);
          if (archivedTask) {
            this.restoreQueueEntryFromTask(archivedTask, route);
            if (this.taskPolicy.isResumeEligible(archivedTask)) {
              this.emitTaskAwaitingResume(archivedTask, route);
            }
          }
          continue;
        }

        await this.observeAdapterTask(taskId, task, adapter.name, route.deviceId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`[RemoteAccess] refreshTask failed for adapter ${adapter.name} (${taskId}): ${message}`);
      }
    }
  }

  private async handleDispatchFailure(
    task: TaskEnvelope,
    route: TaskRouteRecord,
    mode: TaskDispatchMode,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const failedTask = this.cacheTask(this.cloneTask({
      ...task,
      status: this.isRetryableDispatchError(message) ? 'failed_retryable' : 'failed_terminal',
      updatedAt: Date.now(),
      lastError: message,
    }), route);

    this.taskQueue.noteObservation(failedTask);
    await this.persistLocalTaskState(failedTask, 'dispatch_failed', {
      adapter: route.adapterName,
      deviceId: route.deviceId,
      mode,
      error: message,
    });

    log.warn(`[RemoteAccess] Task dispatch failed for ${task.id} via ${route.adapterName}: ${message}`);
    this.emit('taskUpdated', {
      taskId: failedTask.id,
      status: failedTask.status,
      adapter: route.adapterName,
      deviceId: route.deviceId,
      mode,
    });
    await this.reconcileTaskState(failedTask, true, 'local');
  }

  private async persistLocalTaskState(
    task: TaskEnvelope,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.checkpointStore.persistTask(task);
    if (this.shouldPersistTaskResult(task.status)) {
      await this.persistTaskResultSnapshot(task);
    }
    await this.checkpointStore.appendCheckpoint(task, {
      reason,
      metadata,
    });
  }

  private shouldPersistTaskResult(status: TaskEnvelope['status']): boolean {
    switch (status) {
      case 'wait_login':
      case 'blocked':
      case 'failed_retryable':
      case 'failed_terminal':
      case 'completed':
      case 'cancelled':
        return true;
      default:
        return false;
    }
  }

  private async persistTaskResultSnapshot(task: TaskEnvelope): Promise<void> {
    const existingResult = await this.checkpointStore.loadResult(task.id);
    if (existingResult && existingResult.updatedAt > task.updatedAt) {
      return;
    }

    await this.checkpointStore.persistResult(this.buildTaskResultSnapshot(task, existingResult));
  }

  private buildTaskResultSnapshot(task: TaskEnvelope, existingResult: TaskResult | null): TaskResult {
    let metadata = this.mergeMetadata(existingResult?.metadata, task.metadata);
    if (task.adapter || task.deviceId) {
      metadata = {
        ...(metadata ?? {}),
        ...(task.adapter ? { adapter: task.adapter } : {}),
        ...(task.deviceId ? { deviceId: task.deviceId } : {}),
      };
    }

    return {
      taskId: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
      completedAt: isTerminalTaskStatus(task.status)
        ? (existingResult?.completedAt ?? task.updatedAt)
        : undefined,
      output: existingResult?.output,
      checkpoint: task.checkpoint
        ? { ...task.checkpoint }
        : existingResult?.checkpoint
          ? { ...existingResult.checkpoint }
          : undefined,
      artifacts: this.mergeTaskArtifacts(existingResult?.artifacts, task.artifacts),
      error: this.buildTaskResultError(task, existingResult),
      metadata,
    };
  }

  private buildTaskResultError(
    task: TaskEnvelope,
    existingResult: TaskResult | null,
  ): TaskResult['error'] | undefined {
    if (task.status === 'completed' || task.status === 'cancelled') {
      return undefined;
    }

    const message = task.lastError
      ?? ((task.status === 'failed_retryable' || task.status === 'failed_terminal')
        ? existingResult?.error?.message
        : undefined);
    if (!message) {
      return undefined;
    }

    return {
      code: existingResult?.error?.code ?? this.mapTaskStatusToResultErrorCode(task.status),
      message,
      retryable: task.status === 'failed_retryable'
        ? true
        : existingResult?.error?.retryable,
      details: existingResult?.error?.details,
    };
  }

  private mapTaskStatusToResultErrorCode(status: TaskEnvelope['status']): string {
    switch (status) {
      case 'wait_login':
        return 'WAIT_LOGIN';
      case 'blocked':
        return 'BLOCKED';
      case 'failed_retryable':
        return 'FAILED_RETRYABLE';
      case 'failed_terminal':
        return 'FAILED_TERMINAL';
      default:
        return 'TASK_ERROR';
    }
  }

  private async loadPersistedTask(taskId: string): Promise<TaskEnvelope | null> {
    const archivedTask = await this.checkpointStore.hydrateTask(taskId);
    if (!archivedTask) {
      return null;
    }

    const route = archivedTask.adapter
      ? {
          adapterName: archivedTask.adapter,
          deviceId: archivedTask.deviceId,
        }
      : undefined;
    const storedTask = this.cacheTask(archivedTask, route);
    this.restoreQueueEntryFromTask(storedTask, route);

    return this.cloneTask(storedTask);
  }

  private restoreQueueEntryFromTask(task: TaskEnvelope, route?: TaskRouteRecord): void {
    const effectiveRoute = route
      ?? this.taskRoutes.get(task.id)
      ?? this.restoreTaskRouteFromCache(task.id)
      ?? undefined;
    const dispatchMode = this.resolveDispatchModeForTask(task);
    const now = Date.now();

    if (this.taskPolicy.isResumeEligible(task)) {
      this.taskQueue.upsert(task, {
        route: effectiveRoute,
        state: 'paused',
        dispatchMode,
      });
      return;
    }

    if (ACTIVE_RECOVERABLE_TASK_STATUSES.has(task.status)) {
      const availableAt = this.resolveAvailableAtForTask(task, now);
      this.taskQueue.upsert(task, {
        route: effectiveRoute,
        dispatchMode,
        availableAt,
        state: task.status === 'queued'
          ? (availableAt > now ? 'scheduled' : 'queued')
          : 'inflight',
      });
      return;
    }

    this.taskQueue.remove(task.id);
  }

  private resolveAvailableAtForTask(task: TaskEnvelope, fallbackNow: number = Date.now()): number {
    const state = this.taskPolicy.getState(task);
    if (typeof state.nextRetryAt === 'number' && Number.isFinite(state.nextRetryAt) && state.nextRetryAt > fallbackNow) {
      return state.nextRetryAt;
    }

    return fallbackNow;
  }

  private resolveDispatchModeForTask(task: TaskEnvelope): TaskDispatchMode {
    const remoteMetadata = this.getRemoteMetadata(task.metadata);
    const lastQueueEvent = remoteMetadata.lastQueueEvent;
    if (lastQueueEvent === 'retry_scheduled') {
      return 'retry';
    }

    if (lastQueueEvent === 'resume_requested') {
      return 'resume';
    }

    const lastDispatchMode = remoteMetadata.lastDispatchMode;
    return lastDispatchMode === 'retry' || lastDispatchMode === 'resume'
      ? lastDispatchMode
      : 'initial';
  }

  private emitTaskAwaitingResume(task: TaskEnvelope, route?: TaskRouteRecord): void {
    this.emit('taskAwaitingResume', {
      taskId: task.id,
      status: task.status,
      adapter: task.adapter ?? route?.adapterName,
      deviceId: task.deviceId ?? route?.deviceId,
    });
  }

  private async getKnownTask(taskId: string): Promise<TaskEnvelope | null> {
    const task = this.tasks.get(taskId);
    if (task) {
      return this.cloneTask(task);
    }

    return this.loadPersistedTask(taskId);
  }

  private cacheTask(task: TaskEnvelope, route?: TaskRouteRecord): TaskEnvelope {
    const normalizedTask = this.cloneTask(task);
    this.tasks.set(normalizedTask.id, normalizedTask);
    if (route) {
      this.taskRoutes.set(normalizedTask.id, {
        adapterName: route.adapterName,
        deviceId: route.deviceId,
      });
    } else if (normalizedTask.adapter) {
      this.taskRoutes.set(normalizedTask.id, {
        adapterName: normalizedTask.adapter,
        deviceId: normalizedTask.deviceId,
      });
    }

    return normalizedTask;
  }

  private renameTask(taskId: string, nextTaskId: string): void {
    if (taskId === nextTaskId) {
      return;
    }

    const task = this.tasks.get(taskId);
    const route = this.taskRoutes.get(taskId);
    if (task) {
      this.tasks.delete(taskId);
      this.tasks.set(nextTaskId, this.cloneTask({
        ...task,
        id: nextTaskId,
      }));
    }

    if (route) {
      this.taskRoutes.delete(taskId);
      this.taskRoutes.set(nextTaskId, {
        ...route,
      });
    }

    this.taskQueue.rename(taskId, nextTaskId);
  }

  private storeResolvedTask(
    requestedTaskId: string,
    task: TaskEnvelope,
    adapterName: string,
    fallbackDeviceId?: string,
  ): TaskEnvelope {
    const previousTask = this.tasks.get(task.id) ?? this.tasks.get(requestedTaskId);
    const normalizedTask = this.cloneTask({
      ...(previousTask ?? {} as TaskEnvelope),
      ...task,
      id: task.id || requestedTaskId,
      adapter: task.adapter ?? previousTask?.adapter ?? adapterName,
      deviceId: task.deviceId ?? previousTask?.deviceId ?? fallbackDeviceId,
      checkpoint: task.checkpoint
        ? {
            ...(previousTask?.checkpoint ?? {}),
            ...task.checkpoint,
          }
        : previousTask?.checkpoint,
      artifacts: this.mergeTaskArtifacts(previousTask?.artifacts, task.artifacts),
      metadata: this.mergeMetadata(previousTask?.metadata, task.metadata),
      lastError: task.lastError ?? previousTask?.lastError,
    });

    const effectiveTaskId = normalizedTask.id;
    if (effectiveTaskId !== requestedTaskId) {
      this.tasks.delete(requestedTaskId);
      this.taskRoutes.delete(requestedTaskId);
      this.taskQueue.rename(requestedTaskId, effectiveTaskId);
    }

    const route: TaskRouteRecord = {
      adapterName: normalizedTask.adapter ?? adapterName,
      deviceId: normalizedTask.deviceId ?? fallbackDeviceId,
    };
    return this.cacheTask(normalizedTask, route);
  }

  private isRetryableDispatchError(message: string): boolean {
    return /timeout|timed out|econn|network|temporar|unavailable|refused|reset/i.test(message);
  }

  private mergeTaskArtifacts(current: TaskArtifacts | undefined, patch: TaskArtifacts | undefined): TaskArtifacts | undefined {
    if (!current && !patch) {
      return undefined;
    }

    return {
      screenshots: this.mergeStringArrays(current?.screenshots, patch?.screenshots),
      snapshots: this.mergeStringArrays(current?.snapshots, patch?.snapshots),
      logs: this.mergeStringArrays(current?.logs, patch?.logs),
    };
  }

  private mergeStringArrays(current: string[] | undefined, patch: string[] | undefined): string[] | undefined {
    const values = [...(current ?? []), ...(patch ?? [])].filter((value): value is string => Boolean(value));
    if (values.length === 0) {
      return undefined;
    }

    return Array.from(new Set(values));
  }

  private mergeMetadata(
    current: Record<string, unknown> | undefined,
    patch: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!current && !patch) {
      return undefined;
    }

    return {
      ...(current ?? {}),
      ...(patch ?? {}),
      remote: {
        ...this.getRemoteMetadata(current),
        ...this.getRemoteMetadata(patch),
      },
    };
  }

  private getRemoteMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    const remote = metadata?.remote;
    return remote && typeof remote === 'object' && !Array.isArray(remote)
      ? { ...(remote as Record<string, unknown>) }
      : {};
  }

  private describeLegacyCommandResult(
    command: string,
    status: TaskEnvelope['status'],
    lastError?: string,
  ): string {
    switch (status) {
      case 'completed':
        return `Command completed through remote task bridge: ${command}`;
      case 'blocked':
      case 'wait_login':
      case 'failed_retryable':
      case 'failed_terminal':
      case 'cancelled': {
        const suffix = lastError ? ` (${lastError})` : '';
        return `Command did not execute successfully; task ended as ${status}${suffix}`;
      }
      default:
        return `Command accepted into remote task bridge; current status: ${status}`;
    }
  }

  private cloneDevice(device: RemoteDevice): RemoteDevice {
    return {
      ...device,
      capabilities: [...device.capabilities],
      metadata: device.metadata ? { ...device.metadata } : undefined,
    };
  }

  private cloneSession(session: RemoteSession): RemoteSession {
    return {
      ...session,
      device: this.cloneDevice(session.device),
      metadata: session.metadata ? { ...session.metadata } : undefined,
    };
  }

  private cloneTask(task: TaskEnvelope): TaskEnvelope {
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
}

export type { RemoteAdapter, RemoteDevice, RemoteSession } from './adapters/RemoteAdapter';
export type { TaskEnvelope } from './contracts/TaskEnvelope';
export { WindowsMcpAdapter } from './adapters/WindowsMcpAdapter';

export default RemoteAccess;
