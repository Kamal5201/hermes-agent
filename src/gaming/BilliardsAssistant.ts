/**
 * Billiards Assistant
 * 
 * Hermes Companion - 台球辅助模块
 * 使用视觉识别 + 物理计算提供击球建议
 */

import { BaseGameModule, GameType, Point, GameAction, GameFeedback } from './GameAssistant';
import { PerceptionModule } from '../perception/PerceptionModule';

export interface Ball {
  id: string;
  color: string;
  position: Point;
  pocketed: boolean;
}

export interface Pocket {
  id: string;
  position: Point;
  radius: number;
}

export interface Shot {
  ball: Ball;
  targetPocket: Pocket;
  cuePosition: Point;
  cueAngle: number;      // 杆角度 (弧度)
  power: number;         // 力度 0-100
  english: number;       // 偏塞 -1 to 1
  difficulty: number;     // 难度 0-1
  confidence: number;    // 置信度 0-1
  estimatedPath: Point[]; // 预估轨迹
}

export interface BilliardsConfig {
  tableColor: string;
  tableWidth: number;
  tableHeight: number;
  pocketRadius: number;
  ballRadius: number;
  friction: number;       // 摩擦系数
}

const DEFAULT_CONFIG: BilliardsConfig = {
  tableColor: '#0a5c36',
  tableWidth: 2540,      // 9尺球台 (像素)
  tableHeight: 1270,
  pocketRadius: 25,
  ballRadius: 14,
  friction: 0.985,
};

export class BilliardsAssistant extends BaseGameModule {
  readonly gameType = GameType.BILLIARDS;
  readonly name = 'Billiards Assistant';
  
  private config: BilliardsConfig;
  private perception: PerceptionModule | null = null;
  
  // 学习数据
  private shotHistory: Shot[] = [];
  private successRate: number = 0.7;
  
  constructor(config: Partial<BilliardsConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  public setPerception(perception: PerceptionModule): void {
    this.perception = perception;
  }
  
  public async captureState(): Promise<{
    gameType: GameType;
    timestamp: number;
    screenWidth: number;
    screenHeight: number;
    isActive: boolean;
    balls: Ball[];
    cueBall: Ball | null;
    pockets: Pocket[];
  }> {
    // 模拟状态捕获
    // 实际实现需要图像识别
    return {
      gameType: this.gameType,
      timestamp: Date.now(),
      screenWidth: 1920,
      screenHeight: 1080,
      isActive: true,
      balls: [],
      cueBall: null,
      pockets: this.getDefaultPockets(),
    };
  }
  
  public async analyzeState(state: {
    balls: Ball[];
    cueBall: Ball | null;
    pockets: Pocket[];
  }): Promise<GameAction | null> {
    if (!state.cueBall || state.balls.length === 0) {
      return null;
    }
    
    const shot = this.calculateOptimalShot(state.balls, state.cueBall, state.pockets);
    
    if (!shot) return null;
    
    return {
      type: 'aim',
      params: {
        x: shot.cuePosition.x,
        y: shot.cuePosition.y,
        angle: shot.cueAngle,
        power: shot.power,
      },
      confidence: shot.confidence,
      estimatedOutcome: `目标球入 ${shot.targetPocket.id}, 难度 ${Math.round(shot.difficulty * 100)}%`,
    };
  }
  
  public async executeAction(action: GameAction): Promise<void> {
    // 使用 ExecutionModule 移动鼠标并点击
    log.info(`[Billiards] Executing shot: ${JSON.stringify(action)}`);
    // TODO: 实现鼠标瞄准和点击
  }
  
  public learn(feedback: GameFeedback): void {
    super.learn(feedback);
    
    const shot = feedback.action.params;
    this.shotHistory.push({
      ball: { id: 'learned', color: 'white', position: { x: shot.x || 0, y: shot.y || 0 }, pocketed: false },
      targetPocket: { id: 'learned', position: { x: 0, y: 0 }, radius: 25 },
      cuePosition: { x: shot.x || 0, y: shot.y || 0 },
      cueAngle: shot.angle || 0,
      power: shot.power || 50,
      english: 0,
      difficulty: 1 - feedback.confidence,
      confidence: feedback.confidence,
      estimatedPath: [],
    });
    
    // 更新成功率
    if (feedback.result === 'success') {
      this.successRate = Math.min(0.99, this.successRate + 0.01);
    } else if (feedback.result === 'failure') {
      this.successRate = Math.max(0.1, this.successRate - 0.02);
    }
  }
  
  /**
   * 计算最优击球
   */
  private calculateOptimalShot(
    balls: Ball[],
    cueBall: Ball,
    pockets: Pocket[]
  ): Shot | null {
    const availableBalls = balls.filter(b => !b.pocketed);
    
    if (availableBalls.length === 0) return null;
    
    let bestShot: Shot | null = null;
    let bestScore = -1;
    
    for (const ball of availableBalls) {
      for (const pocket of pockets) {
        const shot = this.calculateShot(ball, pocket, cueBall);
        if (shot) {
          // 计分: 低难度 + 高置信度 + 历史成功率
          const score = (1 - shot.difficulty) * 0.4 + shot.confidence * 0.3 + this.successRate * 0.3;
          
          if (score > bestScore) {
            bestScore = score;
            bestShot = shot;
          }
        }
      }
    }
    
    return bestShot;
  }
  
  /**
   * 计算单个击球
   */
  private calculateShot(ball: Ball, targetPocket: Pocket, cueBall: Ball): Shot | null {
    // 计算目标球到袋口的直线
    const dx = targetPocket.position.x - ball.position.x;
    const dy = targetPocket.position.y - ball.position.y;
    const distanceToPocket = Math.sqrt(dx * dx + dy * dy);
    
    if (distanceToPocket < this.config.pocketRadius * 2) {
      return null; // 球太靠近袋口
    }
    
    // 计算杆头位置 (瞄准目标球的相反方向)
    const angleToPocket = Math.atan2(dy, dx);
    const angleToCue = angleToPocket + Math.PI; // 相反方向
    
    const cueDistance = 100; // 杆头距离白球的位置
    const cuePosition: Point = {
      x: cueBall.position.x + Math.cos(angleToCue) * cueDistance,
      y: cueBall.position.y + Math.sin(angleToCue) * cueDistance,
    };
    
    // 计算难度 (基于距离和角度)
    const distance = Math.sqrt(
      Math.pow(ball.position.x - cueBall.position.x, 2) +
      Math.pow(ball.position.y - cueBall.position.y, 2)
    );
    
    const difficulty = Math.min(1, distance / 1000 + Math.abs(angleToCue - angleToPocket) / Math.PI);
    
    // 计算置信度
    const confidence = Math.max(0.1, 1 - difficulty * 0.8);
    
    return {
      ball,
      targetPocket,
      cuePosition,
      cueAngle: angleToCue,
      power: 50 + (1 - difficulty) * 30, // 远距离需要更大力度
      english: 0,
      difficulty,
      confidence,
      estimatedPath: [cueBall.position, ball.position, targetPocket.position],
    };
  }
  
  /**
   * 获取默认袋口位置 (6袋球台)
   */
  private getDefaultPockets(): Pocket[] {
    const w = this.config.tableWidth;
    const h = this.config.tableHeight;
    const r = this.config.pocketRadius;
    
    return [
      { id: 'top-left', position: { x: r, y: r }, radius: r },
      { id: 'top-middle', position: { x: w / 2, y: r - 5 }, radius: r },
      { id: 'top-right', position: { x: w - r, y: r }, radius: r },
      { id: 'bottom-left', position: { x: r, y: h - r }, radius: r },
      { id: 'bottom-middle', position: { x: w / 2, y: h - r + 5 }, radius: r },
      { id: 'bottom-right', position: { x: w - r, y: h - r }, radius: r },
    ];
  }
}

export default BilliardsAssistant;
