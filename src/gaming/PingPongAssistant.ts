import log from 'electron-log/main.js';
import { BaseGameModule, GameAction, GameFeedback, GameType, Point } from './GameAssistant';

export interface PingPongBallState {
  position: Point;
  velocity: Point;
  spin?: number;
}

export interface PingPongPaddleState {
  center: Point;
  width: number;
  height: number;
}

export interface PingPongConfig {
  tableWidth: number;
  tableHeight: number;
  paddleReactionBias: number;
  minimumConfidence: number;
}

export interface PingPongGameState {
  gameType: GameType;
  timestamp: number;
  screenWidth: number;
  screenHeight: number;
  isActive: boolean;
  ball: PingPongBallState | null;
  playerPaddle: PingPongPaddleState;
  opponentPaddle?: PingPongPaddleState;
}

const DEFAULT_CONFIG: PingPongConfig = {
  tableWidth: 1920,
  tableHeight: 1080,
  paddleReactionBias: 0,
  minimumConfidence: 0.4,
};

export class PingPongAssistant extends BaseGameModule {
  public readonly gameType = GameType.PING_PONG;
  public readonly name = 'Ping Pong Assistant';

  private config: PingPongConfig;
  private learnedReactionBias = 0;

  constructor(config: Partial<PingPongConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  public async captureState(): Promise<PingPongGameState> {
    return {
      gameType: this.gameType,
      timestamp: Date.now(),
      screenWidth: this.config.tableWidth,
      screenHeight: this.config.tableHeight,
      isActive: true,
      ball: null,
      playerPaddle: {
        center: { x: this.config.tableWidth / 2, y: this.config.tableHeight - 80 },
        width: 240,
        height: 24,
      },
    };
  }

  public async analyzeState(state: PingPongGameState): Promise<GameAction | null> {
    if (!state.ball) {
      return null;
    }

    const intercept = this.predictIntercept(state.ball, state.playerPaddle.center.y);
    const offset = intercept.x - state.playerPaddle.center.x;
    const confidence = this.computeConfidence(state.ball, offset);

    if (confidence < this.config.minimumConfidence) {
      return null;
    }

    return {
      type: 'move',
      params: {
        x: intercept.x,
        y: state.playerPaddle.center.y,
        duration: Math.max(60, Math.round(intercept.timeToImpactMs)),
      },
      confidence,
      estimatedOutcome: `拦截点 ${Math.round(intercept.x)}, 预计 ${Math.round(intercept.timeToImpactMs)}ms 后触球`,
    };
  }

  public async executeAction(action: GameAction): Promise<void> {
    log.info('[PingPongAssistant] executeAction', action);
  }

  public learn(feedback: GameFeedback): void {
    super.learn(feedback);

    const reward = feedback.reward ?? (feedback.result === 'success' ? 1 : feedback.result === 'partial' ? 0.4 : -1);
    this.learnedReactionBias = Math.max(-80, Math.min(80, this.learnedReactionBias + (reward * 4)));
  }

  private predictIntercept(ball: PingPongBallState, targetY: number): { x: number; timeToImpactMs: number } {
    const deltaY = targetY - ball.position.y;
    const safeVelocityY = Math.abs(ball.velocity.y) < 0.01 ? 0.01 : ball.velocity.y;
    const timeToImpactMs = Math.abs((deltaY / safeVelocityY) * 16.67);
    const projectedX = ball.position.x + (ball.velocity.x * (timeToImpactMs / 16.67));
    const clampedX = Math.max(0, Math.min(this.config.tableWidth, projectedX + this.learnedReactionBias + this.config.paddleReactionBias));

    return {
      x: clampedX,
      timeToImpactMs,
    };
  }

  private computeConfidence(ball: PingPongBallState, offset: number): number {
    const speed = Math.sqrt((ball.velocity.x ** 2) + (ball.velocity.y ** 2));
    const speedFactor = Math.max(0.2, 1 - Math.min(speed / 120, 0.7));
    const offsetFactor = Math.max(0.2, 1 - Math.min(Math.abs(offset) / (this.config.tableWidth / 2), 0.7));
    return Math.min(0.95, speedFactor * 0.55 + offsetFactor * 0.45);
  }
}

export default PingPongAssistant;
