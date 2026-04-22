# Hermes Companion AI System - Codex 开发提示词

## 项目背景

Hermes Companion 是一个 AI 伴生系统 - 一个懂你、陪你、帮你的 AI 伙伴。

**核心理念**:
- 比你更懂你的使用习惯
- 不需要时安静隐身，需要时瞬间出现
- 像水一样 - 合理的出现与消失
- 像大脑一样 - 举一反三的智能
- 像老朋友一样 - 7天高强度使用后，适应你的节奏，越来越好用

**Slogan**: "比你更懂你，不打扰但一直在"

**技术栈** (已验证):
- Electron 桌面框架
- @computer-use/nut-js v4.2.0 (GUI 自动化)
- better-sqlite3 (本地数据库)
- node-pty (终端控制)
- node-screenshots + sharp (屏幕截图)
- ws (WebSocket)
- TypeScript

## 项目路径

```
/lzcapp/document/hermes-companion/
```

## 已完成的模块

### ✅ 数据库层
- `src/database/DatabaseManager.ts` - CRUD 操作
- `src/database/schema.sql` - 表结构

### ✅ 主进程
- `src/main/index.ts` - Electron 主进程入口

### ✅ 感知层
- `src/perception/PerceptionModule.ts` - 屏幕截图、窗口管理、应用检测

### ✅ 状态机
- `src/state/CompanionState.ts` - 状态枚举和接口
- `src/state/StateEngine.ts` - 5态机实现

### ✅ 学习引擎
- `src/learning/UserProfile.ts` - 类型定义
- `src/learning/LearningEngine.ts` - 7天学习周期

### ✅ 安全层
- `src/security/SecurityGuard.ts` - 操作安全检查
- `src/security/PrivacyManager.ts` - 隐私管理

### ✅ MCP 协议
- `src/mcp/Protocol.ts` - 消息类型定义

### ✅ 预测引擎
- `src/prediction/PredictionTypes.ts` - 预测类型
- `src/prediction/PredictionEngine.ts` - 预测引擎

## 需要完成的模块

### 🔴 缺失文件 - 必须创建

#### 1. MCP 协议 (src/mcp/)
```
需要创建:
- src/mcp/ToolDefinitions.ts   - 19个工具定义 (perception 6个, execution 6个, learning 4个, config 3个)
- src/mcp/MCPHandler.ts        - WebSocket 消息处理器 + 工具路由
- src/mcp/ExecutionModule.ts   - 执行模块 (GUI 操作路由)
- src/mcp/index.ts             - 导出
```

**ToolDefinitions.ts 要求**:
- 6个感知工具: capture_screen, get_windows, get_focused_window, get_running_apps, get_mouse_position, get_clipboard
- 6个执行工具: click, type_text, press_key, hotkey, open_app, close_app
- 4个学习工具: get_patterns, get_prediction, get_user_profile, set_feedback
- 3个配置工具: config_get, config_set, set_privacy
- 每个工具有 name, description, inputSchema

**MCPHandler.ts 要求**:
- WebSocket 连接管理 (ws)
- 连接状态: DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING
- 重连逻辑 (指数退避)
- 消息发送/接收
- 工具调用路由到对应模块
- 事件: stateChange, message, error

**ExecutionModule.ts 要求**:
- click(x, y, button?) - nut-js 鼠标点击
- type_text(text) - nut-js 键盘输入
- press_key(key) - nut-js 按键
- hotkey(...keys) - 组合键
- open_app(bundleId) - 启动应用
- close_app(bundleId) - 关闭应用

#### 2. UI (src/ui/)
```
需要创建:
- src/ui/AppleStyleUI.ts   - Apple 风格 UI 类
- src/ui/index.ts          - 导出
```

**AppleStyleUI.ts 要求**:
```typescript
class AppleStyleUI {
  // 状态枚举
  enum UIState { STEALTH, OBSERVING, HINT, ACTIVE, RETREATING }
  
  // 状态颜色
  // STEALTH: transparent (0% opacity)
  // OBSERVING: #4A90D9 (light blue) @ 30% opacity
  // HINT: #FFD700 (yellow) @ 60% opacity
  // ACTIVE: #FF6B35 (orange) @ 80% opacity
  // RETREATING: fade out animation (300ms)
  
  // 呼吸灯效果: 2秒周期
  // 浮动气泡提示
  // 单例模式
  
  // 方法
  render(state: UIState, context?: any): RenderOutput
  showHint(text: string): void
  showActive(intent: string): void
  hide(): void
  showRetreat(): void
  updateState(state: UIState): void
}
```

#### 3. CSS 样式 (src/renderer/styles/)
```
需要创建:
- src/renderer/styles/companion.css - Apple 风格 CSS
```

**companion.css 要求**:
```css
/* 呼吸动画 - 2秒周期 */
@keyframes breathing {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.85; }
}

/* 渐隐动画 - 300ms */
@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* 状态颜色变量 */
:root {
  --state-stealth: transparent;
  --state-observing: rgba(74, 144, 217, 0.3);
  --state-hint: rgba(255, 215, 0, 0.6);
  --state-active: rgba(255, 107, 53, 0.8);
}

/* 核心类 */
.companion-orb { }    /* 光点 */
.companion-bubble { } /* 提示气泡 */
.state-stealth { }    /* 状态样式 */
.state-observing { }
.state-hint { }
.state-active { }
.state-retreating { }
```

#### 4. Preload 脚本
```
需要创建:
- src/preload/index.ts - 安全上下文桥接
```

**preload/index.ts 要求**:
```typescript
// 使用 contextBridge 暴露安全 API
contextBridge.exposeInMainWorld('hermes', {
  // 感知
  perception: {
    captureScreen: () => ipcRenderer.invoke('perception:captureScreen'),
    getWindows: () => ipcRenderer.invoke('perception:getWindows'),
    getRunningApps: () => ipcRenderer.invoke('perception:getRunningApps'),
    getClipboard: () => ipcRenderer.invoke('perception:getClipboard'),
  },
  
  // 执行
  execution: {
    click: (x, y, button?) => ipcRenderer.invoke('execution:click', x, y, button),
    typeText: (text) => ipcRenderer.invoke('execution:typeText', text),
    pressKey: (key) => ipcRenderer.invoke('execution:pressKey', key),
    openApp: (bundleId) => ipcRenderer.invoke('execution:openApp', bundleId),
    closeApp: (bundleId) => ipcRenderer.invoke('execution:closeApp', bundleId),
  },
  
  // 状态
  state: {
    getCurrent: () => ipcRenderer.invoke('state:getCurrent'),
    onStateChange: (callback) => ipcRenderer.on('state:changed', callback),
  },
  
  // 学习
  learning: {
    getProfile: () => ipcRenderer.invoke('learning:getProfile'),
    getPatterns: () => ipcRenderer.invoke('learning:getPatterns'),
    setFeedback: (predictionId, correct) => ipcRenderer.invoke('learning:setFeedback', predictionId, correct),
  },
  
  // 配置
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },
  
  // 安全
  security: {
    checkOperation: (op, source) => ipcRenderer.invoke('security:check', op, source),
  },
  
  // MCP
  mcp: {
    connect: (url) => ipcRenderer.invoke('mcp:connect', url),
    disconnect: () => ipcRenderer.invoke('mcp:disconnect'),
    send: (message) => ipcRenderer.invoke('mcp:send', message),
    onMessage: (callback) => ipcRenderer.on('mcp:message', callback),
  }
});
```

#### 5. IPC 处理器
```
需要创建:
- src/main/ipc-handlers.ts - IPC 通信处理
```

**ipc-handlers.ts 要求**:
```typescript
// 为每个 preload 暴露的 API 实现对应的 ipcMain.handle
export function setupIpcHandlers(
  perception: PerceptionModule,
  execution: ExecutionModule,
  state: StateEngine,
  learning: LearningEngine,
  mcp: MCPHandler,
  security: SecurityGuard,
  config: ConfigStore
): void {
  // perception handlers
  // execution handlers
  // state handlers
  // learning handlers
  // config handlers
  // security handlers
  // mcp handlers
}
```

#### 6. Logger
```
需要创建:
- src/main/logger.ts - 日志系统
```

**logger.ts 要求**:
```typescript
// 使用 electron-log
// 支持: file, console, error
// 日志级别: debug, info, warn, error
// 文件轮转: maxSize 10MB, maxFiles 5
// 格式: [时间] [级别] [模块] 消息
```

#### 7. 模块导出文件 (index.ts)
```
需要创建:
- src/database/index.ts
- src/learning/index.ts
- src/mcp/index.ts
- src/security/index.ts
- src/state/index.ts
- src/prediction/index.ts
- src/ui/index.ts
```

每个 index.ts 导出该模块的所有公开接口。

#### 8. Renderer HTML
```
需要创建:
- src/renderer/index.html - 渲染进程入口
```

**index.html 要求**:
- 加载 companion.css
- 创建 companion-orb 元素
- 创建 companion-bubble 元素 (用于提示)
- 接收来自 main 的状态更新并渲染

#### 9. 主进程集成
```
需要更新:
- src/main/index.ts - 集成所有模块
```

**需要添加**:
- 创建 BrowserWindow 并加载 renderer
- 初始化所有模块
- 设置 IPC handlers
- 启动 MCP 连接 (可选)
- 启动状态机
- 启动学习引擎

### 🟡 增强模块 - 可选完善

#### 10. 主进程添加 Logger
在 `src/main/logger.ts` 创建日志模块，然后更新 `src/main/index.ts` 使用它。

#### 11. 更新 package.json
确保 dependencies 包含所有需要的包:
```json
{
  "dependencies": {
    "@computer-use/nut-js": "^4.2.0",
    "@electron-toolkit/preload": "^3.0.2",
    "@electron-toolkit/utils": "^4.0.0",
    "better-sqlite3": "^12.6.2",
    "dotenv": "^17.3.1",
    "electron-log": "^5.2.0",
    "electron-updater": "^6.3.9",
    "node-pty": "^1.1.0",
    "node-screenshots": "^0.2.8",
    "sharp": "^0.34.5",
    "ws": "^8.18.1"
  }
}
```

## 状态机设计

### 5 个状态
```typescript
enum CompanionState {
  STEALTH = 'stealth',      // 静默态 - 完全隐身，只学习不干预
  OBSERVING = 'observing',   // 观察态 - 记录行为，检测模式
  HINT = 'hint',             // 轻提示态 - 角落小光点，温柔提示
  ACTIVE = 'active',         // 主动态 - 主动提供服务
  RETREATING = 'retreating'   // 退场态 - 优雅退场动画
}
```

### 状态转换规则
```
STEALTH → OBSERVING:  attentionScore < 0.9 || focusScore < 0.8
STEALTH → HINT:       userRepeatedAction && predictionConfidence > 0.7
STEALTH → ACTIVE:     userRequestExplicit

OBSERVING → STEALTH:  attentionScore > 0.9 && focusScore > 0.8 && predictionConfidence < 0.5
OBSERVING → HINT:     userRepeatedAction && predictionConfidence > 0.6
OBSERVING → ACTIVE:   userRequestExplicit

HINT → STEALTH:       idleTimeSeconds > 60
HINT → ACTIVE:        userRequestExplicit || predictionConfidence > 0.85
HINT → RETREATING:    userIgnoredLastHint

ACTIVE → RETREATING:  idleTimeSeconds > 10 || (!userRequestExplicit && idleTimeSeconds > 5)

RETREATING → STEALTH: always (after animation)
```

## 学习引擎设计 (7天周期)

```typescript
class LearningEngine {
  day1_BasicCollection()     // 基础数据采集
  day2_TimePatternDiscovery() // 时序模式发现
  day3_findOperationPatterns() // 操作序列模式
  day4_IntentUnderstanding()  // 意图理解
  day5_AttentionModeling()    // 注意力建模
  day6_PredictionOptimization() // 预测优化
  day7_Personalization()      // 个性化调整
  
  predictApp(context)         // 预测下一个应用
  detectRepetition(recentOps) // 检测重复操作
  getUserProfile()            // 获取用户画像
  getPatterns()               // 获取学习到的模式
}
```

## Apple 风格 UI 设计

### 视觉形象
```
        ✦
       ◠‿◠    ← 可爱的圆形光点
        ✦

呼吸灯效果: 2s 周期
```

### 状态颜色
| 状态 | 颜色 | 透明度 |
|------|------|--------|
| STEALTH | 透明 | 0% |
| OBSERVING | #4A90D9 (淡蓝) | 30% |
| HINT | #FFD700 (黄) | 60% |
| ACTIVE | #FF6B35 (橙) | 80% |
| RETREATING | 渐变消失 | 动画 |

### 关键 CSS
```css
@keyframes breathing {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.85; }
}

.companion-orb {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, 
    rgba(255,255,255,0.8) 0%, 
    var(--state-color) 50%,
    transparent 70%);
  box-shadow: 0 0 20px var(--state-color);
  animation: breathing 2s ease-in-out infinite;
}
```

## MCP 协议设计

### 消息格式
```typescript
interface MCPMessage {
  id: string;           // 唯一 ID
  type: 'request' | 'response' | 'notification';
  method?: string;      // 请求方法名
  params?: any;         // 请求参数
  result?: any;         // 响应结果
  error?: { code: number; message: string }; // 错误
  timestamp: number;     // Unix ms 时间戳
}
```

### 工具命名空间
```
perception.* - 感知工具
execution.* - 执行工具
learning.* - 学习工具
config.* - 配置工具
```

## 安全设计

### SecurityGuard
- 高危操作白名单: terminal_execute, file_delete, file_overwrite, system_settings
- 可信来源: user_direct, hermes_agent
- 提示词注入检测模式

### PrivacyManager
- 敏感应用白名单: Safari, Chrome, Messages, Mail, FaceTime, 1Password
- 隐私模式开关
- 数据导出/删除

## 开发指令

1. **首先检查现有文件** - 确保不重复创建已存在的模块
2. **按顺序创建缺失文件** - 从最基础的开始
3. **保持代码风格一致** - 使用 ESM, TypeScript strict 模式
4. **添加适当的注释** - 关键逻辑添加中文注释
5. **确保类型安全** - 不要使用 any 类型
6. **错误处理** - 所有异步操作添加 try-catch

## 文件创建优先级

### 第一优先级 (核心依赖)
1. `src/mcp/ExecutionModule.ts` - 执行模块
2. `src/mcp/ToolDefinitions.ts` - 工具定义
3. `src/mcp/MCPHandler.ts` - MCP 处理器
4. `src/mcp/index.ts` - MCP 导出

### 第二优先级 (UI)
5. `src/renderer/styles/companion.css` - 样式
6. `src/ui/AppleStyleUI.ts` - UI 类
7. `src/ui/index.ts` - UI 导出
8. `src/renderer/index.html` - HTML 入口

### 第三优先级 (集成)
9. `src/preload/index.ts` - Preload 脚本
10. `src/main/ipc-handlers.ts` - IPC 处理
11. `src/main/logger.ts` - 日志模块
12. `src/main/index.ts` - 更新主进程集成

### 第四优先级 (整理)
13. 各模块的 index.ts 导出文件

## 代码风格指南

- 使用 ESM (import/export)
- TypeScript strict 模式
- 异步函数用 async/await
- 错误处理用 try-catch
- 日志使用 electron-log
- 关键逻辑添加中文注释
- 变量命名用 camelCase
- 类型命名用 PascalCase
- 常量命名用 UPPER_SNAKE_CASE

## 测试建议

创建后可以验证:
1. TypeScript 编译: `npx tsc --noEmit`
2. 检查 import 语句是否正确
3. 确保所有类型定义完整
4. 验证文件路径正确

---

开始开发吧！创建一个让人爱上的 AI 伴生系统！🚀
