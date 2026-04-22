export enum UIState {
  STEALTH = 'stealth',
  OBSERVING = 'observing',
  HINT = 'hint',
  ACTIVE = 'active',
  RETREATING = 'retreating',
}

export interface RenderOutput {
  state: UIState;
  visible: boolean;
  orbClassName: string;
  bubbleClassName: string;
  bubbleText: string | null;
  cssVariables: Record<string, string>;
  context: Record<string, unknown>;
}

export class AppleStyleUI {
  private static instance: AppleStyleUI | null = null;

  private currentState: UIState = UIState.STEALTH;
  private bubbleText: string | null = null;
  private context: Record<string, unknown> = {};

  private readonly stateStyles: Record<UIState, { color: string; opacity: number }> = {
    [UIState.STEALTH]: { color: 'transparent', opacity: 0 },
    [UIState.OBSERVING]: { color: '#4A90D9', opacity: 0.3 },
    [UIState.HINT]: { color: '#FFD700', opacity: 0.6 },
    [UIState.ACTIVE]: { color: '#FF6B35', opacity: 0.8 },
    [UIState.RETREATING]: { color: '#FF6B35', opacity: 0.4 },
  };

  public static getInstance(): AppleStyleUI {
    if (!AppleStyleUI.instance) {
      AppleStyleUI.instance = new AppleStyleUI();
    }

    return AppleStyleUI.instance;
  }

  public render(state: UIState, context: Record<string, unknown> = {}): RenderOutput {
    const styles = this.stateStyles[state];
    const bubbleVisible = Boolean(this.bubbleText) && state !== UIState.STEALTH;

    return {
      state,
      visible: state !== UIState.STEALTH,
      orbClassName: `companion-orb state-${state}`,
      bubbleClassName: `companion-bubble state-${state}${bubbleVisible ? ' visible' : ''}`,
      bubbleText: bubbleVisible ? this.bubbleText : null,
      cssVariables: {
        '--state-color': styles.color,
        '--state-opacity': styles.opacity.toString(),
        '--breathing-duration': '2s',
        '--retreat-duration': '300ms',
      },
      context: {
        ...this.context,
        ...context,
      },
    };
  }

  public showHint(text: string): void {
    this.bubbleText = text;
    this.currentState = UIState.HINT;
  }

  public showActive(intent: string): void {
    this.bubbleText = intent;
    this.currentState = UIState.ACTIVE;
  }

  public hide(): void {
    this.currentState = UIState.STEALTH;
    this.bubbleText = null;
  }

  public showRetreat(): void {
    this.currentState = UIState.RETREATING;
    this.bubbleText = '先退到旁边，有需要随时叫我。';
  }

  public updateState(state: UIState): void {
    this.currentState = state;

    if (state === UIState.STEALTH) {
      this.bubbleText = null;
    }

    if (state === UIState.OBSERVING) {
      this.bubbleText = '静静观察你的节奏';
    }
  }

  public updateContext(context: Record<string, unknown>): void {
    this.context = {
      ...this.context,
      ...context,
    };
  }

  public getCurrentState(): UIState {
    return this.currentState;
  }
}

export function companionStateToUiState(state: string): UIState {
  switch (state.toLowerCase()) {
    case UIState.OBSERVING:
      return UIState.OBSERVING;
    case UIState.HINT:
      return UIState.HINT;
    case UIState.ACTIVE:
      return UIState.ACTIVE;
    case UIState.RETREATING:
      return UIState.RETREATING;
    case UIState.STEALTH:
    default:
      return UIState.STEALTH;
  }
}

export default AppleStyleUI;
