/**
 * Health Monitor
 * 
 * Hermes Companion - 健康监控模块
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

export interface HealthStats {
  timestamp: number;
  screenTime: { today: number; weekly: number[]; average: number };
  breakTime: { lastBreak: number; breaksToday: number; totalBreakMinutes: number };
  postureScore: number;
  eyeStrain: number;
  hydration: { glasses: number; goal: number };
  steps: { count: number; goal: number };
  sleep: { hoursLastNight: number; quality: number };
}

export interface Reminder {
  id: string;
  type: 'break' | 'posture' | 'water' | 'eyes' | 'walk' | 'sleep';
  title: string;
  message: string;
  interval?: number;
  enabled: boolean;
  lastTriggered?: number;
}

export class HealthMonitor extends EventEmitter {
  private isMonitoring: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private reminders: Map<string, Reminder> = new Map();
  private stats: HealthStats;
  
  private goals = {
    screenTimeLimit: 480,
    breakInterval: 25,
    breakDuration: 5,
    waterGlasses: 8,
    stepsGoal: 10000,
    sleepHours: 8,
  };
  
  constructor() {
    super();
    this.stats = this.getInitialStats();
    this.initDefaultReminders();
  }
  
  private getInitialStats(): HealthStats {
    const now = Date.now();
    return {
      timestamp: now,
      screenTime: { today: 0, weekly: [0,0,0,0,0,0,0], average: 0 },
      breakTime: { lastBreak: now, breaksToday: 0, totalBreakMinutes: 0 },
      postureScore: 100, eyeStrain: 0,
      hydration: { glasses: 0, goal: this.goals.waterGlasses },
      steps: { count: 0, goal: this.goals.stepsGoal },
      sleep: { hoursLastNight: 7, quality: 80 },
    };
  }
  
  private initDefaultReminders(): void {
    this.reminders.set('break', { id: 'break', type: 'break', title: '休息一下', message: '你已经工作25分钟了，休息5分钟吧！', interval: 25, enabled: true });
    this.reminders.set('water', { id: 'water', type: 'water', title: '喝杯水', message: '记得补充水分！', interval: 60, enabled: true });
    this.reminders.set('walk', { id: 'walk', type: 'walk', title: '起来走走', message: '坐了太久了，起来活动一下！', interval: 60, enabled: true });
    this.reminders.set('eyes', { id: 'eyes', type: 'eyes', title: '护眼时间', message: '遵循20-20-20法则！', interval: 20, enabled: true });
  }
  
  public startMonitoring(intervalMs: number = 60000): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.monitorInterval = setInterval(() => { this.checkReminders(); this.updateScreenTime(); }, intervalMs);
    log.info('[HealthMonitor] Started');
    this.emit('started');
  }
  
  public stopMonitoring(): void {
    if (this.monitorInterval) { clearInterval(this.monitorInterval); this.monitorInterval = null; }
    this.isMonitoring = false;
    log.info('[HealthMonitor] Stopped');
    this.emit('stopped');
  }
  
  private checkReminders(): void {
    const now = Date.now();
    for (const reminder of this.reminders.values()) {
      if (!reminder.enabled || !reminder.interval) continue;
      const lastTriggered = reminder.lastTriggered || this.stats.timestamp;
      if ((now - lastTriggered) / 60000 >= reminder.interval) {
        reminder.lastTriggered = now;
        this.emit('reminder', reminder);
      }
    }
  }
  
  private updateScreenTime(): void {
    this.stats.screenTime.today += 1;
    this.stats.timestamp = Date.now();
    this.emit('statsUpdated', this.stats);
  }
  
  public recordBreak(): void {
    this.stats.breakTime.lastBreak = Date.now();
    this.stats.breakTime.breaksToday++;
    this.emit('breakRecorded', this.stats.breakTime);
  }
  
  public incrementWater(): void {
    if (this.stats.hydration.glasses < this.goals.waterGlasses) {
      this.stats.hydration.glasses++;
      this.emit('waterIncremented', this.stats.hydration);
    }
  }
  
  public getStats(): HealthStats { return { ...this.stats }; }
  public getReminders(): Reminder[] { return Array.from(this.reminders.values()); }
  public setReminder(id: string, enabled: boolean): void {
    const r = this.reminders.get(id);
    if (r) { r.enabled = enabled; this.emit('reminderUpdated', r); }
  }
  public isActive(): boolean { return this.isMonitoring; }
}
export default HealthMonitor;
