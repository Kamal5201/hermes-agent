/**
 * Clipboard Manager
 * 
 * Hermes Companion - 增强剪贴板功能
 * 支持剪贴板历史、图片、文件等
 */

import { EventEmitter } from 'events';
import { clipboard, nativeImage } from 'electron';
import log from 'electron-log/main.js';

export interface ClipboardItem {
  id: string;
  type: 'text' | 'image' | 'file' | 'html';
  content: string | Buffer;
  preview: string;
  timestamp: number;
  source?: string;
  favorite: boolean;
  tags: string[];
}

export interface ClipboardHistory {
  items: ClipboardItem[];
  maxItems: number;
}

export class ClipboardManager extends EventEmitter {
  private history: ClipboardItem[] = [];
  private maxItems: number = 100;
  private monitorInterval: NodeJS.Timeout | null = null;
  private lastContent: string = '';
  private isMonitoring: boolean = false;
  
  constructor(maxItems: number = 100) {
    super();
    this.maxItems = maxItems;
  }
  
  /**
   * 开始监控剪贴板
   */
  public startMonitoring(intervalMs: number = 500): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.lastContent = this.getCurrentContent();
    
    this.monitorInterval = setInterval(() => {
      this.checkClipboard();
    }, intervalMs);
    
    log.info('[ClipboardManager] Started monitoring');
  }
  
  /**
   * 停止监控
   */
  public stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;
    log.info('[ClipboardManager] Stopped monitoring');
  }
  
  /**
   * 检查剪贴板变化
   */
  private checkClipboard(): void {
    const currentContent = this.getCurrentContent();
    
    if (currentContent !== this.lastContent && currentContent.trim() !== '') {
      this.lastContent = currentContent;
      this.addItem({
        type: 'text',
        content: currentContent,
        preview: currentContent.substring(0, 100),
        timestamp: Date.now(),
        favorite: false,
        tags: [],
      });
    }
  }
  
  /**
   * 获取当前剪贴板内容
   */
  private getCurrentContent(): string {
    try {
      return clipboard.readText() || '';
    } catch {
      return '';
    }
  }
  
  /**
   * 添加剪贴板项
   */
  public addItem(item: Omit<ClipboardItem, 'id'>): void {
    const id = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const newItem: ClipboardItem = {
      ...item,
      id,
    };
    
    // 检查是否重复
    const existing = this.history.find(h => h.content === item.content);
    if (existing) {
      // 更新时间戳并移到顶部
      existing.timestamp = Date.now();
      this.history = [existing, ...this.history.filter(h => h.id !== existing.id)];
    } else {
      this.history.unshift(newItem);
      
      // 限制历史数量
      if (this.history.length > this.maxItems) {
        this.history = this.history.slice(0, this.maxItems);
      }
    }
    
    this.emit('itemAdded', newItem);
  }
  
  /**
   * 获取历史
   */
  public getHistory(): ClipboardItem[] {
    return [...this.history];
  }
  
  /**
   * 搜索剪贴板历史
   */
  public search(query: string): ClipboardItem[] {
    const lowerQuery = query.toLowerCase();
    return this.history.filter(item => {
      if (item.type === 'text' && typeof item.content === 'string') {
        return item.content.toLowerCase().includes(lowerQuery);
      }
      return item.preview.toLowerCase().includes(lowerQuery);
    });
  }
  
  /**
   * 复制到剪贴板
   */
  public copy(itemId: string): void {
    const item = this.history.find(h => h.id === itemId);
    if (!item) return;
    
    switch (item.type) {
      case 'text':
        clipboard.writeText(item.content as string);
        break;
      case 'image':
        const img = nativeImage.createFromBuffer(item.content as Buffer);
        clipboard.writeImage(img);
        break;
      case 'html':
        clipboard.writeHTML(item.content as string);
        break;
    }
    
    this.lastContent = typeof item.content === 'string' ? item.content : '';
    this.emit('copied', item);
  }
  
  /**
   * 收藏/取消收藏
   */
  public toggleFavorite(itemId: string): void {
    const item = this.history.find(h => h.id === itemId);
    if (item) {
      item.favorite = !item.favorite;
      this.emit('favoriteToggled', item);
    }
  }
  
  /**
   * 添加标签
   */
  public addTag(itemId: string, tag: string): void {
    const item = this.history.find(h => h.id === itemId);
    if (item && !item.tags.includes(tag)) {
      item.tags.push(tag);
      this.emit('tagAdded', { item, tag });
    }
  }
  
  /**
   * 删除历史项
   */
  public delete(itemId: string): void {
    this.history = this.history.filter(h => h.id !== itemId);
    this.emit('itemDeleted', itemId);
  }
  
  /**
   * 清空历史
   */
  public clear(): void {
    // 保留收藏的
    this.history = this.history.filter(h => h.favorite);
    this.emit('cleared');
  }
  
  /**
   * 导出历史
   */
  public export(): ClipboardHistory {
    return {
      items: this.history,
      maxItems: this.maxItems,
    };
  }
  
  /**
   * 导入历史
   */
  public import(data: ClipboardHistory): void {
    this.history = data.items;
    this.maxItems = data.maxItems;
    this.emit('imported');
  }
  
  /**
   * 固定文本到剪贴板
   */
  public pin(text: string, label?: string): void {
    const item: ClipboardItem = {
      id: `pin-${Date.now()}`,
      type: 'text',
      content: text,
      preview: text.substring(0, 100),
      timestamp: Date.now(),
      source: label || 'Pinned',
      favorite: true,
      tags: ['pinned'],
    };
    
    this.history.unshift(item);
    clipboard.writeText(text);
    this.lastContent = text;
    
    this.emit('pinned', item);
  }
}

export default ClipboardManager;
