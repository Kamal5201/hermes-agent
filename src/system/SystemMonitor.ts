/**
 * System Monitor
 * 
 * Hermes Companion - 系统监控模块
 * 监控 CPU、内存、磁盘、网络、进程等
 */

import { EventEmitter } from 'events';
import os from 'os';
import log from 'electron-log/main.js';

export interface SystemStats {
  timestamp: number;
  cpu: {
    usage: number;        // 0-100
    cores: number;
    model: string;
    speed: number;        // GHz
  };
  memory: {
    total: number;       // bytes
    used: number;
    free: number;
    usagePercent: number; // 0-100
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  }[];
  network: {
    interface: string;
    rx: number;
    tx: number;
  };
  processes: ProcessInfo[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  threads: number;
  startTime: number;
}

export interface AlertRule {
  id: string;
  metric: 'cpu' | 'memory' | 'disk' | 'temperature';
  threshold: number;
  condition: 'above' | 'below';
  enabled: boolean;
}

export class SystemMonitor extends EventEmitter {
  private isMonitoring: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private alertRules: Map<string, AlertRule> = new Map();
  private lastStats: SystemStats | null = null;
  
  constructor() {
    super();
    this.initDefaultAlertRules();
  }
  
  private initDefaultAlertRules(): void {
    this.alertRules.set('high-cpu', {
      id: 'high-cpu', metric: 'cpu', threshold: 90, condition: 'above', enabled: true,
    });
    this.alertRules.set('high-memory', {
      id: 'high-memory', metric: 'memory', threshold: 90, condition: 'above', enabled: true,
    });
    this.alertRules.set('low-disk', {
      id: 'low-disk', metric: 'disk', threshold: 10, condition: 'below', enabled: true,
    });
  }
  
  public startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.monitorInterval = setInterval(() => this.collectStats(), intervalMs);
    log.info('[SystemMonitor] Started monitoring');
  }
  
  public stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;
    log.info('[SystemMonitor] Stopped monitoring');
  }
  
  public async collectStats(): Promise<SystemStats> {
    const stats: SystemStats = {
      timestamp: Date.now(),
      cpu: this.getCpuInfo(),
      memory: this.getMemoryInfo(),
      disk: await this.getDiskInfo(),
      network: this.getNetworkInfo(),
      processes: this.getTopProcesses(),
    };
    
    this.lastStats = stats;
    this.checkAlerts(stats);
    this.emit('stats', stats);
    return stats;
  }
  
  private getCpuInfo(): SystemStats['cpu'] {
    const cpus = os.cpus();
    const cpu = cpus[0];
    const totalIdle = cpus.reduce((sum, c) => sum + c.times.idle, 0);
    const totalTick = cpus.reduce((sum, c) => sum + Object.values(c.times).reduce((a, b) => a + b, 0), 0);
    const usage = 100 - (totalIdle / totalTick * 100);
    
    return {
      usage: Math.round(usage * 100) / 100,
      cores: cpus.length,
      model: cpu.model,
      speed: cpu.speed,
    };
  }
  
  private getMemoryInfo(): SystemStats['memory'] {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total, used, free,
      usagePercent: Math.round((used / total) * 10000) / 100,
    };
  }
  
  private async getDiskInfo(): Promise<SystemStats['disk']> {
    // 简化实现
    return [{
      total: 500 * 1024 * 1024 * 1024,
      used: 250 * 1024 * 1024 * 1024,
      free: 250 * 1024 * 1024 * 1024,
      usagePercent: 50,
    }];
  }
  
  private getNetworkInfo(): SystemStats['network'] {
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs || []) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return { interface: name, rx: 0, tx: 0 };
        }
      }
    }
    return { interface: 'unknown', rx: 0, tx: 0 };
  }
  
  private getTopProcesses(): ProcessInfo[] {
    return [{
      pid: process.pid,
      name: 'Hermes Companion',
      cpu: 0,
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      threads: 1,
      startTime: Date.now(),
    }];
  }
  
  private checkAlerts(stats: SystemStats): void {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;
      
      let value: number | undefined;
      let metricName = '';
      
      switch (rule.metric) {
        case 'cpu': value = stats.cpu.usage; metricName = 'CPU'; break;
        case 'memory': value = stats.memory.usagePercent; metricName = 'Memory'; break;
        case 'disk': if (stats.disk.length > 0) { value = stats.disk[0].usagePercent; metricName = 'Disk'; } break;
      }
      
      if (value === undefined) continue;
      
      const shouldAlert = rule.condition === 'above' ? value > rule.threshold : value < rule.threshold;
      
      if (shouldAlert) {
        this.emit('alert', { rule, value, message: `${metricName} ${rule.condition} threshold: ${value.toFixed(1)}% (threshold: ${rule.threshold}%)` });
      }
    }
  }
  
  public addAlertRule(rule: Omit<AlertRule, 'id'>): AlertRule {
    const id = `rule-${Date.now()}`;
    const newRule: AlertRule = { ...rule, id };
    this.alertRules.set(id, newRule);
    return newRule;
  }
  
  public removeAlertRule(id: string): boolean {
    return this.alertRules.delete(id);
  }
  
  public getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }
  
  public getOverview(): { platform: string; hostname: string; uptime: number; cpuModel: string; cpuCores: number; totalMemory: string; homeDir: string } {
    return {
      platform: os.platform(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      cpuModel: os.cpus()[0].model,
      cpuCores: os.cpus().length,
      totalMemory: this.formatBytes(os.totalmem()),
      homeDir: os.homedir(),
    };
  }
  
  public formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(2)} ${units[i]}`;
  }
  
  public getLastStats(): SystemStats | null { return this.lastStats; }
  public isActive(): boolean { return this.isMonitoring; }
}

export default SystemMonitor;
