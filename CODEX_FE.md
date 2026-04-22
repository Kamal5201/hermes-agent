# Hermes Companion - UI/UX 开发提示词

## 项目路径
```
/lzcapp/document/hermes-companion/
```

## 背景
Hermes Companion 是一个 AI 伴生系统，已完成核心模块。需要开发 UI 组件。

---

## 任务清单

### 任务1: 优化 CSS 动画

**文件**: `src/renderer/styles/companion.css`

**当前问题**: 呼吸动画一直运行，造成视觉干扰

**修改要求**:

```css
/* 动画默认禁用 */
.companion-orb {
  animation: none;
  transition: opacity 300ms ease, box-shadow 300ms ease;
}

/* 仅在 HINT 和 ACTIVE 状态启用 */
.state-hint .companion-orb,
.state-active .companion-orb {
  animation: breathing 2s ease-in-out infinite;
}

/* OBSERVING 极低存在感 */
.state-observing .companion-orb {
  opacity: 0.15 !important;
}

/* 静默状态完全隐藏 */
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

### 任务2: 更新 index.html

**文件**: `src/renderer/index.html`

**修改要求**:
1. 添加健康检查显示区域
2. 添加学习进度报告触发机制
3. 添加状态切换的视觉反馈

```javascript
// 在 script 中添加
const healthStatus = {
  database: true,
  perception: true,
  state: 'stealth',
  learning: { day: 1, progress: 0.1 }
};

function updateHealthUI(status) {
  // 更新健康状态显示
  const indicator = document.getElementById('health-indicator');
  if (indicator) {
    indicator.style.opacity = status.overall ? '0.3' : '1';
  }
}

function showLearningReport(report) {
  // 显示学习进度报告
  const bubble = document.querySelector('.companion-bubble');
  if (bubble) {
    bubble.innerHTML = `
      <div class="learning-report">
        <h4>${report.title}</h4>
        <ul>${report.insights.map(i => `<li>${i}</li>`).join('')}</ul>
      </div>
    `;
    bubble.classList.add('visible');
  }
}
```

---

### 任务3: 创建 LearningReport 组件

**文件**: `src/renderer/components/LearningReport.ts` (新建)

```typescript
interface LearningInsight {
  type: 'time_pattern' | 'app_usage' | 'operation' | 'habit';
  text: string;
  confidence: number;
}

interface LearningReportData {
  title: string;
  insights: LearningInsight[];
  overallConfidence: number;
  day: number;
}

class LearningReport {
  private container: HTMLElement | null = null;
  
  show(data: LearningReportData): void {
    // 创建报告容器
    // 显示标题 + 洞察列表
    // 3秒后自动隐藏
  }
  
  hide(): void {
    // 隐藏报告
  }
  
  private createInsightIcon(type: LearningInsight['type']): string {
    const icons = {
      'time_pattern': '🕐',
      'app_usage': '📱',
      'operation': '🔧',
      'habit': '✨'
    };
    return icons[type] || '💡';
  }
}
```

---

### 任务4: 创建 HintBubble 组件

**文件**: `src/renderer/components/HintBubble.ts` (新建)

```typescript
interface HintConfig {
  text: string;
  duration?: number; // ms，默认 3000
  action?: {
    label: string;
    callback: () => void;
  };
}

class HintBubble {
  private bubble: HTMLElement | null = null;
  
  show(config: HintConfig): void {
    // 显示提示气泡
    // 气泡内容: 图标 + 文字 + (可选)操作按钮
    // 自动隐藏或手动点击操作后隐藏
  }
  
  hide(): void {
    // 隐藏气泡
  }
  
  updateText(text: string): void {
    // 更新气泡文字
  }
}
```

---

### 任务5: 创建 ConfigPanel 组件 (可选)

**文件**: `src/renderer/components/ConfigPanel.ts` (新建)

```typescript
interface PrivacyLevel {
  id: 'conservative' | 'balanced' | 'full';
  label: string;
  description: string;
}

class ConfigPanel {
  private levels: PrivacyLevel[] = [
    { id: 'conservative', label: '保守', description: '仅时间+应用统计' },
    { id: 'balanced', label: '平衡', description: '+窗口标题+操作模式' },
    { id: 'full', label: '完整', description: '+预测建议' }
  ];
  
  show(): void {
    // 显示配置面板
    // 包含: 隐私级别、感知开关、学习进度
  }
  
  hide(): void {
    // 隐藏面板
  }
  
  onPrivacyChange(level: PrivacyLevel['id']): void {
    // 保存隐私设置
  }
}
```

---

## 设计规范

### Apple Human Interface Guidelines

| 元素 | 规范 |
|------|------|
| 字体 | SF Pro Display, Helvetica Neue |
| 圆角 | 12-18px |
| 间距 | 8px 基准 |
| 动画 | 200-300ms, ease-out |
| 阴影 | 0 18px 40px rgba(8, 12, 22, 0.28) |

### 颜色系统

```css
:root {
  /* 背景 */
  --bg-primary: rgba(18, 24, 38, 0.86);
  --bg-secondary: rgba(33, 39, 58, 0.72);
  
  /* 状态色 */
  --observing: rgba(74, 144, 217, 0.3);
  --hint: rgba(255, 215, 0, 0.6);
  --active: rgba(255, 107, 53, 0.8);
  
  /* 文字 */
  --text-primary: rgba(255, 255, 255, 0.96);
  --text-secondary: rgba(255, 255, 255, 0.72);
  
  /* 边框 */
  --border: rgba(255, 255, 255, 0.28);
}
```

### 状态切换规范

| 状态 | 光点 | 呼吸 | 透明度 |
|------|------|------|--------|
| STEALTH | 隐藏 | 无 | 0% |
| OBSERVING | 显示 | 无 | 15% |
| HINT | 显示 | 有 | 60% |
| ACTIVE | 显示 | 有 | 80% |
| RETREATING | 消失动画 | 无 | 渐变至0% |

---

## 验证要求

1. CSS 语法检查通过
2. 动画流畅 (60fps)
3. 响应时间 < 100ms
4. 无控制台错误

---

开始 UI 开发！
