# Hermes Companion

> 你的 AI 伴侣，懂你，但不打扰你。

Hermes Companion 是一个智能桌面伴侣 AI，设计理念来自苹果的极简主义 —— **最好的设计是感受不到的设计**。

---

## 🌟 核心特性

### 🎯 智能感知
- 窗口和应用切换追踪
- 时间模式识别
- 操作习惯学习

### 🔒 隐私优先
- 三档隐私预设 (保守/平衡/信任)
- 屏幕截图默认关闭
- 敏感应用自动过滤
- 数据可导出、可删除

### 💡 主动预测
- 三级预测引擎 (快/中/慢)
- 置信度校准
- 仅在高置信度时主动干预

### 🎨 Apple 风格 UI
- 暗色主题
- 呼吸动画
- 五态存在 (静默→观察→提示→主动→退场)

### 🌐 多端同步
- Windows + macOS + Mobile
- 本地优先，离线支持
- 冲突自动解决

---

## 🚀 快速开始

### 环境要求
- Node.js 20+
- Windows 10+ / macOS 12+

### 安装

```bash
# 克隆项目
git clone https://github.com/your-org/hermes-companion.git
cd hermes-companion

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建 Windows 安装包
npm run build:win
```

### 构建产物

```
release/
├── Hermes Companion Setup.exe  # NSIS 安装包
└── win-unpacked/              # 便携版本
```

---

## 📁 项目结构

```
hermes-companion/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── AppCoordinator.ts   # 核心协调器
│   │   └── ipc-handlers.ts    # IPC 通信
│   ├── database/       # SQLite 数据库
│   │   └── DatabaseManager.ts
│   ├── perception/     # 感知系统
│   │   └── PerceptionModule.ts
│   ├── learning/       # 学习引擎
│   │   └── LearningEngine.ts
│   ├── prediction/     # 预测引擎
│   │   └── PredictionEngine.ts
│   ├── mcp/           # 执行系统
│   │   └── ExecutionModule.ts
│   ├── security/      # 安全模块
│   │   ├── SecurityGuard.ts   # 注入检测
│   │   └── PrivacyManager.ts  # 隐私管理
│   ├── state/         # 状态引擎
│   │   └── StateEngine.ts
│   ├── ui/            # UI 逻辑
│   │   └── AppleStyleUI.ts
│   └── renderer/      # 渲染进程
│       ├── index.html
│       ├── styles/companion.css
│       └── components/
├── tests/             # 测试
│   └── unit/
├── docs/              # 设计文档
│   └── multi-platform-protocol.md
└── security/          # 安全文档
    └── audit-report.md
```

---

## 🔧 开发指南

### 代码规范
- TypeScript strict 模式
- ESM 模块
- 中文注释
- 错误处理完整

### 测试

```bash
# 运行单元测试
npm test

# 类型检查
npx tsc --noEmit

# 安全审计
npm audit
```

---

## 🎓 设计理念

### 静默是默认
Hermes 在 STEALTH 和 OBSERVING 状态下几乎不可见，不会打扰用户。

### 干预需谨慎
只有当预测置信度 > 85% 时，Hermes 才会主动提供建议。

### 隐私是底线
- 屏幕截图默认关闭
- 敏感应用 (Safari, Chrome, Messages 等) 自动过滤
- 用户数据可导出、可删除

### 透明建立信任
定期展示学习进度，让用户了解 Hermes 学到了什么。

---

## 📖 相关文档

- [CODEX_MASTER.md](CODEX_MASTER.md) - 完整开发提示词
- [docs/multi-platform-protocol.md](docs/multi-platform-protocol.md) - 多端同步协议
- [docs/workflows/video-playback-workflow.md](docs/workflows/video-playback-workflow.md) - 视频播放工作流
- [docs/workflows/video-mcp-commands.md](docs/workflows/video-mcp-commands.md) - Windows MCP / Chrome DevTools 命令速查
- [docs/research/video-platform-search-api.md](docs/research/video-platform-search-api.md) - 视频平台搜索 API 调研
- [docs/plans/2026-04-26-hermes-windows-takeover-bootstrap-v1.md](docs/plans/2026-04-26-hermes-windows-takeover-bootstrap-v1.md) - Windows takeover bootstrap 历史计划
- [security/audit-report.md](security/audit-report.md) - 安全审核报告

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT

---

** Hermes - 你的专属 AI 伴侣 **

*最后更新: $(date +%Y-%m-%d)*
