/**
 * Hotkey Manager
 * 
 * Hermes Companion - 全局快捷键管理
 * 支持全局快捷键注册和管理
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

export interface Hotkey {
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta' | 'super')[];
  action: () => void | Promise<void>;
  description: string;
  enabled: boolean;
  scope: 'global' | 'app' | 'local';
}

export interface HotkeyGroup {
  name: string;
  hotkeys: Map<string, Hotkey>;
}

export class HotkeyManager extends EventEmitter {
  private hotkeys: Map<string, Hotkey> = new Map();
  private groups: Map<string, HotkeyGroup> = new Map();
  private registeredKeys: Set<string> = new Set();
  
  constructor() {
    super();
    this.initDefaultHotkeys();
  }
  
  /**
   * 初始化默认快捷键
   */
  private initDefaultHotkeys(): void {
    // 全局快捷键
    this.register({
      key: 'f1',
      modifiers: [],
      action: () => {
        this.emit('showHelp');
      },
      description: '显示帮助',
      scope: 'global',
    });
    
    this.register({
      key: 'd',
      modifiers: ['ctrl', 'shift'],
      action: () => {
        this.emit('toggleDesktop');
      },
      description: '切换桌面',
      scope: 'global',
    });
    
    this.register({
      key: 'l',
      modifiers: ['ctrl', 'shift'],
      action: () => {
        this.emit('lockScreen');
      },
      description: '锁定屏幕',
      scope: 'global',
    });
    
    // 应用内快捷键
    this.register({
      key: 'n',
      modifiers: ['ctrl'],
      action: () => {
        this.emit('newWindow');
      },
      description: '新建窗口',
      scope: 'app',
    });
    
    this.register({
      key: ',',
      modifiers: ['ctrl'],
      action: () => {
        this.emit('openSettings');
      },
      description: '打开设置',
      scope: 'app',
    });
    
    this.register({
      key: 'q',
      modifiers: ['ctrl'],
      action: () => {
        this.emit('quit');
      },
      description: '退出应用',
      scope: 'app',
    });
  }
  
  /**
   * 注册快捷键
   */
  public register(config: Omit<Hotkey, 'enabled'>): string {
    const id = this.generateHotkeyId(config.key, config.modifiers);
    
    if (this.hotkeys.has(id)) {
      log.warn(`[HotkeyManager] Hotkey already registered: ${id}`);
      return id;
    }
    
    const hotkey: Hotkey = {
      ...config,
      enabled: true,
    };
    
    this.hotkeys.set(id, hotkey);
    this.registeredKeys.add(id);
    
    log.info(`[HotkeyManager] Registered: ${id} - ${config.description}`);
    this.emit('registered', hotkey);
    
    return id;
  }
  
  /**
   * 注销快捷键
   */
  public unregister(key: string, modifiers: string[]): boolean {
    const id = this.generateHotkeyId(key, modifiers);
    const deleted = this.hotkeys.delete(id);
    
    if (deleted) {
      this.registeredKeys.delete(id);
      log.info(`[HotkeyManager] Unregistered: ${id}`);
      this.emit('unregistered', id);
    }
    
    return deleted;
  }
  
  /**
   * 触发快捷键
   */
  public async trigger(key: string, modifiers: string[]): Promise<void> {
    const id = this.generateHotkeyId(key, modifiers);
    const hotkey = this.hotkeys.get(id);
    
    if (!hotkey) {
      return;
    }
    
    if (!hotkey.enabled) {
      log.debug(`[HotkeyManager] Hotkey disabled: ${id}`);
      return;
    }
    
    log.debug(`[HotkeyManager] Triggered: ${id}`);
    
    try {
      await hotkey.action();
      this.emit('triggered', hotkey);
    } catch (error) {
      log.error(`[HotkeyManager] Action failed:`, error);
      this.emit('error', error);
    }
  }
  
  /**
   * 启用/禁用快捷键
   */
  public setEnabled(key: string, modifiers: string[], enabled: boolean): void {
    const id = this.generateHotkeyId(key, modifiers);
    const hotkey = this.hotkeys.get(id);
    
    if (hotkey) {
      hotkey.enabled = enabled;
      this.emit('enabledChanged', { hotkey, enabled });
    }
  }
  
  /**
   * 获取所有快捷键
   */
  public getAllHotkeys(): Hotkey[] {
    return Array.from(this.hotkeys.values());
  }
  
  /**
   * 获取快捷键描述
   */
  public getHotkeyDescription(key: string, modifiers: string[]): string {
    const id = this.generateHotkeyId(key, modifiers);
    const hotkey = this.hotkeys.get(id);
    return hotkey?.description || '';
  }
  
  /**
   * 导出快捷键配置
   */
  public exportConfig(): Record<string, any> {
    const config: Record<string, any> = {};
    
    for (const [id, hotkey] of this.hotkeys) {
      config[id] = {
        key: hotkey.key,
        modifiers: hotkey.modifiers,
        description: hotkey.description,
        enabled: hotkey.enabled,
        scope: hotkey.scope,
      };
    }
    
    return config;
  }
  
  /**
   * 导入快捷键配置
   */
  public importConfig(config: Record<string, any>): void {
    for (const [id, hotkeyConfig] of Object.entries(config)) {
      const { key, modifiers, action, description, enabled, scope } = hotkeyConfig as any;
      
      this.register({
        key,
        modifiers,
        action: action || (() => {}),
        description,
        scope,
      });
      
      this.setEnabled(key, modifiers, enabled);
    }
  }
  
  /**
   * 生成快捷键 ID
   */
  private generateHotkeyId(key: string, modifiers: string[]): string {
    const sortedMods = [...modifiers].sort().join('+');
    return `${sortedMods ? sortedMods + '+' : ''}${key.toLowerCase()}`;
  }
  
  /**
   * 解析快捷键字符串
   */
  public parseHotkeyString(str: string): { key: string; modifiers: string[] } {
    const parts = str.toLowerCase().split('+');
    const key = parts.pop() || '';
    const modifiers = parts;
    
    return { key, modifiers };
  }
  
  /**
   * 格式化快捷键显示
   */
  public formatHotkey(key: string, modifiers: string[]): string {
    const isMac = process.platform === 'darwin';
    
    const modifierMap: Record<string, string> = isMac ? {
      ctrl: '⌃',
      alt: '⌥',
      shift: '⇧',
      meta: '⌘',
      super: '⌘',
    } : {
      ctrl: 'Ctrl+',
      alt: 'Alt+',
      shift: 'Shift+',
      meta: 'Win+',
      super: 'Win+',
    };
    
    const prefix = modifiers.map(m => modifierMap[m] || m).join('');
    const keyDisplay = key.toUpperCase();
    
    return `${prefix}${keyDisplay}`;
  }
}

export default HotkeyManager;
