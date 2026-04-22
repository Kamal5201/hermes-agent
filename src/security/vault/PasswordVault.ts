/**
 * Password Vault - 安全密码管理
 */

import { safeStorage } from 'electron';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import log from 'electron-log/main.js';

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;  // 加密存储
  url?: string;
  notes?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
}

export interface PasswordGeneratorOptions {
  length: number;
  includeUppercase: boolean;
  includeLowercase: boolean;
  includeNumbers: boolean;
  includeSymbols: boolean;
  excludeAmbiguous: boolean;
}

export class PasswordVault extends EventEmitter {
  private entries: Map<string, PasswordEntry> = new Map();
  private isUnlocked: boolean = false;
  private masterKeyHash: string = '';
  
  constructor() {
    super();
  }
  
  /**
   * 检查是否支持安全存储
   */
  public isSecureStorageAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
  
  /**
   * 设置主密码
   */
  public setMasterPassword(password: string): void {
    this.masterKeyHash = crypto.createHash('sha256').update(password).digest('hex');
    this.isUnlocked = true;
    log.info('[PasswordVault] Master password set');
    this.emit('unlocked');
  }
  
  /**
   * 解锁保险库
   */
  public unlock(password: string): boolean {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    if (hash === this.masterKeyHash) {
      this.isUnlocked = true;
      this.emit('unlocked');
      return true;
    }
    return false;
  }
  
  /**
   * 锁定保险库
   */
  public lock(): void {
    this.isUnlocked = false;
    this.emit('locked');
    log.info('[PasswordVault] Vault locked');
  }
  
  /**
   * 加密密码
   */
  private encryptPassword(password: string): string {
    if (!this.isSecureStorageAvailable()) {
      // 回退到 base64 编码
      return Buffer.from(password).toString('base64');
    }
    const encrypted = safeStorage.encryptString(password);
    return encrypted.toString('base64');
  }
  
  /**
   * 解密密码
   */
  private decryptPassword(encrypted: string): string {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    
    if (!this.isSecureStorageAvailable()) {
      return Buffer.from(encrypted, 'base64').toString('utf8');
    }
    
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  }
  
  /**
   * 添加密码条目
   */
  public addEntry(entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>): PasswordEntry {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    
    const id = `pwd-${Date.now()}`;
    const now = Date.now();
    
    const newEntry: PasswordEntry = {
      ...entry,
      id,
      password: this.encryptPassword(entry.password),
      createdAt: now,
      updatedAt: now,
    };
    
    this.entries.set(id, newEntry);
    this.emit('entryAdded', newEntry);
    
    return newEntry;
  }
  
  /**
   * 获取条目 (密码加密)
   */
  public getEntry(id: string): Omit<PasswordEntry, 'password'> | null {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    
    const entry = this.entries.get(id);
    if (!entry) return null;
    
    const { password, ...rest } = entry;
    return rest as Omit<PasswordEntry, 'password'>;
  }
  
  /**
   * 获取解密后的密码
   */
  public getDecryptedPassword(id: string): string {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Entry not found');
    
    return this.decryptPassword(entry.password);
  }
  
  /**
   * 更新条目
   */
  public updateEntry(id: string, updates: Partial<Omit<PasswordEntry, 'id' | 'createdAt'>>): PasswordEntry | null {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    
    const entry = this.entries.get(id);
    if (!entry) return null;
    
    if (updates.password) {
      updates.password = this.encryptPassword(updates.password);
    }
    
    Object.assign(entry, updates, { updatedAt: Date.now() });
    this.emit('entryUpdated', entry);
    
    return entry;
  }
  
  /**
   * 删除条目
   */
  public deleteEntry(id: string): boolean {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    
    const deleted = this.entries.delete(id);
    if (deleted) {
      this.emit('entryDeleted', id);
    }
    return deleted;
  }
  
  /**
   * 搜索条目
   */
  public search(query: string): Omit<PasswordEntry, 'password'>[] {
    if (!this.isUnlocked) throw new Error('Vault is locked');
    
    const lowerQuery = query.toLowerCase();
    return Array.from(this.entries.values())
      .filter(e => 
        e.title.toLowerCase().includes(lowerQuery) ||
        e.username.toLowerCase().includes(lowerQuery) ||
        e.url?.toLowerCase().includes(lowerQuery) ||
        e.tags.some(t => t.toLowerCase().includes(lowerQuery))
      )
      .map(({ password, ...rest }) => rest as Omit<PasswordEntry, 'password'>);
  }
  
  /**
   * 生成密码
   */
  public generatePassword(options: PasswordGeneratorOptions): string {
    const {
      length = 16,
      includeUppercase = true,
      includeLowercase = true,
      includeNumbers = true,
      includeSymbols = true,
      excludeAmbiguous = false,
    } = options;
    
    let chars = '';
    
    if (includeLowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
    if (includeUppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeNumbers) chars += '0123456789';
    if (includeSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    if (excludeAmbiguous) {
      chars = chars.replace(/[0OlI1|]/g, '');
    }
    
    let password = '';
    const randomBytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
      password += chars[randomBytes[i] % chars.length];
    }
    
    return password;
  }
  
  /**
   * 密码强度检查
   */
  public checkPasswordStrength(password: string): {
    score: number;  // 0-4
    label: 'weak' | 'fair' | 'good' | 'strong' | 'very_strong';
    feedback: string[];
  } {
    let score = 0;
    const feedback: string[] = [];
    
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;
    
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    
    const normalizedScore = Math.min(4, Math.floor(score / 2));
    
    const labels: Array<'weak' | 'fair' | 'good' | 'strong' | 'very_strong'> = ['weak', 'fair', 'good', 'strong', 'very_strong'];
    
    return {
      score: normalizedScore,
      label: labels[normalizedScore],
      feedback,
    };
  }
  
  public getAllEntries(): Omit<PasswordEntry, 'password'>[] {
    return Array.from(this.entries.values()).map(({ password, ...rest }) => rest as Omit<PasswordEntry, 'password'>);
  }
  
  public isLocked(): boolean { return !this.isUnlocked; }
}

export default PasswordVault;
