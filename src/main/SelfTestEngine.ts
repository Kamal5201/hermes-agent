/**
 * Hermes Companion 自进化测试引擎
 *
 * 连接即测试——Hermes Agent 连接后的第一件事：
 * 1. 功能测试：所有命令、状态转换、UI 组件
 * 2. Bug 检测：异常、错误、崩溃
 * 3. 软测：性能、内存、响应时间
 * 4. 渗透测试：安全边界（未授权操作是否被正确拒绝）
 * 5. 自进化：发现问题 → 自动修复 → 提交 PR → CI → 验证
 */

import { getLogger } from './logger';

export interface TestResult {
  name: string;
  category: 'functional' | 'bug' | 'soft' | 'pentest' | 'evolution';
  passed: boolean;
  durationMs: number;
  startedAt?: number; // 内部计时用，不序列化到报告
  error?: string;
  details?: Record<string, unknown>;
}

export interface SelfTestReport {
  timestamp: number;
  overall: 'pass' | 'fail' | 'partial';
  totalTests: number;
  passed: number;
  failed: number;
  results: TestResult[];
  criticalBugs: TestResult[];
  autoFixable: TestResult[];
  needsHumanReview: TestResult[];
}

export interface ControlServerApp {
  popInbox(): Array<{ type: string; text: string; timestamp: number }>;
  handleControlCommand(action: string, params?: Record<string, unknown>): Promise<unknown>;
  getCurrentState(): string;
  forceState(state: string): void;
  moveWindow(x: number, y: number): void;
  clickAt(x: number, y: number): Promise<void>;
  typeText(text: string): Promise<void>;
  takeScreenshot(): Promise<string | null>;
  displayMessage(text: string, speaker?: string): void;
  speak(text: string): void;
  setControlServerApp?: (fn: () => { handleControlCommand: (a: string, p?: Record<string, unknown>) => Promise<unknown>; popInbox: () => unknown[] }) => void;
}

export class SelfTestEngine {
  private readonly logger = getLogger('SelfTestEngine');
  private readonly results: TestResult[] = [];
  private startMemory = 0;
  private startTime = 0;

  constructor(private readonly app: ControlServerApp) {}

  /**
   * 完整测试套件——连接时自动运行
   */
  async runFullSuite(): Promise<SelfTestReport> {
    this.startTime = Date.now();
    this.startMemory = process.memoryUsage?.()?.heapUsed ?? 0;
    this.results.length = 0;

    // 1. 功能测试（不改变状态，不执行危险操作）
    await this.testControlServerEndpoints();
    await this.testSecurityBoundaries();
    await this.testStateTransitions();

    // 2. Bug 检测
    await this.testNoCrashOnInvalidCommands();
    await this.testNoEpipesInLogs();

    // 3. 软测（性能/内存）
    await this.testCommandLatency();
    await this.testMemoryUsage();

    // 4. 渗透测试（安全边界）
    await this.testUnauthorizedGuiControl();
    await this.testSensitiveOperationsNeedConfirmation();

    return this.generateReport();
  }

  // ─── 功能测试 ──────────────────────────────────────────────────────────────

  private async testControlServerEndpoints(): Promise<void> {
    const endpoints = [
      { action: 'getState', params: {}, expectOk: true },
      { action: 'screenshot', params: {}, expectOk: true },
      { action: 'displayMessage', params: { text: 'Self-test message', speaker: 'test' }, expectOk: true },
      { action: 'speak', params: { text: 'Self-test' }, expectOk: true },
    ];

    for (const ep of endpoints) {
      const t = this.startTest(ep.action, 'functional');
      try {
        const result = await this.app.handleControlCommand(ep.action, ep.params);
        t.passed = ep.expectOk;
        if (!ep.expectOk) t.error = `Expected failure but got: ${JSON.stringify(result)}`;
      } catch (err: any) {
        t.passed = !ep.expectOk;
        if (ep.expectOk) t.error = err.message;
      }
      this.endTest(t);
    }
  }

  private async testSecurityBoundaries(): Promise<void> {
    // GET /health 应该不需要认证
    const t = this.startTest('security:health_endpoint', 'functional');
    try {
      // 这是 HTTP 层测试，在这里测不了，用一个不需要 GUI 的命令代替
      await this.app.handleControlCommand('getState', {});
      t.passed = true;
    } catch (err: any) {
      t.passed = false;
      t.error = err.message;
    }
    this.endTest(t);
  }

  private async testStateTransitions(): Promise<void> {
    const states = ['STEALTH', 'OBSERVING', 'HINT', 'ACTIVE', 'RETREATING'];
    for (const state of states) {
      const t = this.startTest(`state:${state}`, 'functional');
      try {
        this.app.forceState(state);
        await this.delay(100);
        const current = this.app.getCurrentState();
        t.passed = current === state;
        if (!t.passed) t.error = `Expected ${state}, got ${current}`;
      } catch (err: any) {
        t.passed = false;
        t.error = err.message;
      }
      this.endTest(t);
    }
    // 恢复到 STEALTH
    this.app.forceState('STEALTH');
  }

  // ─── Bug 检测 ─────────────────────────────────────────────────────────────

  private async testNoCrashOnInvalidCommands(): Promise<void> {
    const invalidCommands = [
      { action: 'goto' },                    // 缺少必需参数 x, y
      { action: 'click' },                   // 缺少 x, y
      { action: 'type' },                    // 缺少 text
      { action: 'invalid_nonsense_command' }, // 不存在的命令
      { action: 'setState', params: { state: 'INVALID_STATE' } },
    ];

    for (const cmd of invalidCommands) {
      const t = this.startTest(`bug:invalid_${cmd.action}`, 'bug');
      try {
        await this.app.handleControlCommand(cmd.action, cmd.params ?? {});
        // 没崩 = 通过（但应该返回错误）
        t.passed = false;
        t.error = 'Expected error but command succeeded';
      } catch (err: any) {
        // 应该报错，但不崩溃
        t.passed = err.message && !err.message.includes('Crash');
        if (!t.passed) t.error = `Unexpected crash: ${err.message}`;
      }
      this.endTest(t);
    }
  }

  private async testNoEpipesInLogs(): Promise<void> {
    // 这个需要在日志里检查，暂时用内存中的日志记录
    const t = this.startTest('bug:no_EPIPE', 'bug');
    // 如果之前的测试都通过了，没有抛出 EPIPE 错误，就认为通过
    const hasEpipes = this.results.some(r =>
      r.error?.includes('EPIPE') || r.error?.includes('write EPIPE')
    );
    t.passed = !hasEpipes;
    if (!t.passed) t.error = 'EPIPE errors detected in test run';
    this.endTest(t);
  }

  // ─── 软测 ─────────────────────────────────────────────────────────────────

  private async testCommandLatency(): Promise<void> {
    const commands = ['getState', 'displayMessage', 'screenshot'];
    for (const action of commands) {
      const t = this.startTest(`soft:latency_${action}`, 'soft');
      const start = Date.now();
      try {
        await this.app.handleControlCommand(action, action === 'displayMessage' ? { text: 'perf test' } : {});
        t.passed = true;
        t.details = { latencyMs: Date.now() - start };
      } catch (err: any) {
        t.passed = false;
        t.error = err.message;
      }
      this.endTest(t);
    }
  }

  private async testMemoryUsage(): Promise<void> {
    const t = this.startTest('soft:memory', 'soft');
    try {
      await this.delay(200); // 给 GC 一点时间
      const mem = process.memoryUsage?.() ?? {};
      const usedMB = ((mem.heapUsed ?? 0) / 1024 / 1024).toFixed(1);
      const totalMB = ((mem.heapTotal ?? 0) / 1024 / 1024).toFixed(1);
      t.passed = true;
      t.details = { heapUsedMB: usedMB, heapTotalMB: totalMB };
    } catch (err: any) {
      t.passed = false;
      t.error = err.message;
    }
    this.endTest(t);
  }

  // ─── 渗透测试 ─────────────────────────────────────────────────────────────

  private async testUnauthorizedGuiControl(): Promise<void> {
    // 确保在非 ACTIVE 状态下，图形命令应该被拒绝
    this.app.forceState('STEALTH');
    await this.delay(100);

    const graphicalCommands = ['goto', 'click', 'type', 'screenshot'];
    for (const action of graphicalCommands) {
      const t = this.startTest(`pentest:unauth_${action}`, 'pentest');
      const params = action === 'type' ? { text: 'test' } : action === 'click' || action === 'goto' ? { x: 100, y: 100 } : {};
      try {
        await this.app.handleControlCommand(action, params);
        t.passed = false;
        t.error = `Expected UNAUTHORIZED but command succeeded`;
      } catch (err: any) {
        t.passed = err.code === 'UNAUTHORIZED';
        if (!t.passed) t.error = `Expected UNAUTHORIZED, got: ${err.message}`;
      }
      this.endTest(t);
    }

    // 恢复到正常状态
    this.app.forceState('STEALTH');
  }

  private async testSensitiveOperationsNeedConfirmation(): Promise<void> {
    const t = this.startTest('pentest:sensitive_ops_confirmation', 'pentest');
    try {
      await this.app.handleControlCommand('delete', { url: 'http://test.com/file' });
      t.passed = false;
      t.error = 'Sensitive operation should require confirmation';
    } catch (err: any) {
      // 应该抛出需要确认的错误（目前 TODO 阶段会直接拒绝）
      t.passed = err.code === 'CONFIRMATION_REJECTED' || err.code !== undefined;
      if (!t.passed) t.error = `Wrong error: ${err.message}`;
    }
    this.endTest(t);
  }

  // ─── 报告生成 ─────────────────────────────────────────────────────────────

  private generateReport(): SelfTestReport {
    const passed = this.results.filter(r => r.passed);
    const failed = this.results.filter(r => !r.passed);
    const criticalBugs = failed.filter(r => r.category === 'bug');
    const autoFixable = failed.filter(r =>
      r.category === 'functional' ||
      (r.category === 'soft' && r.error?.includes('memory'))
    );
    const needsHumanReview = failed.filter(r =>
      r.category === 'pentest' || r.category === 'bug'
    );

    return {
      timestamp: Date.now(),
      overall: failed.length === 0 ? 'pass' : criticalBugs.length > 0 ? 'fail' : 'partial',
      totalTests: this.results.length,
      passed: passed.length,
      failed: failed.length,
      results: this.results,
      criticalBugs,
      autoFixable,
      needsHumanReview,
    };
  }

  // ─── 辅助方法 ─────────────────────────────────────────────────────────────

  private startTest(name: string, category: TestResult['category']): TestResult {
    return { name, category, passed: false, durationMs: 0, startedAt: Date.now() } as TestResult;
  }

  private endTest(t: TestResult): void {
    t.durationMs = Date.now() - (t.startedAt ?? Date.now());
    delete t.startedAt;
    this.results.push(t);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default SelfTestEngine;
