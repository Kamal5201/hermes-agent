/**
 * Notification Center - 通知中心
 */

import { Notification, nativeImage, app } from 'electron';
import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  silent?: boolean;
  urgency?: 'normal' | 'critical' | 'low';
  actions?: Array<{ type: string; text: string }>;
  timeoutType?: 'default' | 'never';
}

export interface NotificationHistory {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

export class NotificationCenter extends EventEmitter {
  private history: NotificationHistory[] = [];
  private maxHistory: number = 100;
  private soundEnabled: boolean = true;
  
  constructor() {
    super();
  }
  
  /**
   * 发送通知
   */
  public notify(options: NotificationOptions): string {
    const id = `notif-${Date.now()}`;
    
    if (!Notification.isSupported()) {
      log.warn('[NotificationCenter] Notifications not supported');
      return id;
    }
    
    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: options.silent ?? !this.soundEnabled,
      urgency: options.urgency ?? 'normal',
      timeoutType: options.timeoutType ?? 'default',
    });
    
    notification.on('click', () => {
      this.emit('clicked', id);
    });
    
    notification.on('close', () => {
      this.emit('closed', id);
    });
    
    notification.show();
    
    // 记录历史
    this.addToHistory({ id, title: options.title, body: options.body, timestamp: Date.now(), read: false });
    
    this.emit('shown', id);
    log.info(`[NotificationCenter] Shown: ${options.title}`);
    
    return id;
  }
  
  /**
   * 发送 Hermès 专属通知
   */
  public hermesNotify(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): string {
    const icons: Record<string, string> = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌',
    };
    
    return this.notify({
      title: `${icons[type]} Hermes`,
      body: message,
      silent: false,
    });
  }
  
  /**
   * 添加到历史
   */
  private addToHistory(item: NotificationHistory): void {
    this.history.unshift(item);
    
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }
  }
  
  /**
   * 获取历史
   */
  public getHistory(): NotificationHistory[] {
    return [...this.history];
  }
  
  /**
   * 获取未读数量
   */
  public getUnreadCount(): number {
    return this.history.filter(n => !n.read).length;
  }
  
  /**
   * 标记已读
   */
  public markAsRead(id: string): void {
    const item = this.history.find(n => n.id === id);
    if (item) {
      item.read = true;
      this.emit('markedAsRead', id);
    }
  }
  
  /**
   * 标记全部已读
   */
  public markAllAsRead(): void {
    this.history.forEach(n => n.read = true);
    this.emit('allMarkedAsRead');
  }
  
  /**
   * 清除历史
   */
  public clearHistory(): void {
    this.history = [];
    this.emit('cleared');
  }
  
  /**
   * 设置声音
   */
  public setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    this.emit('soundChanged', enabled);
  }
  
  /**
   * 发送操作通知 (带按钮)
   */
  public async notifyWithActions(options: NotificationOptions & { actions: Array<{ type: string; text: string }> }): Promise<string> {
    const id = `notif-action-${Date.now()}`;
    
    // 暂时使用普通通知
    return this.notify({ ...options, silent: false });
  }
}

export default NotificationCenter;
