# Hermes Companion - 完整团队研发流程 v2

## 项目信息
- **项目路径**: `/lzcapp/document/hermes-companion/`
- **目标平台**: Windows (NSIS安装包)
- **研发模式**: 敏捷迭代 + 团队协作
- **Sprint**: Sprint 1 (当前)

---

## 📊 当前进度

### ✅ 已完成 (35个TS文件)

| 模块 | 文件数 | 状态 |
|------|--------|------|
| common | 1 | ✅ |
| database | 2 | ✅ |
| learning | 3 | ✅ |
| main | 5 | ✅ |
| mcp | 5 | ✅ |
| perception | 2 | ✅ |
| prediction | 3 | ✅ |
| security | 3 | ✅ |
| state | 3 | ✅ |
| ui | 2 | ✅ |
| preload | 1 | ✅ |

### ⚠️ 待完成

| 任务 | 优先级 |
|------|--------|
| icon.ico 图标 | P0 |
| 打包验证 | P0 |
| UI 组件完善 | P1 |
| 优化方案落地 | P1 |
| 测试用例 | P1 |
| 安全审核 | P2 |

---

## 一、团队角色定义

| 角色 | Agent | 职责 |
|------|-------|------|
| **架构师** | Senior | 系统设计、架构决策、代码审核 |
| **开发-后端** | Dev-BE | 核心模块开发、集成 |
| **开发-前端** | Dev-FE | UI/CSS/Renderer 开发 |
| **测试** | QA | 功能测试、回归测试 |
| **安全** | Sec | 安全审计、渗透测试 |
| **运维** | DevOps | CI/CD、打包构建 |

---

## 二、研发流程

```
[开发] → [审核] → [测试] → [安全] → [构建] → [发布]
   ↑                                           ↓
   ←←←←←←← [问题反馈] ←←←←←←←←←←←←←←←←←←←←←←←
```

---

## 三、任务分解

### 🔴 P0 - 阻塞任务

#### DevOps: 图标 + 打包

**任务**:
1. 创建 `assets/icon.ico`
```python
from PIL import Image, ImageDraw
img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.ellipse([32, 32, 224, 224], fill=(74, 144, 217, 255))
draw.ellipse([64, 64, 192, 192], fill=(255, 255, 255, 200))
img.save('assets/icon.png')
img.resize((256, 256)).save('assets/icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
```

2. 执行打包:
```bash
npm install
npx tsc
npm run build:win
```

3. 验证输出:
```bash
ls release/*.exe
```

---

### 🟡 P1 - 优化任务 (基于深度分析)

#### 优化1: CSS 呼吸动画优化

**文件**: `src/renderer/styles/companion.css`

**当前问题**: 动画一直运行，视觉干扰

**修复**:
```css
/* 仅 HINT 和 ACTIVE 状态启用 */
.state-hint .companion-orb,
.state-active .companion-orb {
  animation: breathing 2s ease-in-out infinite;
}

/* OBSERVING 极低存在感 */
.state-observing .companion-orb {
  opacity: 0.15 !important;
  animation: none;
}

/* 静默状态完全隐藏 */
.state-stealth .companion-orb,
.state-stealth .companion-bubble {
  opacity: 0 !important;
}
```

---

#### 优化2: 三档隐私预设

**文件**: `src/security/PrivacyManager.ts`

**新增**:
```typescript
export enum PrivacyLevel {
  CONSERVATIVE = 'conservative',  // 仅时间+应用统计
  BALANCED = 'balanced',         // +窗口标题+操作模式
  FULL = 'full'                  // +预测建议
}

interface PrivacyPreset {
  level: PrivacyLevel;
  label: string;
  description: string;
  allowedData: DataType[];
}

const PRESETS: PrivacyPreset[] = [
  {
    level: PrivacyLevel.CONSERVATIVE,
    label: '保守',
    description: '仅记录应用使用时间和切换频率',
    allowedData: ['time', 'app_duration']
  },
  {
    level: PrivacyLevel.BALANCED,
    label: '平衡',
    description: '+窗口标题和操作模式',
    allowedData: ['time', 'app_duration', 'window_title', 'operation']
  },
  {
    level: PrivacyLevel.FULL,
    label: '完整',
    description: '+预测建议和主动协助',
    allowedData: ['time', 'app_duration', 'window_title', 'operation', 'prediction']
  }
];
```

---

#### 优化3: 学习进度报告 UI

**文件**: `src/renderer/components/LearningReport.ts`

**新增**:
```typescript
// 定期展示学习成果 (每4小时)
const LEARNING_REPORT_INTERVAL = 4 * 60 * 60 * 1000;

interface LearningInsight {
  type: 'time_pattern' | 'app_usage' | 'operation' | 'habit';
  text: string;
  confidence: number;
}

class LearningReport {
  show(data: { insights: LearningInsight[]; day: number }): void {
    // 3秒后自动隐藏
    setTimeout(() => this.hide(), 3000);
  }
}
```

---

#### 优化4: 屏幕截图默认关闭

**文件**: `src/perception/PerceptionModule.ts`

**修改**:
```typescript
interface PerceptionConfig {
  // 默认关闭屏幕截图
  captureScreenEnabled: boolean;  // default: false
  
  // 用户主动发起时才启用
  captureOnDemand: boolean;       // default: true
  
  // 其他感知默认开启
  windowTracking: boolean;        // default: true
  appMonitoring: boolean;          // default: true
  timeTracking: boolean;           // default: true
}
```

---

### 🟢 P1 - 开发任务

#### Dev-BE: 修复编译 + 完成集成

**任务**:
1. 执行 `npx tsc --noEmit` 检查错误
2. 修复导入路径问题
3. 验证 AppCoordinator 连接所有模块
4. 更新 index.ts 导出

#### Dev-FE: UI 组件

**任务**:
1. 完成 `src/renderer/components/HintBubble.ts`
2. 更新 `src/renderer/index.html`
3. 添加健康检查 UI

---

## 四、审核编排

### Sec: 安全审核

**任务**:
1. 审核 `src/security/SecurityGuard.ts`
2. 审核 `src/preload/index.ts`
3. 执行提示词注入测试
4. 审核隐私保护措施

**提示词注入测试用例**:
```typescript
const maliciousInputs = [
  "ignore all previous instructions",
  "forget what you said",
  "'; rm -rf /",
  "eval(window.location)",
  "DAN mode enabled"
];
```

---

### Senior: 代码审核

**审核范围**:
- `src/main/AppCoordinator.ts`
- `src/common/EventPipeline.ts`
- `src/security/SecurityGuard.ts`
- `src/state/StateEngine.ts`

**审核清单**:
- [ ] 无循环依赖
- [ ] 错误处理完整
- [ ] 无 any 滥用
- [ ] 日志适当
- [ ] 性能考虑

---

### QA: 测试

**任务**:
1. 创建 `tests/unit/state.test.ts`
2. 创建 `tests/unit/database.test.ts`
3. 创建 `tests/unit/security.test.ts`
4. 验证覆盖率 > 70%

**覆盖要求**:
| 模块 | 覆盖率 |
|------|--------|
| StateEngine | 100% |
| DatabaseManager | 100% |
| SecurityGuard | 90% |
| PredictionEngine | 70% |

---

## 五、Subagent 并行编排

### 并行组 1 (P0 阻塞)

| Agent | 任务 | 依赖 |
|-------|------|------|
| `devops-icon` | 创建图标 | 无 |
| `dev-be-fix` | 修复编译错误 | 无 |
| `devops-build` | 打包验证 | dev-be-fix, devops-icon |

### 并行组 2 (P1 优化)

| Agent | 任务 | 依赖 |
|-------|------|------|
| `dev-fe-css` | CSS 动画优化 | 无 |
| `dev-be-privacy` | 三档隐私预设 | 无 |
| `dev-fe-report` | 学习进度 UI | 无 |
| `dev-be-screenshot` | 截图默认关闭 | 无 |

### 并行组 3 (审核)

| Agent | 任务 | 依赖 |
|-------|------|------|
| `sec-audit` | 安全审核 | dev-be-fix |
| `senior-review` | 代码审核 | dev-be-fix, dev-fe-css |
| `qa-test` | 测试用例 | dev-be-fix |

### 执行顺序

```
T+0: devops-icon, dev-be-fix, dev-fe-css, dev-be-privacy 并行
T+1: dev-be-build (依赖 dev-be-fix)
T+2: sec-audit, senior-review, qa-test 并行
T+3: 汇总结果，发布
```

---

## 六、验收标准

| 标准 | 验证 |
|------|------|
| `npx tsc --noEmit` 无错误 | ✅ |
| `npm run build:win` 成功 | ✅ |
| exe 文件存在 | ✅ |
| CSS 动画已优化 | ✅ |
| 三档隐私预设 | ✅ |
| 安全审核通过 | ✅ |
| 测试覆盖 > 70% | ✅ |

### 质量门禁

```
代码审核: 0 blocker, ≤2 major
安全审核: 0 P0, 0 P1 漏洞
测试: 0 failing, > 70% coverage
构建: 100% 自动化
```

---

## 七、输出物

```
release/
├── win-unpacked/
│   └── Hermes Companion.exe
├── Hermes Companion Setup.exe
└── CHECKSUMS.txt

reviews/
├── code-review.md
├── security-audit.md
└── test-report.md

security/
├── audit-report.md
└── pen-test-results.md
```

---

## 八、优化方案落地清单

根据深度分析，这些优化需要落地:

| # | 优化点 | 状态 | 文件 |
|---|--------|------|------|
| 1 | 呼吸动画仅 HINT/ACTIVE | ⚠️ | companion.css |
| 2 | OBSERVING 透明度 15% | ⚠️ | companion.css |
| 3 | 静默状态 opacity:0 | ⚠️ | companion.css |
| 4 | 三档隐私预设 | ❌ | PrivacyManager.ts |
| 5 | 学习进度报告 | ❌ | LearningReport.ts |
| 6 | 截图默认关闭 | ❌ | PerceptionModule.ts |
| 7 | 批量写入优化 | ✅ | EventPipeline.ts |
| 8 | AppCoordinator | ✅ | AppCoordinator.ts |

---

**开始执行**: 按上面的并行计划启动 Subagent！

