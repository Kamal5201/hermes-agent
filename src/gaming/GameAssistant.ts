/**
 * Game Assistant Framework
 * 
 * Hermes Companion - 游戏辅助框架
 * 支持台球、乒乓球等游戏
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

export interface Point {
  x: number;
  y: number;
}

export interface GameState {
  gameType: GameType;
  timestamp: number;
  screenWidth: number;
  screenHeight: number;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

export enum GameType {
  BILLIARDS = 'billiards',
  PING_PONG = 'ping_pong',
  CHESS = 'chess',
  GO = 'go',
  FPS = 'fps',
  RTS = 'rts',
  MOBA = 'moba',
  ARCADE = 'arcade',
}

export interface GameAction {
  type: 'move' | 'click' | 'key' | 'shoot' | 'aim' | 'custom';
  params: {
    x?: number;
    y?: number;
    key?: string;
    duration?: number;
    power?: number;
    angle?: number;
  };
  confidence: number;
  estimatedOutcome: string;
}

export interface GameFeedback {
  action: GameAction;
  result: 'success' | 'failure' | 'partial';
  score?: number;
  reward?: number;
  confidence?: number;
}

export abstract class BaseGameModule extends EventEmitter {
  protected gameState: GameState | null = null;
  protected isActive: boolean = false;
  
  abstract readonly gameType: GameType;
  abstract readonly name: string;
  
  public async initialize(): Promise<void> {
    log.info(`[GameAssistant] Initializing ${this.name}`);
    this.isActive = true;
    this.emit('initialized');
  }
  
  public async shutdown(): Promise<void> {
    log.info(`[GameAssistant] Shutting down ${this.name}`);
    this.isActive = false;
    this.emit('shutdown');
  }
  
  public abstract captureState(): Promise<GameState>;
  
  public abstract analyzeState(state: GameState): Promise<GameAction | null>;
  
  public abstract executeAction(action: GameAction): Promise<void>;
  
  public learn(feedback: GameFeedback): void {
    log.info(`[GameAssistant] Learning from feedback: ${feedback.result}`);
    this.emit('learn', feedback);
  }
  
}

export class GameAssistant extends EventEmitter {
  private modules: Map<GameType, BaseGameModule> = new Map();
  private activeModule: BaseGameModule | null = null;
  
  public registerModule(module: BaseGameModule): void {
    this.modules.set(module.gameType, module);
    module.on('learn', (feedback: GameFeedback) => {
      this.emit('learn', feedback);
    });
    log.info(`[GameAssistant] Registered module: ${module.name}`);
  }
  
  public async startGame(gameType: GameType): Promise<void> {
    const module = this.modules.get(gameType);
    if (!module) {
      throw new Error(`No module for game type: ${gameType}`);
    }
    
    if (this.activeModule) {
      await this.activeModule.shutdown();
    }
    
    await module.initialize();
    this.activeModule = module;
    this.emit('gameStarted', gameType);
  }
  
  public async stopGame(): Promise<void> {
    if (this.activeModule) {
      await this.activeModule.shutdown();
      this.activeModule = null;
      this.emit('gameStopped');
    }
  }
  
  public async getNextAction(): Promise<GameAction | null> {
    if (!this.activeModule) return null;
    
    const state = await this.activeModule.captureState();
    return this.activeModule.analyzeState(state);
  }
  
  public async executeAction(action: GameAction): Promise<void> {
    if (!this.activeModule) {
      throw new Error('No active game');
    }
    await this.activeModule.executeAction(action);
  }
  
  public provideFeedback(feedback: GameFeedback): void {
    if (!this.activeModule) {
      throw new Error('No active game');
    }
    this.activeModule.learn(feedback);
  }
  
  public getRegisteredGames(): GameType[] {
    return Array.from(this.modules.keys());
  }
}

export default GameAssistant;
