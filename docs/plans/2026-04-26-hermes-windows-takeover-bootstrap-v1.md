# Hermes → Windows 全接管架构 Bootstrap v1

> 历史说明：这是一份编写于 2026-04-26 的 bootstrap 计划 / 实现草案，用于记录当时的落地思路；其中内容不应视为当前代码状态的唯一事实来源，使用时请结合仓库现状重新核对。

> 使用说明：这份文档适合作为分阶段落地的历史规划参考；若要继续实施，应先结合当前仓库状态重新切 task，并为每一阶段补上可验证的 smoke check。

## 0. 这份计划解决什么

目标不是再做一份“会说但不会动”的方案，而是把 **Hermes（脑）→ Windows（手）** 这条链路落成第一版真正可跑的执行架构：

- Hermes 负责 **理解用户目标 / 拆任务 / 路由 / 审核 / 恢复**
- Windows Worker 负责 **真实执行浏览器 / 桌面动作**
- 执行层坚持 **浏览器可结构化就绝不坐标乱点**
- 整个链路必须带 **checkpoint / wait_login / blocked / failed_retryable / resume**
- 禁止靠固定 sleep 硬等，改为 **事件驱动 + 轮询探测 + 超时回退**

---

## 1. 现状（基于当前仓库真实文件）

以下内容记录的是该计划编写时对仓库状态的快照性判断：

### 已有基础

1. `src/main/AppCoordinator.ts`
   - 已经是主协调器，适合继续承载“任务路由 + 生命周期管理”。
2. `src/main/ControlServer.ts`
   - 已经暴露本地 HTTP 控制接口：`/health`、`/inbox`、`/command`
   - 很适合作为 Windows Worker 本机控制入口。
3. `src/mcp/ExecutionModule.ts`
   - 已有本地鼠标、键盘、滚动、热键、打开 App 等执行能力。
4. `src/mcp/MCPHandler.ts`
   - 已有 MCP 协议处理与连接管理基础，不需要推倒重来。

### 当前明显短板

1. `src/remote/RemoteAccess.ts`
   - 现在还是 mock：发现设备、连接、发命令都只是模拟。
   - 这正是“全接管”目前没落地的关键断点。
2. 浏览器执行层还没有形成明确的 **主路径 / 回退路径 / 状态机**。
3. 缺少一套对远端 Windows Worker 的：
   - 健康检查
   - 能力探测
   - 任务队列
   - 任务状态持久化
   - 可恢复执行
4. 缺少针对真实链路的最小 smoke 脚本。

---

## 2. v1 核心设计决策

### 决策 A：Linux 上的 Hermes 只做“脑”，不要抢 Windows 的手

Hermes 负责：
- 意图理解
- 任务拆分
- 选择执行策略
- 异常分类
- checkpoint / resume
- 结果审核与汇总

Windows 负责：
- 浏览器实际打开 / 导航 / DOM 抓取 / 点击
- 桌面 GUI 动作
- 截图 / 快照 / 焦点切换

**原因**：这样可以把高延迟、依赖桌面会话、依赖登录态的动作全部留在 Windows 用户会话里执行，避免 Linux 远端脑子去“假装本地桌面”。

### 决策 B：浏览器优先，桌面兜底

执行优先级固定为：

1. **Browser structured path**
   - DevTools / CDP / Playwright / MCP 的结构化 DOM/Snapshot/Scrape 能拿到就优先
2. **Browser visual path**
   - 页面截图 + OCR / 视觉定位
3. **Desktop fallback path**
   - 坐标点击 / 键鼠操作 / 窗口级恢复

**原则**：
- 能读 DOM，不看图
- 能看图，不乱点
- 必须乱点时，也要先 screenshot 再执行

### 决策 C：一切长任务必须任务化，而不是“单次 RPC”

不要把复杂任务做成一次 `/command` 调用硬跑到底。

统一改成：
- 创建任务
- Worker 执行
- 中途状态更新
- 遇到 `wait_login` / `blocked` / `failed_retryable`
- 可恢复继续

### 决策 D：Session 0 不可接受，必须绑定交互式用户会话

Windows Worker 的 GUI/浏览器执行只能在 **真实登录桌面会话** 里进行。

这条是硬约束，不是建议。

---

## 3. v1 目标架构图

```text
┌─────────────────────────────────────────────┐
│ Hermes Brain (Linux / Server)               │
│  - Intent parsing                           │
│  - Plan / review / retry policy             │
│  - Multi-subagent orchestration             │
│  - Checkpoint + result aggregation          │
└─────────────────┬───────────────────────────┘
                  │ task envelope / status / artifacts
                  ▼
┌─────────────────────────────────────────────┐
│ Windows Control Plane                       │
│  - RemoteAccess (real, not mock)            │
│  - WindowsMcpHttpClient                     │
│  - CapabilityProbe                          │
│  - TaskRouter                               │
│  - TaskQueue / SessionStore                 │
└──────────────┬───────────────┬──────────────┘
               │               │
               │               └─────────────┐
               ▼                             ▼
┌────────────────────────────┐   ┌────────────────────────────┐
│ Browser Executor           │   │ Desktop Executor           │
│ - open / navigate          │   │ - click / type / hotkey    │
│ - snapshot / scrape        │   │ - window focus recovery    │
│ - structured extraction    │   │ - screenshot fallback      │
└────────────────────────────┘   └────────────────────────────┘
```

---

## 4. 任务状态模型（必须和你现有原型语义对齐）

```ts
export type WindowsTaskStatus =
  | 'queued'
  | 'routing'
  | 'running'
  | 'wait_login'
  | 'blocked'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'completed'
  | 'cancelled';
```

### 状态解释

- `queued`：已创建，尚未路由
- `routing`：正在挑选执行器 / 能力探测
- `running`：已进入执行
- `wait_login`：需要人补登录，不继续乱跑
- `blocked`：页面风险、验证、权限问题或策略禁止
- `failed_retryable`：网络抖动、页面偶发、窗口焦点丢失，可重试
- `failed_terminal`：明确不可恢复
- `completed`：任务完成且输出已落盘
- `cancelled`：人工取消

### 任务最小结构

```ts
export interface TaskEnvelope {
  id: string;
  kind: 'browser' | 'desktop' | 'hybrid';
  target: 'windows';
  intent: string;
  priority: 'high' | 'normal' | 'low';
  createdAt: number;
  updatedAt: number;
  status: WindowsTaskStatus;
  checkpoint?: Record<string, unknown>;
  constraints?: {
    interactiveSessionRequired?: boolean;
    browserPreferred?: boolean;
    maxRetries?: number;
    timeoutMs?: number;
  };
  artifacts?: {
    screenshots?: string[];
    snapshots?: string[];
    logs?: string[];
  };
}
```

---

## 5. 第一版落地：按文件拆解，不搞大爆炸

## Task 1 — 把 `RemoteAccess` 从 mock 改成“适配器注册中心”

### 修改 / 新增文件

- **修改** `src/remote/RemoteAccess.ts`
- **新增** `src/remote/contracts/TaskEnvelope.ts`
- **新增** `src/remote/contracts/TaskResult.ts`
- **新增** `src/remote/adapters/RemoteAdapter.ts`
- **新增** `src/remote/adapters/WindowsMcpAdapter.ts`

### 目标

`RemoteAccess` 不再自己假装能发现/连接设备，而是：
- 维护设备注册表
- 根据平台与能力选择 adapter
- 对外暴露统一接口：
  - `probe()`
  - `connect()`
  - `submitTask()`
  - `getTask()`
  - `cancelTask()`

### 最小接口建议

```ts
export interface RemoteAdapter {
  readonly name: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  probe(): Promise<AdapterProbeResult>;
  connect(deviceId: string): Promise<RemoteSession>;
  submitTask(task: TaskEnvelope): Promise<{ taskId: string }>;
  getTask(taskId: string): Promise<TaskEnvelope | null>;
  cancelTask(taskId: string): Promise<void>;
}
```

### 验证

```bash
# from the repo root
npx tsc --noEmit
npm run lint
```

---

## Task 2 — 增加真正可用的 Windows MCP HTTP 客户端

### 新增文件

- **新增** `src/remote/windows/WindowsMcpHttpClient.ts`
- **新增** `src/remote/windows/WindowsCapabilityProbe.ts`
- **新增** `src/remote/windows/WindowsSessionHealth.ts`

### 目标

把当前已经被验证可连的 Windows MCP HTTP 端点纳入正式控制面。

客户端最少支持：
- `initialize()`
- `listTools()`
- `callTool(name, args)`
- 自动保留 `mcp-session-id`
- 请求超时与重试
- 统一错误分类

### 必须支持的能力探测

```ts
export interface WindowsCapabilities {
  screenshot: boolean;
  snapshot: boolean;
  scrape: boolean;
  click: boolean;
  type: boolean;
  powershell: boolean;
  process: boolean;
  interactiveDesktopLikely: boolean;
}
```

### 关键规则

- 没有 `Screenshot` / `Snapshot` / `Click` / `Type` 的 worker，不进入“全接管”执行池
- 探测结果要缓存，但必须可手动刷新
- 如果探测显示疑似 Session 0 / 非交互桌面，状态直接标成 `blocked`

### 验证

新增一个简单 Node 脚本：
- **新增** `scripts/smoke-windows-mcp.js`

脚本至少验证：
1. initialize
2. tools/list
3. Screenshot
4. 输出 JSON 结果摘要

运行：

```bash
# from the repo root
node scripts/smoke-windows-mcp.js
```

---

## Task 3 — 在控制面里引入任务队列与 checkpoint

### 新增文件

- **新增** `src/remote/TaskQueue.ts`
- **新增** `src/remote/CheckpointStore.ts`
- **新增** `src/remote/TaskRouter.ts`
- **新增** `src/remote/TaskPolicy.ts`

### 修改文件

- **修改** `src/remote/RemoteAccess.ts`
- **修改** `src/main/AppCoordinator.ts`

### 目标

把“发命令”升级成“发任务”。

最低要实现：
- 任务创建
- 状态更新
- checkpoint 写入
- 任务恢复
- 重试预算
- 结果归档路径

### 重试策略

- `failed_retryable`
  - 允许指数退避重试
  - 默认 2~3 次
- `wait_login`
  - 不自动重试
  - 需要外部事件恢复
- `blocked`
  - 直接停住，等待策略决策或人工处理

### 落盘建议

Windows Worker 的任务产物落到：

```text
artifacts/windows-tasks/<task-id>/
  task.json
  checkpoints.jsonl
  latest-screenshot.png
  snapshots/
  logs/
  result.json
```

---

## Task 4 — 建 Browser-first 的执行链，不要一上来就坐标点击

### 新增文件

- **新增** `src/remote/executors/BrowserFirstExecutor.ts`
- **新增** `src/remote/executors/DesktopFallbackExecutor.ts`
- **新增** `src/remote/executors/ExecutionClassifier.ts`

### 目标

把执行链固定成：

1. **Browser structured**
   - 打开页面
   - DOM / Snapshot / Scrape
   - 结构化定位元素或数据
2. **Browser visual fallback**
   - 截图
   - OCR / 视觉定位（v1 可以先只做截图产物和人工可读诊断，不强行引 OCR）
3. **Desktop fallback**
   - 只在前两层失败后才允许坐标/键鼠

### v1 最重要的现实约束

- 第一版不追求“万能桌面智能体”
- 第一版只要把 **浏览器任务主链路** 打通就已经很值钱
- OCR 可以先不写死到主路径，先保留接口与截图产物

### 建议分类器输出

```ts
export type ExecutionPath =
  | 'browser_structured'
  | 'browser_visual'
  | 'desktop_fallback';
```

---

## Task 5 — 把 AppCoordinator 接成真正的“大脑入口”

### 修改文件

- **修改** `src/main/AppCoordinator.ts`
- **修改** `src/main/ControlServer.ts`

### 目标

让 `AppCoordinator` 真正知道：
- 当前有哪些远端 Windows worker
- 每个 worker 当前是否健康
- 是否具备浏览器执行能力
- 当前有哪些任务在跑
- 哪些任务处于 `wait_login` / `blocked`

### ControlServer 第一版新增接口建议

在现有 `/command` 之外，增加：

- `GET /workers`
- `GET /tasks`
- `GET /tasks/:id`
- `POST /tasks`
- `POST /tasks/:id/cancel`
- `POST /tasks/:id/resume`

### 设计原则

- `ControlServer` 只负责 IO 和协议层
- 任务编排逻辑放到 `AppCoordinator + RemoteAccess + TaskRouter`
- 不要把业务路由散落到 HTTP handler 里

---

## Task 6 — 把“安全闸门”做成架构，不靠模型良心

### 修改 / 新增文件

- **修改** `src/main/AppCoordinator.ts`
- **修改** `src/main/ControlServer.ts`
- **新增** `src/remote/ActionGuard.ts`

### 必须分级

#### 自动执行（默认允许）
- 打开浏览器
- 新开标签页
- 页面导航
- 截图
- 读取 DOM / Snapshot / Scrape
- 非 destructive 的输入与点击

#### 需要确认
- 文件删除
- 系统设置修改
- 安装 / 卸载
- 注册表写入
- 高风险 PowerShell
- 跨账户/权限边界动作

#### 默认拒绝
- 未声明来源的外部脚本执行
- 不可解释的高危命令拼接
- 由网页内容直接生成并立即执行的系统命令

### 关键点

安全闸门不只在 LLM 侧判断，而是在 `ActionGuard` 里做硬规则分类。

---

## Task 7 — 补一条从 0 到 1 的 smoke path

### 新增文件

- **新增 / 落地** `scripts/smoke-windows-mcp.js`（最终不单独保留 `scripts/smoke-windows-worker.js` 包装器）

### 这个脚本必须验证的 7 件事

1. 能连到 Windows worker
2. 能完成 capability probe
3. 能创建一个 `browser` 任务
4. 任务能进入 `running`
5. 如果缺登录态，能稳定落到 `wait_login`
6. 如果成功，能输出 screenshot / snapshot / result
7. 全流程输出总耗时

### CLI 建议

```bash
node scripts/smoke-windows-mcp.js --target <worker-id> --intent "打开 Chrome 并访问 about:blank"
```

---

## 6. 第一版建议新增文件总表

```text
src/remote/contracts/TaskEnvelope.ts
src/remote/contracts/TaskResult.ts
src/remote/adapters/RemoteAdapter.ts
src/remote/adapters/WindowsMcpAdapter.ts
src/remote/windows/WindowsMcpHttpClient.ts
src/remote/windows/WindowsCapabilityProbe.ts
src/remote/windows/WindowsSessionHealth.ts
src/remote/TaskQueue.ts
src/remote/CheckpointStore.ts
src/remote/TaskRouter.ts
src/remote/TaskPolicy.ts
src/remote/ActionGuard.ts
src/remote/executors/BrowserFirstExecutor.ts
src/remote/executors/DesktopFallbackExecutor.ts
src/remote/executors/ExecutionClassifier.ts
scripts/smoke-windows-mcp.js
```

---

## 7. 第一版明确不做的东西

这些先别一口气吞：

- 多 Windows worker 的复杂负载均衡
- OCR 大一统平台能力
- 任意桌面 App 的通用操作 DSL
- 完整自动登录体系
- 自愈所有反爬/风控页
- 云端统一任务调度平台

第一版只做：

**一个 Windows worker、一个真实浏览器主链、一个任务系统、一个可恢复状态机。**

这已经足够让 Hermes 从“能想”走到“真能开始干”。

---

## 8. 验收标准（必须可验证，不靠嘴）

满足以下 6 条才算 v1 真正启动成功：

1. `RemoteAccess.ts` 不再包含 mock 发现/假连接/假执行路径
2. 能通过 `WindowsMcpHttpClient` 对真实 worker 做 initialize + tools/list + Screenshot
3. 能创建远端 task，并查询 task 状态
4. `wait_login / blocked / failed_retryable / completed` 至少覆盖其中 3 类真实状态
5. 每个 task 都会落盘产物（日志 / 截图 / 结果）
6. `scripts/smoke-windows-mcp.js` 能跑出一条可读总结

---

## 9. 建议的实现顺序（严格按这个来）

1. **Task 1**：RemoteAccess 改为 adapter registry
2. **Task 2**：Windows MCP HTTP client + capability probe
3. **Task 3**：task queue + checkpoint
4. **Task 4**：browser-first executor chain
5. **Task 5**：AppCoordinator / ControlServer 接线
6. **Task 6**：ActionGuard
7. **Task 7**：smoke script

不要先做大而全 GUI agent。
先把 **“Hermes 发任务 → Windows 执行 → 状态回来 → 结果可查”** 这条主骨架打通。

---

## 10. 我对这版 bootstrap 的判断

这版最关键的不是“聪明”，而是 **把控制权从 mock 和一次性命令，升级成一个有状态、有恢复、有主路径的执行面**。

一句话总结：

> 先让 Hermes 真正拥有一只可控、可恢复、可观察的 Windows 手，再谈更复杂的通用 AI 桌面接管。
