/**
 * Calendar Manager
 * 
 * Hermes Companion - 日程管理模块
 * 支持日历同步、提醒、智能日程规划
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  location?: string;
  calendar: string;
  reminders: number[];  // 分钟数 [5, 15, 30]
  recurrence?: RecurrenceRule;
  attendees?: Attendee[];
  color?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  count?: number;
  until?: Date;
  byDay?: string[];
}

export interface Attendee {
  name: string;
  email: string;
  status: 'accepted' | 'declined' | 'tentative' | 'pending';
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  isPrimary: boolean;
  isSubscribed: boolean;
}

export interface TimeBlock {
  start: Date;
  end: Date;
  type: 'work' | 'meeting' | 'break' | 'personal' | 'free';
  label?: string;
}

export class CalendarManager extends EventEmitter {
  private events: Map<string, CalendarEvent> = new Map();
  private calendars: Map<string, Calendar> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    this.initDefaultCalendars();
  }
  
  private initDefaultCalendars(): void {
    this.calendars.set('personal', {
      id: 'personal',
      name: '个人日历',
      color: '#4285F4',
      isPrimary: true,
      isSubscribed: true,
    });
    
    this.calendars.set('work', {
      id: 'work',
      name: '工作日历',
      color: '#EA4335',
      isPrimary: false,
      isSubscribed: true,
    });
  }
  
  /**
   * 添加事件
   */
  public addEvent(event: Omit<CalendarEvent, 'id'>): CalendarEvent {
    const id = `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newEvent: CalendarEvent = { ...event, id };
    
    this.events.set(id, newEvent);
    this.emit('eventAdded', newEvent);
    
    // 设置提醒
    this.scheduleReminders(newEvent);
    
    return newEvent;
  }
  
  /**
   * 更新事件
   */
  public updateEvent(id: string, updates: Partial<CalendarEvent>): CalendarEvent | null {
    const event = this.events.get(id);
    if (!event) return null;
    
    const updated = { ...event, ...updates, id };
    this.events.set(id, updated);
    
    this.emit('eventUpdated', updated);
    return updated;
  }
  
  /**
   * 删除事件
   */
  public deleteEvent(id: string): boolean {
    const deleted = this.events.delete(id);
    if (deleted) {
      this.emit('eventDeleted', id);
    }
    return deleted;
  }
  
  /**
   * 获取日期范围内的事件
   */
  public getEvents(start: Date, end: Date): CalendarEvent[] {
    return Array.from(this.events.values()).filter(event => {
      return event.startTime >= start && event.startTime <= end;
    });
  }
  
  /**
   * 获取今日事件
   */
  public getTodayEvents(): CalendarEvent[] {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return this.getEvents(start, end);
  }
  
  /**
   * 获取即将到来的事件
   */
  public getUpcomingEvents(count: number = 5): CalendarEvent[] {
    const now = new Date();
    return Array.from(this.events.values())
      .filter(e => e.startTime > now)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .slice(0, count);
  }
  
  /**
   * 设置提醒
   */
  private scheduleReminders(event: CalendarEvent): void {
    for (const minutes of event.reminders) {
      const reminderTime = new Date(event.startTime.getTime() - minutes * 60 * 1000);
      const now = Date.now();
      
      if (reminderTime.getTime() > now) {
        const delay = reminderTime.getTime() - now;
        setTimeout(() => {
          this.emit('reminder', { event, minutes });
        }, delay);
      }
    }
  }
  
  /**
   * 智能日程规划
   */
  public suggestTimeBlock(duration: number, preference: 'morning' | 'afternoon' | 'evening' = 'morning'): Date | null {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    // 获取今天的会议时间块
    const todayEvents = this.getTodayEvents();
    const busyBlocks: TimeBlock[] = todayEvents.map(e => ({
      start: e.startTime,
      end: e.endTime,
      type: 'meeting' as const,
    }));
    
    // 定义偏好时间段
    const preferenceRanges = {
      morning: { start: 9, end: 12 },
      afternoon: { start: 14, end: 17 },
      evening: { start: 19, end: 21 },
    };
    
    const range = preferenceRanges[preference];
    
    // 查找空闲时间段
    for (let hour = range.start; hour <= range.end; hour++) {
      const blockStart = new Date(startOfDay.getTime() + hour * 60 * 60 * 1000);
      const blockEnd = new Date(blockStart.getTime() + duration * 60 * 1000);
      
      const isFree = !busyBlocks.some(block => {
        return blockStart < block.end && blockEnd > block.start;
      });
      
      if (isFree && blockStart > new Date()) {
        return blockStart;
      }
    }
    
    return null;
  }
  
  /**
   * 分析日程
   */
  public analyzeSchedule(days: number = 7): {
    totalEvents: number;
    totalHours: number;
    averagePerDay: number;
    busiestDay: string;
    timeDistribution: Record<string, number>;
  } {
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    const events = this.getEvents(start, now);
    const totalHours = events.reduce((sum, e) => {
      return sum + (e.endTime.getTime() - e.startTime.getTime()) / (1000 * 60 * 60);
    }, 0);
    
    // 统计每天的事件数
    const dayCount: Record<string, number> = {};
    const hourCount: Record<string, number> = {};
    
    for (const event of events) {
      const dayName = event.startTime.toLocaleDateString('zh-CN', { weekday: 'long' });
      dayCount[dayName] = (dayCount[dayName] || 0) + 1;
      
      const hour = event.startTime.getHours().toString();
      hourCount[hour] = (hourCount[hour] || 0) + 1;
    }
    
    const busiestDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    
    return {
      totalEvents: events.length,
      totalHours,
      averagePerDay: events.length / days,
      busiestDay,
      timeDistribution: hourCount,
    };
  }
  
  /**
   * 同步日历
   */
  public async sync(provider: 'google' | 'apple' | 'outlook'): Promise<void> {
    log.info(`[CalendarManager] Syncing with ${provider}`);
    this.emit('syncStarted', provider);
    
    try {
      // TODO: 实现实际的日历同步
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.emit('syncCompleted', provider);
    } catch (error) {
      this.emit('syncError', { provider, error });
      throw error;
    }
  }
  
  public getCalendars(): Calendar[] {
    return Array.from(this.calendars.values());
  }
  
  public getAllEvents(): CalendarEvent[] {
    return Array.from(this.events.values());
  }
}

export default CalendarManager;
