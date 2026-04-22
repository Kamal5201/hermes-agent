# Hermes Companion - 优化开发提示词

## 项目路径
```
/lzcapp/document/hermes-companion/
```

## 背景
Hermes Companion 是一个 AI 伴生系统，代码模块已实现但未连接。需要你完成以下优化任务。

## 任务优先级

### 🔴 P0 - 必须完成（让系统跑起来）

#### 任务1: 创建 AppCoordinator 连接所有模块

**文件**: `src/main/AppCoordinator.ts` (新建)

**要求**:
```typescript
import { EventEmitter } from 'events';
import log from 'electron-log/main.js';
import { DatabaseManager } from '../database';
import { PerceptionModule } from '../perception';
import { StateEngine, CompanionState } from '../state';
import { LearningEngine } from '../learning';
import { PredictionEngine } from '../prediction';
import { ExecutionModule, MCPHandler, ConfigStore } from '../mcp';
import { SecurityGuard, PrivacyManager } from '../security';
import { AppleStyleUI, UIState } from '../ui';
import { setupIpcHandlers, DatabaseConfigStore } from './ipc-handlers';

export class AppCoordinator extends EventEmitter {
  private db!: DatabaseManager;
  private perception!: PerceptionModule;
  private state!: StateEngine;
  private learning!: LearningEngine;
  private prediction!: PredictionEngine;
  private execution!: ExecutionModule;
  private mcp!: MCPHandler;
  private security!: SecurityGuard;
  private privacy!: PrivacyManager;
  private ui!: AppleStyleUI;
  private configStore!: ConfigStore;
  private isRunning = false;

  // 初始化顺序很重要
  async start(): Promise<void> {
    if (this.isRunning) return;
    log.info('[AppCoordinator] Starting...');

    try {
      // 1. 数据库 - 最先启动
      this.db = new DatabaseManager();
      await this.db.initialize();
      log.info('[AppCoordinator] Database initialized');

      // 2. 安全层
      this.security = SecurityGuard.getInstance();
      this.privacy = PrivacyManager.getInstance();
      log.info('[AppCoordinator] Security initialized');

      // 3. 感知层
      this.perception = new PerceptionModule();
      log.info('[AppCoordinator] Perception initialized');

      // 4. 学习引擎
      this.learning = new LearningEngine(this.db);
      log.info('[AppCoordinator] Learning engine initialized');

      // 5. 预测引擎
      this.prediction = PredictionEngine.getInstance(this.learning, this.db);
      log.info('[AppCoordinator] Prediction engine initialized');

      // 6. 状态机 - 默认静默
      this.state = new StateEngine(CompanionState.STEALTH);
      this.state.onStateChange(this.handleStateChange.bind(this));
      log.info('[AppCoordinator] State engine initialized');

      // 7. 执行层
      this.execution = new ExecutionModule();
      log.info('[AppCoordinator] Execution module initialized');

      // 8. 配置存储
      this.configStore = new DatabaseConfigStore(this.db);
      log.info('[AppCoordinator] Config store initialized');

      // 9. UI
      this.ui = AppleStyleUI.getInstance();
      log.info('[AppCoordinator] UI initialized');

      // 10. MCP Handler
      this.mcp = new MCPHandler(
        this.perception,
        this.execution,
        this.learning,
        this.security,
        this.privacy,
        this.configStore
      );
      log.info('[AppCoordinator] MCP handler initialized');

      // 11. 设置事件流
      this.setupEventFlow();
      log.info('[AppCoordinator] Event flow configured');

      // 12. 设置 IPC
      setupIpcHandlers(
        this.perception,
        this.execution,
        this.state,
        this.learning,
        this.mcp,
        this.security,
        this.configStore
      );
      log.info('[AppCoordinator] IPC handlers registered');

      // 13. 启动感知监控
      this.perception.startMonitoring();
      log.info('[AppCoordinator] Perception monitoring started');

      this.isRunning = true;
      log.info('[AppCoordinator] All systems go!');
    } catch (error) {
      log.error('[AppCoordinator] Failed to start:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    log.info('[AppCoordinator] Stopping...');

    this.perception?.stopMonitoring();
    await this.mcp?.disconnect();
    this.db?.close?.();

    this.isRunning = false;
    log.info('[AppCoordinator] Stopped');
  }

  private setupEventFlow(): void {
    // 感知事件 → 学习引擎
    this.perception.on('windowChange', (data) => {
      this.learning.recordWindowChange(data);
    });

    // 感知事件 → 状态机
    this.perception.on('activity', (data) => {
      this.state.updateContext({
        userActivity: data.activity,
        lastActivityTimestamp: Date.now()
      });
    });

    // 感知事件 → 预测引擎
    this.perception.on('activity', async (data) => {
      if (this.prediction) {
        const predictions = await this.prediction.predict({
          currentApp: data.appName || 'unknown',
          timeOfDay: this.getTimeOfDay(),
          dayOfWeek: new Date().getDay(),
          recentOperations: [],
          attentionScore: data.activity > 0.5 ? 1 : 0
        });

        // 高置信度预测 → 状态机
        const highConf = predictions.find(p => p.confidence > 0.85);
        if (highConf) {
          this.state.updateContext({ attentionNeeded: true });
        }
      }
    });

    // 状态变化 → UI
    this.state.onStateChange((newState, prevState) => {
      this.ui.updateState(newState as unknown as UIState);
    });
  }

  private handleStateChange(newState: CompanionState, prevState: CompanionState): void {
    log.info(`[AppCoordinator] State: ${prevState} → ${newState}`);
    
    // 状态变化时触发相应行动
    if (newState === CompanionState.STEALTH) {
      // 进入静默模式
    } else if (newState === CompanionState.OBSERVING) {
      // 开始观察模式
    } else if (newState === CompanionState.HINT) {
      // 显示轻提示
    } else if (newState === CompanionState.ACTIVE) {
      // 进入主动模式
    } else if (newState === CompanionState.RETREATING) {
      // 优雅退场
    }
  }

  private getTimeOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  getState(): StateEngine {
    return this.state;
  }

  getPerception(): PerceptionModule {
    return this.perception;
  }

  getLearning(): LearningEngine {
    return this.learning;
  }
}
```

**更新 `src/main/index.ts`**:
```typescript
// 在文件末尾添加
import { AppCoordinator } from './AppCoordinator';

let coordinator: AppCoordinator | null = null;

async function applicationReady(): Promise<void> {
  log.info('Application ready');
  
  try {
    // 创建并启动协调整器
    coordinator = new AppCoordinator();
    await coordinator.start();
    
    // 设置初始状态
    if (envConfig.NODE_ENV === 'production') {
      // 生产环境静默启动
    } else {
      // 开发环境从观察开始
      coordinator.getState().setState(CompanionState.OBSERVING);
    }
    
    log.info('Application initialization complete');
  } catch (error) {
    log.error('Application initialization failed:', error);
    gracefulShutdown(1);
  }
}

// 在 gracefulShutdown 中添加
async function gracefulShutdown(exitCode: number = 0): Promise<void> {
  // ...
  await coordinator?.stop();
  // ...
}
```

---

#### 任务2: 创建 EventPipeline 批量写入

**文件**: `src/common/EventPipeline.ts` (新建)

```typescript
export abstract class EventPipeline<T> {
  protected buffer: T[] = [];
  protected readonly maxBufferSize: number;
  protected readonly flushIntervalMs: number;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(maxBufferSize: number = 100, flushIntervalMs: number = 1000) {
    this.maxBufferSize = maxBufferSize;
    this.flushIntervalMs = flushIntervalMs;
  }

  start(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush(); // 最后刷新
  }

  push(event: T): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      this.processBatch(batch);
    } catch (error) {
      console.error('[EventPipeline] Batch processing failed:', error);
      // 放回 buffer 前面
      this.buffer.unshift(...batch);
    }
  }

  protected abstract processBatch(batch: T[]): void;
}
```

**文件**: `src/perception/WindowEventPipeline.ts` (新建)

```typescript
import { EventPipeline } from '../common/EventPipeline';
import DatabaseManager from '../database/DatabaseManager';

interface WindowEvent {
  windowId: string;
  title?: string;
  appName?: string;
  startTime: number;
  endTime?: number;
}

export class WindowEventPipeline extends EventPipeline<WindowEvent> {
  constructor(private db: DatabaseManager) {
    super(50, 500); // 50条或500ms
  }

  protected processBatch(batch: WindowEvent[]): void {
    const stmt = this.db.getStatement?.('window_history_insert') || 
      `INSERT INTO window_history (window_id, title, app_name, start_time, end_time) VALUES (?, ?, ?, ?, ?)`;
    
    // 批量插入
    for (const event of batch) {
      try {
        this.db.createWindowHistory?.({
          window_id: event.windowId,
          title: event.title,
          app_name: event.appName,
          start_time: event.startTime,
          end_time: event.endTime
        });
      } catch (e) {
        console.error('[WindowEventPipeline] Insert failed:', e);
      }
    }
  }
}
```

**更新 `src/perception/PerceptionModule.ts`**:
```typescript
import { WindowEventPipeline } from './WindowEventPipeline';

export class PerceptionModule extends EventEmitter {
  private windowPipeline!: WindowEventPipeline;
  // ...
  
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    
    // 启动批量写入管道
    this.windowPipeline = new WindowEventPipeline(/* db instance */);
    this.windowPipeline.start();
    
    // 窗口监控
    this.startWindowMonitoring();
  }
  
  stopMonitoring(): void {
    this.isMonitoring = false;
    this.windowPipeline?.stop();
  }
  
  private onWindowChange(data: WindowEvent): void {
    // 使用批量管道而非直接写入
    this.windowPipeline.push(data);
  }
}
```

---

#### 任务3: Windows 兼容层

**文件**: `src/mcp/ExecutionModule.ts` 更新

找到 `private readonly platform = process.platform;` 这行，在其后添加：

```typescript
// Windows API 类型声明
interface WindowsMouseEvent {
  (dwFlags: number, dx?: number, dy?: number, mouseData?: number, dwExtraInfo?: number): void;
}

interface WindowsKeyEvent {
  (bVk: number, bScan: number, dwFlags: number, dwExtraInfo?: number): void;
}

// Windows 虚拟键码
const VK_CODES: Record<string, number> = {
  'backspace': 0x08, 'tab': 0x09, 'enter': 0x0D, 'shift': 0x10,
  'ctrl': 0x11, 'alt': 0x12, 'escape': 0x1B, 'space': 0x20,
  'pageup': 0x21, 'pagedown': 0x22, 'end': 0x23, 'home': 0x24,
  'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28,
  'delete': 0x2E, '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33,
  '4': 0x34, '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45, 'f': 0x46,
  'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C,
  'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50, 'q': 0x51, 'r': 0x52,
  's': 0x53, 't': 0x54, 'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
  'y': 0x59, 'z': 0x5A,
};

// Windows 鼠标事件标志
const MOUSE_EVENTS = {
  LEFTDOWN: 0x0002,
  LEFTUP: 0x0004,
  RIGHTDOWN: 0x0008,
  RIGHTUP: 0x0010,
  MIDDLEDOWN: 0x0020,
  MIDDLEUP: 0x0040,
  MOVE: 0x0001,
  ABSOLUTE: 0x8000,
};
```

更新 `click` 方法：
```typescript
public async click(x: number, y: number, button: MouseButtonName = 'left'): Promise<ExecutionResult> {
  if (this.isWindows) {
    return this.windowsClick(x, y, button);
  }
  
  // 原 macOS/Linux 实现
  const targetButton = this.resolveMouseButton(button);
  await mouse.setPosition({ x: Math.round(x), y: Math.round(y) });
  await mouse.click(targetButton);

  return this.createResult('click', { button, x: Math.round(x), y: Math.round(y) });
}

private async windowsClick(x: number, y: number, button: MouseButtonName): Promise<ExecutionResult> {
  try {
    // 动态导入 Windows native 模块
    const user32 = await import('ffi-napi').catch(() => null) || 
                   await import('windows-api').catch(() => null);
    
    if (user32) {
      const { SetCursorPos, mouse_event } = user32;
      SetCursorPos(x, y);
      
      const events = {
        'left': [MOUSE_EVENTS.LEFTDOWN, MOUSE_EVENTS.LEFTUP],
        'right': [MOUSE_EVENTS.RIGHTDOWN, MOUSE_EVENTS.RIGHTUP],
        'middle': [MOUSE_EVENTS.MIDDLEDOWN, MOUSE_EVENTS.MIDDLEUP],
      };
      
      const [down, up] = events[button];
      mouse_event(down, 0, 0, 0, 0);
      mouse_event(up, 0, 0, 0, 0);
    } else {
      // 回退到 nut-js
      await mouse.setPosition({ x, y });
      const btn = button === 'left' ? Button.LEFT : button === 'right' ? Button.RIGHT : Button.MIDDLE;
      await mouse.click(btn);
    }
    
    return this.createResult('click', { platform: 'windows', x, y, button });
  } catch (error) {
    log.error('[ExecutionModule] Windows click failed:', error);
    throw error;
  }
}
```

更新 `pressKey` 方法添加 Windows 支持：
```typescript
public async pressKey(key: string): Promise<ExecutionResult> {
  if (this.isWindows) {
    return this.windowsPressKey(key);
  }
  
  // 原实现
  const resolvedKey = this.resolveKey(key);
  await keyboard.pressKey(resolvedKey);
  await keyboard.releaseKey(resolvedKey);

  return this.createResult('press_key', { key, resolvedKey: this.normalizeKeyName(key) });
}

private async windowsPressKey(key: string): Promise<ExecutionResult> {
  try {
    const vkCode = VK_CODES[key.toLowerCase()];
    if (!vkCode) {
      // 回退到 nut-js
      const resolvedKey = this.resolveKey(key);
      await keyboard.pressKey(resolvedKey);
      await keyboard.releaseKey(resolvedKey);
      return this.createResult('press_key', { key, fallback: true });
    }

    // 动态导入
    const user32 = await import('ffi-napi').catch(() => null) || 
                   await import('windows-api').catch(() => null);
    
    if (user32) {
      const { keybd_event } = user32;
      // keydown
      keybd_event(vkCode, 0, 0, 0);
      // keyup  
      keybd_event(vkCode, 0, 0x0002, 0);
    }

    return this.createResult('press_key', { key, vkCode, platform: 'windows' });
  } catch (error) {
    log.error('[ExecutionModule] Windows pressKey failed:', error);
    throw error;
  }
}
```

---

### 🟡 P1 - 重要优化

#### 任务4: CSS 呼吸动画优化

**文件**: `src/renderer/styles/companion.css`

将 `.companion-orb` 的动画规则改为：

```css
/* 默认不动画 */
.companion-orb {
  /* ... 其他样式 ... */
  animation: none;
  transition: opacity 300ms ease, box-shadow 300ms ease;
}

/* 仅在 HINT 和 ACTIVE 状态启用呼吸动画 */
.state-hint .companion-orb,
.state-active .companion-orb {
  animation: breathing 2s ease-in-out infinite;
}

/* OBSERVING 状态极低存在感 */
.state-observing .companion-orb {
  opacity: 0.15 !important;
  animation: none;
}

/* 静默状态完全不显示 */
.state-stealth .companion-orb,
.state-stealth .companion-bubble {
  opacity: 0 !important;
  pointer-events: none;
}

/* 退场动画 */
.state-retreating .companion-orb,
.state-retreating .companion-bubble {
  animation: fadeOut 300ms ease forwards !important;
}
```

---

#### 任务5: 更新 DatabaseManager 批量方法

**文件**: `src/database/DatabaseManager.ts`

在类中添加：

```typescript
// 批量插入窗口历史
public batchInsertWindowHistory(events: WindowHistory[]): void {
  if (events.length === 0) return;
  
  const stmt = this.db.prepare(`
    INSERT INTO window_history 
    (window_id, title, app_name, start_time, end_time, duration)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = this.db.transaction((rows: WindowHistory[]) => {
    for (const row of rows) {
      stmt.run(
        row.window_id,
        row.title || null,
        row.app_name || null,
        row.start_time,
        row.end_time || null,
        row.duration || null
      );
    }
  });

  insertMany(events);
}

// 获取最近操作
public getRecentOperations(sinceTimestamp: number): OperationHistory[] {
  const stmt = this.db.prepare(`
    SELECT * FROM operation_history 
    WHERE timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT 100
  `);
  return stmt.all(sinceTimestamp) as OperationHistory[];
}
```

---

#### 任务6: 增强 SecurityGuard 提示词注入检测

**文件**: `src/security/SecurityGuard.ts`

更新 `suspiciousPatterns`：

```typescript
private readonly suspiciousPatterns: RegExp[] = [
  // 原有
  /ignore.*previous.*instruction/i,
  /forget.*what.*said/i,
  /system.*prompt.*injection/i,
  /you.*are.*now.*different/i,
  
  // 角色扮演攻击
  /you.*are.*now.*a.*different.*ai/i,
  /pretend.*you.*are/i,
  /disregard.*all.*previous/i,
  /new.*system.*prompt/i,
  
  // 命令注入
  /;\s*rm\s+/i,
  /;\s*del\s+/i,
  /&\s*&\s*rm/i,
  /\|\s*sh/i,
  /\$\(.*\)/i,
  
  // 编码混淆
  /base64.*decode/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /\\x[0-9a-f]{2}/i,
  
  // 越狱提示
  /jailbreak/i,
  / DAN.*mode/i,
  /do.*anything.*now/i,
];
```

---

### 🟢 P2 - 增强功能

#### 任务7: 创建 HealthMonitor

**文件**: `src/main/HealthMonitor.ts` (新建)

```typescript
import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

interface HealthCheck {
  name: string;
  healthy: boolean | null;
  lastCheck: number;
  error?: string;
}

interface HealthStatus {
  overall: boolean;
  timestamp: number;
  checks: HealthCheck[];
}

export class HealthMonitor extends EventEmitter {
  private checks: Map<string, HealthCheck> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(intervalMs: number = 30000) {
    super();
    this.intervalMs = intervalMs;
  }

  register(name: string): void {
    this.checks.set(name, {
      name,
      healthy: null,
      lastCheck: 0
    });
    log.info(`[HealthMonitor] Registered: ${name}`);
  }

  setHealthy(name: string, healthy: boolean, error?: string): void {
    const check = this.checks.get(name);
    if (check) {
      check.healthy = healthy;
      check.lastCheck = Date.now();
      check.error = error;
      
      if (!healthy) {
        log.warn(`[HealthMonitor] ${name} became unhealthy: ${error}`);
        this.emit('unhealthy', { name, error });
      }
    }
  }

  async checkAll(): Promise<HealthStatus> {
    const results: HealthCheck[] = [];
    
    for (const [name, check] of this.checks.entries()) {
      results.push({ ...check });
    }

    const overall = results.every(c => c.healthy !== false);
    
    return {
      overall,
      timestamp: Date.now(),
      checks: results
    };
  }

  start(): void {
    this.checkInterval = setInterval(async () => {
      const status = await this.checkAll();
      this.emit('check', status);
      
      if (!status.overall) {
        log.warn('[HealthMonitor] Overall health check failed');
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
```

---

#### 任务8: 更新 index.html 添加健康检查

**文件**: `src/renderer/index.html`

在 `<script>` 中添加：

```javascript
// 健康检查
let healthCheckInterval = null;

async function startHealthChecks() {
  if (!window.hermes?.config) return;
  
  healthCheckInterval = setInterval(async () => {
    try {
      const health = await window.hermes.config.get('system_health');
      if (health && !health.overall) {
        orbElement.style.boxShadow = '0 0 20px rgba(255, 59, 48, 0.6)';
      }
    } catch (e) {
      // ignore
    }
  }, 30000);
}

function stopHealthChecks() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// 在 bootstrap 中调用
async function bootstrap() {
  // ... 现有代码 ...
  startHealthChecks();
}
```

---

## 文件创建/修改清单

| 优先级 | 文件 | 操作 | 描述 |
|--------|------|------|------|
| P0 | `src/main/AppCoordinator.ts` | 新建 | 核心协调器 |
| P0 | `src/main/index.ts` | 修改 | 集成 AppCoordinator |
| P0 | `src/common/EventPipeline.ts` | 新建 | 批量处理基类 |
| P0 | `src/perception/WindowEventPipeline.ts` | 新建 | 窗口事件管道 |
| P0 | `src/mcp/ExecutionModule.ts` | 修改 | Windows 兼容 |
| P1 | `src/renderer/styles/companion.css` | 修改 | 动画优化 |
| P1 | `src/database/DatabaseManager.ts` | 修改 | 批量方法 |
| P1 | `src/security/SecurityGuard.ts` | 修改 | 增强检测 |
| P2 | `src/main/HealthMonitor.ts` | 新建 | 健康检查 |
| P2 | `src/renderer/index.html` | 修改 | 健康检查UI |

---

## 开发顺序

1. **EventPipeline 基类** → 其他模块依赖它
2. **WindowEventPipeline** → 感知模块需要
3. **AppCoordinator** → 连接一切
4. **更新 main/index.ts** → 启用协调器
5. **ExecutionModule Windows 支持** → 平台兼容
6. **CSS 动画优化** → UX 提升
7. **DatabaseManager 批量方法** → 性能优化
8. **SecurityGuard 增强** → 安全加固
9. **HealthMonitor** → 可靠性

---

## 代码风格要求

- 使用 ESM (import/export)
- TypeScript strict 模式
- 添加适当的 console.log 和 log.info
- 关键逻辑添加中文注释
- 错误处理用 try-catch
- 所有 async 函数正确处理 Promise

---

开始优化开发！
