/**
 * Smart Home Controller
 * 
 * Hermes Companion - 智能家居控制模块
 * 支持米家、HomeKit、Home Assistant 等平台
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  room: string;
  isOnline: boolean;
  state: Record<string, any>;
  capabilities: string[];
  platform: 'xiaomi' | 'homekit' | 'homeassistant' | 'generic';
}

export enum DeviceType {
  LIGHT = 'light',
  SWITCH = 'switch',
  SENSOR = 'sensor',
  THERMOSTAT = 'thermostat',
  LOCK = 'lock',
  CAMERA = 'camera',
  SPEAKER = 'speaker',
  TV = 'tv',
  AC = 'ac',
  FAN = 'fan',
  PLUG = 'plug',
  ROBOT_VACUUM = 'robot_vacuum',
  BLINDS = 'blinds',
  GARAGE_DOOR = 'garage_door',
  WATER_HEATER = 'water_heater',
  HUMIDIFIER = 'humidifier',
  AIR_PURIFIER = 'air_purifier',
}

export interface Scene {
  id: string;
  name: string;
  icon: string;
  actions: DeviceAction[];
}

export interface DeviceAction {
  deviceId: string;
  command: string;
  params: Record<string, any>;
}

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: DeviceAction[];
  enabled: boolean;
}

export interface AutomationTrigger {
  type: 'time' | 'device_state' | 'location' | 'voice' | 'manual';
  config: Record<string, any>;
}

export interface AutomationCondition {
  type: 'time_range' | 'device_state' | 'presence';
  config: Record<string, any>;
}

export class SmartHomeController extends EventEmitter {
  private devices: Map<string, Device> = new Map();
  private scenes: Map<string, Scene> = new Map();
  private automations: Map<string, Automation> = new Map();
  private platforms: Map<string, any> = new Map();
  
  constructor() {
    super();
    this.initDefaultScenes();
  }
  
  /**
   * 初始化默认场景
   */
  private initDefaultScenes(): void {
    // 回家场景
    this.scenes.set('welcome', {
      id: 'welcome',
      name: '回家',
      icon: '🏠',
      actions: [
        { deviceId: 'light-living', command: 'turn_on', params: { brightness: 80 } },
        { deviceId: 'ac-living', command: 'turn_on', params: { temperature: 24 } },
      ],
    });
    
    // 离家场景
    this.scenes.set('goodbye', {
      id: 'goodbye',
      name: '离家',
      icon: '👋',
      actions: [
        { deviceId: 'light-all', command: 'turn_off', params: {} },
        { deviceId: 'ac-all', command: 'turn_off', params: {} },
        { deviceId: 'lock-main', command: 'lock', params: {} },
      ],
    });
    
    // 电影场景
    this.scenes.set('movie', {
      id: 'movie',
      name: '电影模式',
      icon: '🎬',
      actions: [
        { deviceId: 'light-living', command: 'turn_on', params: { brightness: 20, color: '#FFE4B5' } },
        { deviceId: 'tv-living', command: 'turn_on', params: {} },
        { deviceId: 'ac-living', command: 'turn_on', params: { temperature: 22 } },
      ],
    });
    
    // 睡眠场景
    this.scenes.set('sleep', {
      id: 'sleep',
      name: '晚安',
      icon: '😴',
      actions: [
        { deviceId: 'light-all', command: 'turn_off', params: {} },
        { deviceId: 'ac-bedroom', command: 'turn_on', params: { temperature: 26 } },
        { deviceId: 'humidifier-bedroom', command: 'turn_on', params: {} },
      ],
    });
  }
  
  /**
   * 注册平台
   */
  public registerPlatform(name: string, platform: any): void {
    this.platforms.set(name, platform);
    log.info(`[SmartHome] Registered platform: ${name}`);
  }
  
  /**
   * 发现设备
   */
  public async discoverDevices(platform: string): Promise<Device[]> {
    const p = this.platforms.get(platform);
    if (!p) {
      throw new Error(`Platform not found: ${platform}`);
    }
    
    try {
      const devices = await p.discover();
      for (const device of devices) {
        this.devices.set(device.id, device);
      }
      this.emit('devicesDiscovered', devices);
      return devices;
    } catch (error) {
      log.error(`[SmartHome] Discovery failed:`, error);
      throw error;
    }
  }
  
  /**
   * 获取所有设备
   */
  public getDevices(): Device[] {
    return Array.from(this.devices.values());
  }
  
  /**
   * 按房间获取设备
   */
  public getDevicesByRoom(room: string): Device[] {
    return this.getDevices().filter(d => d.room === room);
  }
  
  /**
   * 按类型获取设备
   */
  public getDevicesByType(type: DeviceType): Device[] {
    return this.getDevices().filter(d => d.type === type);
  }
  
  /**
   * 控制设备
   */
  public async controlDevice(deviceId: string, command: string, params: Record<string, any> = {}): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    
    log.info(`[SmartHome] Controlling ${device.name}: ${command}`, params);
    
    try {
      const platform = this.platforms.get(device.platform);
      if (platform) {
        await platform.sendCommand(deviceId, command, params);
        
        // 更新设备状态
        device.state = { ...device.state, ...params };
        this.emit('deviceStateChanged', device);
      }
    } catch (error) {
      log.error(`[SmartHome] Control failed:`, error);
      throw error;
    }
  }
  
  /**
   * 执行场景
   */
  public async executeScene(sceneId: string): Promise<void> {
    const scene = this.scenes.get(sceneId);
    if (!scene) {
      throw new Error(`Scene not found: ${sceneId}`);
    }
    
    log.info(`[SmartHome] Executing scene: ${scene.name}`);
    this.emit('sceneStarted', scene);
    
    for (const action of scene.actions) {
      try {
        await this.controlDevice(action.deviceId, action.command, action.params);
      } catch (error) {
        log.error(`[SmartHome] Scene action failed:`, error);
      }
    }
    
    this.emit('sceneCompleted', scene);
  }
  
  /**
   * 创建自动化
   */
  public createAutomation(automation: Omit<Automation, 'id'>): Automation {
    const id = `auto-${Date.now()}`;
    const auto: Automation = { ...automation, id };
    this.automations.set(id, auto);
    
    // 设置触发器监听
    this.setupAutomationTrigger(auto);
    
    log.info(`[SmartHome] Created automation: ${automation.name}`);
    return auto;
  }
  
  /**
   * 设置自动化触发器
   */
  private setupAutomationTrigger(automation: Automation): void {
    const trigger = automation.trigger;
    
    switch (trigger.type) {
      case 'time':
        this.setupTimeTrigger(automation);
        break;
      case 'device_state':
        this.setupDeviceStateTrigger(automation);
        break;
      case 'location':
        this.setupLocationTrigger(automation);
        break;
    }
  }
  
  private setupTimeTrigger(automation: Automation): void {
    const config = automation.trigger.config as { time: string; days?: string[] };
    // 解析时间并设置定时器
    const [hours, minutes] = config.time.split(':').map(Number);
    
    const checkAndRun = () => {
      const now = new Date();
      if (now.getHours() === hours && now.getMinutes() === minutes) {
        if (this.checkConditions(automation.conditions)) {
          this.executeAutomation(automation);
        }
      }
    };
    
    // 每分钟检查一次
    setInterval(checkAndRun, 60000);
  }
  
  private setupDeviceStateTrigger(automation: Automation): void {
    const config = automation.trigger.config as { deviceId: string; state: string; value: any };
    
    this.on('deviceStateChanged', (device: Device) => {
      if (device.id === config.deviceId && device.state[config.state] === config.value) {
        if (this.checkConditions(automation.conditions)) {
          this.executeAutomation(automation);
        }
      }
    });
  }
  
  private setupLocationTrigger(automation: Automation): void {
    const config = automation.trigger.config as { event: 'arrive' | 'leave'; zone: string };
    // 监听位置变化事件
    this.on('locationChange', (location: { event: string; zone: string }) => {
      if (location.event === config.event && location.zone === config.zone) {
        if (this.checkConditions(automation.conditions)) {
          this.executeAutomation(automation);
        }
      }
    });
  }
  
  private checkConditions(conditions: AutomationCondition[]): boolean {
    for (const condition of conditions) {
      switch (condition.type) {
        case 'time_range':
          const timeConfig = condition.config as { start: string; end: string };
          const now = new Date();
          const currentTime = now.getHours() * 60 + now.getMinutes();
          const [startH, startM] = timeConfig.start.split(':').map(Number);
          const [endH, endM] = timeConfig.end.split(':').map(Number);
          const start = startH * 60 + startM;
          const end = endH * 60 + endM;
          if (currentTime < start || currentTime > end) return false;
          break;
      }
    }
    return true;
  }
  
  private async executeAutomation(automation: Automation): Promise<void> {
    log.info(`[SmartHome] Executing automation: ${automation.name}`);
    this.emit('automationExecuted', automation);
    
    for (const action of automation.actions) {
      await this.controlDevice(action.deviceId, action.command, action.params);
    }
  }
  
  // ========== 快捷操作 ==========
  
  public async turnOnAllLights(): Promise<void> {
    const lights = this.getDevicesByType(DeviceType.LIGHT);
    for (const light of lights) {
      await this.controlDevice(light.id, 'turn_on', {});
    }
  }
  
  public async turnOffAllLights(): Promise<void> {
    const lights = this.getDevicesByType(DeviceType.LIGHT);
    for (const light of lights) {
      await this.controlDevice(light.id, 'turn_off', {});
    }
  }
  
  public async setThermostat(temperature: number): Promise<void> {
    const thermostats = this.getDevicesByType(DeviceType.THERMOSTAT);
    for (const thermostat of thermostats) {
      await this.controlDevice(thermostat.id, 'set_temperature', { temperature });
    }
  }
  
  public async lockAllDoors(): Promise<void> {
    const locks = this.getDevicesByType(DeviceType.LOCK);
    for (const lock of locks) {
      await this.controlDevice(lock.id, 'lock', {});
    }
  }
  
  public async startRobotVacuum(): Promise<void> {
    const vacuums = this.getDevicesByType(DeviceType.ROBOT_VACUUM);
    for (const vacuum of vacuums) {
      await this.controlDevice(vacuum.id, 'start', {});
    }
  }
  
  public getScenes(): Scene[] {
    return Array.from(this.scenes.values());
  }
  
  public getAutomations(): Automation[] {
    return Array.from(this.automations.values());
  }
}

export default SmartHomeController;
