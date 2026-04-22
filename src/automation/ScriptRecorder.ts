import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { ExecutionModule, type MouseButtonName } from '../mcp/ExecutionModule';

export type ScriptActionType =
  | 'click'
  | 'double_click'
  | 'move_mouse'
  | 'drag'
  | 'scroll'
  | 'type_text'
  | 'press_key'
  | 'hotkey'
  | 'open_app'
  | 'close_app'
  | 'wait';

export interface ScriptStep {
  type: ScriptActionType;
  timestampOffsetMs: number;
  params: Record<string, unknown>;
}

export interface RecordedScript {
  name: string;
  createdAt: number;
  updatedAt: number;
  steps: ScriptStep[];
  metadata?: Record<string, unknown>;
}

export interface PlaybackOptions {
  respectTiming?: boolean;
  speedMultiplier?: number;
}

export class ScriptRecorder {
  private recording: RecordedScript | null = null;
  private recordingStartedAt = 0;

  public startRecording(name: string, metadata?: Record<string, unknown>): void {
    const now = Date.now();
    this.recordingStartedAt = now;
    this.recording = {
      name,
      createdAt: now,
      updatedAt: now,
      steps: [],
      metadata,
    };
  }

  public recordStep(type: ScriptActionType, params: Record<string, unknown>): void {
    if (!this.recording) {
      throw new Error('No active recording');
    }

    this.recording.steps.push({
      type,
      params,
      timestampOffsetMs: Date.now() - this.recordingStartedAt,
    });
    this.recording.updatedAt = Date.now();
  }

  public stopRecording(): RecordedScript | null {
    const completed = this.recording;
    this.recording = null;
    this.recordingStartedAt = 0;
    return completed;
  }

  public getActiveRecording(): RecordedScript | null {
    return this.recording ? {
      ...this.recording,
      steps: [...this.recording.steps],
    } : null;
  }

  public async playback(
    script: RecordedScript,
    execution: ExecutionModule,
    options: PlaybackOptions = {},
  ): Promise<void> {
    const respectTiming = options.respectTiming ?? true;
    const speedMultiplier = options.speedMultiplier ?? 1;
    let previousOffset = 0;

    for (const step of script.steps) {
      if (respectTiming) {
        const waitMs = Math.max(0, (step.timestampOffsetMs - previousOffset) / Math.max(speedMultiplier, 0.1));
        await execution.wait(waitMs);
      }

      await this.executeStep(step, execution);
      previousOffset = step.timestampOffsetMs;
    }
  }

  public async saveToFile(script: RecordedScript, filePath: string): Promise<void> {
    const target = resolve(filePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(script, null, 2), 'utf8');
  }

  public async loadFromFile(filePath: string): Promise<RecordedScript> {
    const raw = await readFile(resolve(filePath), 'utf8');
    return JSON.parse(raw) as RecordedScript;
  }

  private async executeStep(step: ScriptStep, execution: ExecutionModule): Promise<void> {
    switch (step.type) {
      case 'click':
        await execution.click(
          this.requireNumber(step.params, 'x'),
          this.requireNumber(step.params, 'y'),
          this.getMouseButton(step.params, 'button'),
        );
        return;
      case 'double_click':
        await execution.doubleClick(
          this.requireNumber(step.params, 'x'),
          this.requireNumber(step.params, 'y'),
          this.getMouseButton(step.params, 'button'),
        );
        return;
      case 'move_mouse':
        await execution.moveMouse(
          this.requireNumber(step.params, 'x'),
          this.requireNumber(step.params, 'y'),
        );
        return;
      case 'drag':
        await execution.drag(
          this.requireNumber(step.params, 'fromX'),
          this.requireNumber(step.params, 'fromY'),
          this.requireNumber(step.params, 'toX'),
          this.requireNumber(step.params, 'toY'),
        );
        return;
      case 'scroll':
        await execution.scroll(
          this.getOptionalNumber(step.params, 'ySteps') ?? 0,
          this.getOptionalNumber(step.params, 'xSteps') ?? 0,
        );
        return;
      case 'type_text':
        await execution.typeText(this.requireString(step.params, 'text'));
        return;
      case 'press_key':
        await execution.pressKey(this.requireString(step.params, 'key'));
        return;
      case 'hotkey':
        await execution.hotkey(...this.requireStringArray(step.params, 'keys'));
        return;
      case 'open_app':
        await execution.openApp(this.requireString(step.params, 'bundleId'));
        return;
      case 'close_app':
        await execution.closeApp(this.requireString(step.params, 'bundleId'));
        return;
      case 'wait':
        await execution.wait(this.requireNumber(step.params, 'ms'));
        return;
      default:
        throw new Error(`Unsupported script step: ${step.type}`);
    }
  }

  private requireNumber(source: Record<string, unknown>, key: string): number {
    const value = source[key];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Script step parameter ${key} must be a number`);
    }
    return value;
  }

  private getOptionalNumber(source: Record<string, unknown>, key: string): number | undefined {
    const value = source[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Script step parameter ${key} must be a number`);
    }
    return value;
  }

  private requireString(source: Record<string, unknown>, key: string): string {
    const value = source[key];
    if (typeof value !== 'string') {
      throw new Error(`Script step parameter ${key} must be a string`);
    }
    return value;
  }

  private requireStringArray(source: Record<string, unknown>, key: string): string[] {
    const value = source[key];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error(`Script step parameter ${key} must be a string array`);
    }
    return value;
  }

  private getMouseButton(source: Record<string, unknown>, key: string): MouseButtonName {
    const value = source[key];
    if (value === undefined) {
      return 'left';
    }
    if (value === 'left' || value === 'middle' || value === 'right') {
      return value;
    }
    throw new Error(`Script step parameter ${key} must be a mouse button`);
  }
}

export default ScriptRecorder;
