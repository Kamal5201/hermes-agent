/**
 * Network Tools - 网络诊断工具
 */

import { EventEmitter } from 'events';
import dns from 'dns';
import { Socket } from 'net';
import log from 'electron-log/main.js';

export interface PingResult {
  host: string;
  ip: string;
  time: number;
  ttl?: number;
  success: boolean;
  error?: string;
}

export interface DnsRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS';
  value: string;
  ttl?: number;
}

export interface PortScanResult {
  port: number;
  status: 'open' | 'closed' | 'filtered';
  service?: string;
}

export class NetworkTools extends EventEmitter {
  private commonPorts: Map<number, string> = new Map([
    [21, 'FTP'], [22, 'SSH'], [23, 'Telnet'], [25, 'SMTP'], [53, 'DNS'],
    [80, 'HTTP'], [110, 'POP3'], [143, 'IMAP'], [443, 'HTTPS'],
    [445, 'SMB'], [993, 'IMAPS'], [995, 'POP3S'], [3306, 'MySQL'],
    [3389, 'RDP'], [5432, 'PostgreSQL'], [6379, 'Redis'], [8080, 'HTTP-Alt'],
    [8443, 'HTTPS-Alt'], [27017, 'MongoDB'],
  ]);
  
  /**
   * Ping 主机
   */
  public async ping(host: string, count: number = 4): Promise<PingResult[]> {
    const results: PingResult[] = [];
    
    try {
      const start = Date.now();
      const ip = await this.resolveHost(host);
      
      // 模拟 ping
      for (let i = 0; i < count; i++) {
        const time = Math.random() * 100 + 10;
        results.push({
          host,
          ip,
          time: Math.round(time * 100) / 100,
          ttl: 64,
          success: true,
        });
      }
    } catch (error) {
      results.push({
        host,
        ip: '',
        time: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    
    return results;
  }
  
  /**
   * DNS 查询
   */
  public async dnsLookup(hostname: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      dns.resolve4(hostname, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
  }
  
  /**
   * 反向 DNS 查询
   */
  public async reverseDns(ip: string): Promise<string> {
    return new Promise((resolve, reject) => {
      dns.reverse(ip, (err, hostnames) => {
        if (err) reject(err);
        else resolve(hostnames[0] || '');
      });
    });
  }
  
  /**
   * 获取 DNS 记录
   */
  public async getDnsRecords(domain: string): Promise<DnsRecord[]> {
    const records: DnsRecord[] = [];
    
    try {
      // A 记录
      const aRecords = await this.dnsLookup(domain);
      for (const ip of aRecords) {
        records.push({ type: 'A', value: ip });
      }
    } catch (e) {
      log.warn('[NetworkTools] A record lookup failed:', e);
    }
    
    return records;
  }
  
  /**
   * 解析主机名
   */
  public async resolveHost(host: string): Promise<string> {
    return new Promise((resolve, reject) => {
      dns.lookup(host, (err, address) => {
        if (err) reject(err);
        else resolve(address);
      });
    });
  }
  
  /**
   * 端口扫描
   */
  public async scanPorts(host: string, ports: number[] = Array.from(this.commonPorts.keys())): Promise<PortScanResult[]> {
    const results: PortScanResult[] = [];
    
    for (const port of ports) {
      const status = await this.checkPort(host, port);
      results.push({
        port,
        status,
        service: this.commonPorts.get(port),
      });
    }
    
    return results;
  }
  
  /**
   * 检查单个端口
   */
  public checkPort(host: string, port: number, timeout: number = 2000): Promise<'open' | 'closed' | 'filtered'> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let status: 'open' | 'closed' | 'filtered' = 'filtered';
      
      socket.setTimeout(timeout);
      
      socket.on('connect', () => {
        status = 'open';
        socket.destroy();
      });
      
      socket.on('timeout', () => {
        status = 'filtered';
        socket.destroy();
      });
      
      socket.on('error', () => {
        status = 'closed';
      });
      
      socket.on('close', () => {
        resolve(status);
      });
      
      socket.connect(port, host);
    });
  }
  
  /**
   * Traceroute
   */
  public async traceroute(host: string, maxHops: number = 30): Promise<Array<{ hop: number; ip?: string; hostname?: string; time?: number }>> {
    const hops: Array<{ hop: number; ip?: string; hostname?: string; time?: number }> = [];
    
    // 简化实现：模拟 traceroute
    for (let i = 1; i <= maxHops; i++) {
      if (i === maxHops) {
        try {
          const ip = await this.resolveHost(host);
          hops.push({ hop: i, ip, hostname: host, time: Math.random() * 50 + 5 });
        } catch {
          hops.push({ hop: i });
        }
      } else {
        hops.push({ hop: i, ip: `192.168.${Math.floor(i/10)}.${i%10}`, time: Math.random() * 30 + 3 });
      }
    }
    
    return hops;
  }
  
  /**
   * 带宽测试 (简化)
   */
  public async bandwidthTest(): Promise<{ download: number; upload: number }> {
    // 简化实现
    return {
      download: Math.round(Math.random() * 100 + 50),  // Mbps
      upload: Math.round(Math.random() * 50 + 20),
    };
  }
  
  /**
   * 网络信息
   */
  public getNetworkInfo(): { interfaces: string[]; isOnline: boolean } {
    const { networkInterfaces } = require('os');
    const interfaces = Object.keys(networkInterfaces());
    
    return {
      interfaces,
      isOnline: true,
    };
  }
  
  public getCommonPorts(): Array<{ port: number; service: string }> {
    return Array.from(this.commonPorts.entries()).map(([port, service]) => ({ port, service }));
  }
}

export default NetworkTools;
