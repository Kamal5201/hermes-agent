# Hermes Companion - 多端互通协议设计

## 愿景

Hermes 是一个真正的 AI 伴侣，不受设备限制。
主人可以在 Windows 上开始工作，在 macOS 上继续，在手机上查看状态。
**客户端只是外壳，Hermes 才是核心。**

---

## 一、核心架构

```
┌─────────────────────────────────────────────────────────┐
│                    Hermes Cloud                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │   状态同步   │  │   学习同步   │  │   预测同步   │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                         │                               │
│                    ┌────┴────┐                         │
│                    │  MQTT   │                         │
│                    │  Broker │                         │
│                    └────┬────┘                         │
└─────────────────────────┼───────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
   │ Windows  │     │  macOS  │     │ Mobile  │
   │  Client  │     │  Client │     │  Client │
   └──────────┘     └──────────┘     └──────────┘
```

---

## 二、同步数据类型

### 2.1 状态同步 (State Sync)
```typescript
interface DeviceState {
  deviceId: string;
  deviceName: string;
  platform: 'windows' | 'macos' | 'ios' | 'android';
  state: CompanionState;
  lastSync: number;
  batteryLevel?: number;
  isCharging?: boolean;
}

interface StateSyncMessage {
  type: 'state_sync';
  source: DeviceState;
  target?: string;  // 可选，指定目标设备
  timestamp: number;
}
```

### 2.2 学习同步 (Learning Sync)
```typescript
interface LearningData {
  userId: string;
  patterns: {
    timePatterns: TimePattern[];
    operationPatterns: OperationPattern[];
    habits: UserHabit[];
  };
  modelWeights: Float32Array;  // 加密传输
  lastUpdate: number;
}

interface LearningSyncMessage {
  type: 'learning_sync';
  direction: 'push' | 'pull' | 'merge';
  data: LearningData;
  conflictResolution: 'latest_wins' | 'merge' | 'manual';
}
```

### 2.3 预测同步 (Prediction Sync)
```typescript
interface PredictionCache {
  deviceId: string;
  predictions: Prediction[];
  expiresAt: number;
}
```

---

## 三、通信协议

### 3.1 WebSocket 长连接
```typescript
interface HermesConnection {
  url: string;           // wss://hermes.cloud/ws
  token: string;         // JWT 认证
  reconnect: boolean;   // 自动重连
  heartbeat: number;    // 心跳间隔 (30s)
}

// 消息格式
interface WSMessage {
  id: string;           // 消息唯一ID
  type: MessageType;    // 消息类型
  payload: unknown;     // 消息内容
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
}
```

### 3.2 消息类型
```typescript
enum MessageType {
  // 状态
  STATE_SYNC = 'state_sync',
  STATE_REQUEST = 'state_request',
  STATE_RESPONSE = 'state_response',
  
  // 学习
  LEARNING_PUSH = 'learning_push',
  LEARNING_PULL = 'learning_pull',
  LEARNING_MERGE = 'learning_merge',
  
  // 预测
  PREDICTION_REQUEST = 'prediction_request',
  PREDICTION_RESPONSE = 'prediction_response',
  
  // 系统
  HEARTBEAT = 'heartbeat',
  DEVICE_REGISTER = 'device_register',
  DEVICE_UNREGISTER = 'device_unregister',
}
```

---

## 四、设备注册流程

```
1. 新设备启动
       │
       ▼
2. 生成设备ID (UUID)
       │
       ▼
3. 连接 WebSocket
       │
       ▼
4. 发送 DEVICE_REGISTER
       │
       ▼
5. 服务器验证并返回 Token
       │
       ▼
6. 请求全量学习数据 (LEARNING_PULL)
       │
       ▼
7. 合并数据 (基于时间戳冲突解决)
       │
       ▼
8. 开始同步
```

---

## 五、安全设计

### 5.1 传输安全
- TLS 1.3 加密
- WebSocket over WSS
- Certificate Pinning (移动端)

### 5.2 数据安全
```typescript
// 本地数据加密
interface EncryptedData {
  algorithm: 'AES-256-GCM';
  iv: string;        // Base64
  data: string;      // Base64
  tag: string;       // 认证标签
}

// 模型权重加密传输
interface SecureModelTransfer {
  encryptedWeights: EncryptedData;
  keyId: string;     // 密钥ID
  signature: string; // 签名
}
```

### 5.3 隐私保护
- 最小化数据传输
- 本地优先 (Local-First)
- 用户数据不上云原则 (可选择)
- GDPR 合规

---

## 六、冲突解决

### 6.1 状态冲突
```typescript
// 规则: 最后写入胜出 (Last-Write-Wins)
// 但 ACTIVE 状态优先级最高

function resolveStateConflict(local: State, remote: State): State {
  if (local.state === 'ACTIVE' || remote.state === 'ACTIVE') {
    return local.state === 'ACTIVE' ? local : remote;
  }
  return local.timestamp > remote.timestamp ? local : remote;
}
```

### 6.2 学习数据冲突
```typescript
// 规则: 合并策略
// 时间模式: 取并集
// 操作模式: 频率累加
// 习惯: 最新胜出

function mergeLearningData(local: LearningData, remote: LearningData): LearningData {
  return {
    ...local,
    patterns: {
      timePatterns: [...new Set([...local.timePatterns, ...remote.timePatterns])],
      operationPatterns: mergeOperationPatterns(local.operationPatterns, remote.operationPatterns),
      habits: resolveHabits(local.habits, remote.habits)
    },
    lastUpdate: Date.now()
  };
}
```

---

## 七、离线支持

### 7.1 本地优先原则
```
写入 → 本地 → 同步到云
         │
         ▼
   如果离线 → 队列等待
         │
         ▼
   恢复在线 → 批量同步
```

### 7.2 离线队列
```typescript
interface OfflineQueue {
  pendingMessages: WSMessage[];
  maxRetries: number;
  retryDelay: number;  // 指数退避
}
```

---

## 八、带宽优化

### 8.1 增量同步
```typescript
// 只同步变化的部分
interface DeltaSync {
  lastSyncTimestamp: number;
  changes: {
    added: Change[];
    modified: Change[];
    deleted: string[];  // IDs
  };
}
```

### 8.2 压缩
- 消息体: LZ4 压缩
- 模型权重: 量化 + 压缩

---

## 九、技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 消息Broker | MQTT | 轻量，低功耗 |
| WebSocket | ws (Node) | 高性能 |
| 数据库 | SQLite (本地) + PostgreSQL (云) | 本地优先 |
| 缓存 | Redis | 高性能缓存 |
| 认证 | JWT | 无状态 |
| 加密 | AES-256-GCM | 安全标准 |

---

## 十、路线图

### Phase 1: 基础同步 (Sprint 2)
- [ ] 设备注册
- [ ] 状态同步
- [ ] WebSocket 连接

### Phase 2: 学习同步 (Sprint 3)
- [ ] 学习数据同步
- [ ] 冲突解决
- [ ] 离线支持

### Phase 3: 完整功能 (Sprint 4)
- [ ] 预测同步
- [ ] 安全加固
- [ ] 性能优化

---

*设计文档 v1.0 - Hermes Agent*
