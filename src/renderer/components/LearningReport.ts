/**
 * LearningReport.ts - 学习报告组件
 *
 * 显示用户学习进度和习惯养成情况的组件
 * Apple 风格暗色主题设计
 */

export interface LearningReportData {
  learningDay: number;
  patternsDiscovered: number;
  habitsFormed: number;
  focusScore: number | null;
  predictionsCount: number;
}

export interface LearningReportConfig {
  visible?: boolean;
  autoHideAfterMs?: number;
}

export class LearningReport {
  private element: HTMLElement | null = null;
  private dayBadge: HTMLElement | null = null;
  private patternsEl: HTMLElement | null = null;
  private habitsEl: HTMLElement | null = null;
  private focusEl: HTMLElement | null = null;
  private predictionsEl: HTMLElement | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.element = document.getElementById('companion-learning');
    this.dayBadge = document.getElementById('learning-day-badge');
    this.patternsEl = document.getElementById('stat-patterns');
    this.habitsEl = document.getElementById('stat-habits');
    this.focusEl = document.getElementById('stat-focus');
    this.predictionsEl = document.getElementById('stat-predictions');
  }

  /**
   * 更新学习报告数据
   */
  public update(data: LearningReportData): void {
    if (!this.element) return;

    // Update day badge
    if (this.dayBadge) {
      this.dayBadge.textContent = `第 ${data.learningDay} 天`;
    }

    // Update stats
    if (this.patternsEl) {
      this.patternsEl.textContent = String(data.patternsDiscovered);
    }

    if (this.habitsEl) {
      this.habitsEl.textContent = String(data.habitsFormed);
    }

    if (this.focusEl) {
      this.focusEl.textContent = data.focusScore !== null
        ? `${Math.round(data.focusScore * 100)}%`
        : '--';
    }

    if (this.predictionsEl) {
      this.predictionsEl.textContent = String(data.predictionsCount);
    }
  }

  /**
   * 设置组件可见性
   */
  public setVisible(visible: boolean, config?: LearningReportConfig): void {
    if (!this.element) return;

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    if (visible) {
      this.element.classList.add('visible');
      this.element.setAttribute('aria-hidden', 'false');

      // Auto-hide after specified duration
      if (config?.autoHideAfterMs) {
        this.hideTimeout = setTimeout(() => {
          this.setVisible(false);
        }, config.autoHideAfterMs);
      }
    } else {
      this.element.classList.remove('visible');
      this.element.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * 检查组件是否可见
   */
  public isVisible(): boolean {
    return this.element?.classList.contains('visible') ?? false;
  }

  /**
   * 显示简短的学习进度通知
   */
  public showProgressNotification(learnedPatterns: number, newHabits: number): void {
    const currentData = this.getCurrentData();
    currentData.patternsDiscovered += learnedPatterns;
    currentData.habitsFormed += newHabits;
    this.update(currentData);
    this.setVisible(true, { autoHideAfterMs: 3000 });
  }

  /**
   * 获取当前显示的数据
   */
  private getCurrentData(): LearningReportData {
    return {
      learningDay: parseInt(this.dayBadge?.textContent?.replace(/[^0-9]/g, '') ?? '1', 10),
      patternsDiscovered: parseInt(this.patternsEl?.textContent ?? '0', 10),
      habitsFormed: parseInt(this.habitsEl?.textContent ?? '0', 10),
      focusScore: this.focusEl?.textContent !== '--'
        ? parseInt(this.focusEl?.textContent ?? '0', 10) / 100
        : null,
      predictionsCount: parseInt(this.predictionsEl?.textContent ?? '0', 10),
    };
  }
}

export default LearningReport;
