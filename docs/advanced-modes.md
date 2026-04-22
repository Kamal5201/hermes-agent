# Hermes Companion - 进阶模式

## 🎮 游戏模式

### 台球辅助

**愿景**: Hermes 学会看台球桌，分析球的位置，计算最优击球路线。

```typescript
interface BilliardsModule {
  // 感知 - 看懂球桌
  captureTable(): Promise<TableState>;
  detectBalls(): Ball[];
  detectPockets(): Pocket[];
  detectCue(): CuePosition;
  
  // 分析 - 计算策略
  calculateShot(ball: Ball, targetPocket: Pocket): Shot;
  calculateSafetyShot(): Shot;
  calculateOptimalBallOrder(): Ball[];
  
  // 执行 - 瞄准击球
  aimShot(shot: Shot): Promise<void>;
  executeShot(power: number, english: number): Promise<void>;
  
  // 学习 - 不断提高
  learnFromMiss(shot: Shot, actualResult: string): void;
  learnFromPocket(ball: Ball, pocket: Pocket): void;
}

interface Shot {
  ball: Ball;           // 目标球
  pocket: Pocket;       // 目标袋
  cuePosition: Point;  // 杆头位置
  cueAngle: number;     // 杆角度
  power: number;        // 力度 0-100
  english: number;      // 偏塞 -1 to 1
  difficulty: number;    // 难度 0-1
  confidence: number;    // 置信度 0-1
}

interface TableState {
  width: number;
  height: number;
  balls: Ball[];
  cueBall: Ball;
  pockets: Pocket[];
  clothColor: string;
  ballsInPocket: string[];
}
```

### 乒乓球辅助

```typescript
interface PingPongModule {
  // 追踪球轨迹
  trackBall(): Promise<Trajectory>;
  predictBounce(): Point;
  
  // 追踪对手
  trackOpponent(): OpponentState;
  
  // 策略
  calculateReturn Shot(): Shot;
  
  // 执行
  moveTo(position: Point): Promise<void>;
  executeSwing(shot: Shot): Promise<void>;
}
```

---

## 🔴 渗透模式

### Burp Suite 集成

**愿景**: Hermes 懂得安全测试，能操控 Burp Suite 进行渗透测试。

```typescript
interface PentestModule {
  // Burp Suite 集成
  burp: BurpIntegration;
  
  // 被动扫描
  startPassiveScan(scope: Scope): Promise<void>;
  stopPassiveScan(): Promise<void>;
  
  // 主动扫描
  startActiveScan(target: string): Promise<void>;
  
  // 漏洞检测
  detectVulnerabilities(issue: BurpIssue[]): Vulnerability[];
  
  // 报告生成
  generateReport(format: 'HTML' | 'JSON' | 'PDF'): Promise<Report>;
}

interface BurpIntegration {
  // REST API 或 Extension API
  proxy: {
    setIntercept(enabled: boolean): void;
    getHistory(): HttpMessage[];
  };
  scanner: {
    isScanning(): boolean;
    getScanQueue(): ScanQueueItem[];
  };
  target: {
    setScope(scope: Scope): void;
    getScope(): Scope;
  };
}
```

### 漏洞检测规则

```typescript
interface VulnerabilityRule {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  cwe: string;
  description: string;
  detectionMethod: 'regex' | 'diff' | 'timing' | 'status';
  pattern?: string;
  remediation: string;
}

const VULNERABILITY_RULES: VulnerabilityRule[] = [
  {
    id: 'sql-injection',
    name: 'SQL Injection',
    severity: 'critical',
    cwe: 'CWE-89',
    description: 'User input directly concatenated into SQL query',
    detectionMethod: 'timing',
    pattern: ".*(union|select|insert|update|delete).*",
    remediation: 'Use parameterized queries'
  },
  {
    id: 'xss-reflected',
    name: 'Reflected XSS',
    severity: 'high',
    cwe: 'CWE-79',
    description: 'User input reflected in response without sanitization',
    detectionMethod: 'regex',
    pattern: '<script[^>]*>.*?</script>',
    remediation: 'Escape HTML output'
  },
  // ... 更多规则
];
```

---

## 🎯 自动化脚本模式

### AutoIt / AutoHotkey 脚本生成

```typescript
interface AutomationModule {
  // 录制
  startRecording(): void;
  stopRecording(): RecordedActions;
  
  // 回放
  play(actions: RecordedActions): Promise<void>;
  
  // 编辑
  editAction(action: RecordedAction): RecordedAction;
  
  // 保存/加载
  saveScript(name: string, actions: RecordedActions): void;
  loadScript(name: string): RecordedActions;
}

interface RecordedActions {
  name: string;
  createdAt: number;
  actions: RecordedAction[];
  metadata: {
    appName: string;
    windowTitle: string;
  };
}

interface RecordedAction {
  type: 'click' | 'type' | 'key' | 'wait' | 'scroll';
  timestamp: number;
  data: {
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    duration?: number;
  };
}
```

---

## 🕹️ 游戏辅助框架

### 通用游戏接口

```typescript
interface GameAssistant {
  // 游戏识别
  identifyGame(): Promise<GameInfo | null>;
  
  // 屏幕理解
  captureGameScreen(): Promise<GameState>;
  parseGameState(raw: Buffer): ParsedState;
  
  // 决策
  makeDecision(state: ParsedState): GameAction;
  
  // 执行
  executeAction(action: GameAction): Promise<void>;
  
  // 学习
  learnFromGame(feedback: GameFeedback): void;
}

interface GameInfo {
  name: string;
  genre: 'fps' | 'rts' | 'moba' | 'puzzle' | 'arcade';
  hasOverlay: boolean;
}

interface GameAction {
  type: string;
  params: Record<string, unknown>;
  confidence: number;
  estimatedOutcome: string;
}
```

---

## 📊 模式切换

### 状态机扩展

```typescript
enum OperatingMode {
  // 原有状态
  STEALTH = 'stealth',
  OBSERVING = 'observing',
  HINT = 'hint',
  ACTIVE = 'active',
  RETREATING = 'retreating',
  
  // 新增模式
  GAME = 'game',           // 游戏模式
  PENTEST = 'pentest',     // 渗透模式
  AUTOMATION = 'automation', // 自动化模式
}

interface ModeSwitcher {
  switchMode(mode: OperatingMode): Promise<void>;
  getCurrentMode(): OperatingMode;
  
  // 模式特定配置
  configureGameMode(config: GameConfig): void;
  configurePentestMode(config: PentestConfig): void;
}
```

---

## 🎯 Sprint 3 目标

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 游戏模式框架 | P1 | 通用游戏辅助接口 |
| 台球辅助 | P1 | 第一个游戏辅助实现 |
| 渗透模式框架 | P2 | Burp 集成基础 |
| 自动化脚本 | P2 | 录制/回放功能 |
| 乒乓球辅助 | P3 | 实时追踪 |

---

*这些功能让 Hermes 不仅是一个桌面伴侣，更是一个真正的智能助手*
