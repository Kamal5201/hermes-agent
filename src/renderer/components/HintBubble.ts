export interface HintAction {
  label: string;
  callback: () => void | Promise<void>;
}

export interface HintConfig {
  text: string;
  duration?: number;
  action?: HintAction;
  dismissLabel?: string;
  onDismiss?: () => void | Promise<void>;
  persistent?: boolean;
  tone?: 'hint' | 'active';
}

interface HintBubbleOptions {
  bubbleId?: string;
  textId?: string;
  acceptButtonId?: string;
  dismissButtonId?: string;
}

const DEFAULT_DURATION_MS = 3_000;

export class HintBubble {
  private readonly bubble: HTMLElement | null;
  private readonly text: HTMLElement | null;
  private readonly acceptButton: HTMLButtonElement | null;
  private readonly dismissButton: HTMLButtonElement | null;

  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private acceptHandler: (() => void) | null = null;
  private dismissHandler: (() => void) | null = null;

  constructor(options: HintBubbleOptions = {}) {
    this.bubble = document.getElementById(options.bubbleId ?? 'companion-hint-bubble');
    this.text = document.getElementById(options.textId ?? 'hint-text');
    this.acceptButton = document.getElementById(options.acceptButtonId ?? 'hint-accept') as HTMLButtonElement | null;
    this.dismissButton = document.getElementById(options.dismissButtonId ?? 'hint-dismiss') as HTMLButtonElement | null;
  }

  public show(config: HintConfig): void {
    if (!this.bubble || !this.text) {
      return;
    }

    this.clearHideTimeout();
    this.unbindHandlers();

    this.text.textContent = config.text;
    this.bubble.dataset.tone = config.tone ?? 'hint';
    this.bubble.classList.add('visible');
    this.bubble.setAttribute('aria-hidden', 'false');

    if (this.acceptButton) {
      if (config.action) {
        this.acceptButton.hidden = false;
        this.acceptButton.textContent = config.action.label;
        this.acceptHandler = () => {
          void Promise.resolve(config.action?.callback()).finally(() => {
            this.hide();
          });
        };
        this.acceptButton.addEventListener('click', this.acceptHandler, { once: true });
      } else {
        this.acceptButton.hidden = true;
      }
    }

    if (this.dismissButton) {
      this.dismissButton.hidden = false;
      this.dismissButton.textContent = config.dismissLabel ?? '忽略';
      this.dismissHandler = () => {
        void Promise.resolve(config.onDismiss?.()).finally(() => {
          this.hide();
        });
      };
      this.dismissButton.addEventListener('click', this.dismissHandler, { once: true });
    }

    if (!config.persistent) {
      const duration = config.duration ?? DEFAULT_DURATION_MS;
      this.hideTimeout = setTimeout(() => {
        this.hide();
      }, duration);
    }
  }

  public hide(): void {
    if (!this.bubble) {
      return;
    }

    this.clearHideTimeout();
    this.unbindHandlers();
    this.bubble.classList.remove('visible');
    this.bubble.setAttribute('aria-hidden', 'true');
  }

  public updateText(text: string): void {
    if (!this.text) {
      return;
    }

    this.text.textContent = text;
  }

  public isVisible(): boolean {
    return this.bubble?.classList.contains('visible') ?? false;
  }

  public dispose(): void {
    this.hide();
  }

  private clearHideTimeout(): void {
    if (!this.hideTimeout) {
      return;
    }

    clearTimeout(this.hideTimeout);
    this.hideTimeout = null;
  }

  private unbindHandlers(): void {
    if (this.acceptButton && this.acceptHandler) {
      this.acceptButton.removeEventListener('click', this.acceptHandler);
      this.acceptHandler = null;
    }

    if (this.dismissButton && this.dismissHandler) {
      this.dismissButton.removeEventListener('click', this.dismissHandler);
      this.dismissHandler = null;
    }
  }
}

export default HintBubble;
