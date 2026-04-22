import { exec } from 'child_process';
import { promisify } from 'util';
import { keyboard, mouse, Button, Key } from '@computer-use/nut-js';
import log from 'electron-log/main.js';

const execAsync = promisify(exec);

const KEY_NAMES = Object.keys(Key).filter((name) => Number.isNaN(Number(name)));

const KEY_ALIASES: Record<string, string> = {
  alt: 'LeftAlt',
  backspace: 'Backspace',
  capslock: 'CapsLock',
  cmd: 'LeftCmd',
  command: 'LeftCmd',
  control: 'LeftControl',
  ctrl: 'LeftControl',
  del: 'Delete',
  down: 'Down',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  left: 'Left',
  meta: 'LeftSuper',
  option: 'LeftAlt',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  return: 'Return',
  right: 'Right',
  shift: 'LeftShift',
  space: 'Space',
  spacebar: 'Space',
  super: 'LeftSuper',
  tab: 'Tab',
  up: 'Up',
};

// Windows 特定的键名映射
const WINDOWS_KEY_MAP: Record<string, string> = {
  'LeftAlt': 'Alt',
  'RightAlt': 'Alt',
  'LeftControl': 'Ctrl',
  'RightControl': 'Ctrl',
  'LeftShift': 'Shift',
  'RightShift': 'Shift',
  'LeftSuper': 'Win',
  'RightSuper': 'Win',
  'Backspace': 'Back',
  'Delete': 'Del',
  'Escape': 'Esc',
  'Return': 'Enter',
  'Space': 'Space',
};

export type MouseButtonName = 'left' | 'middle' | 'right';

export interface ExecutionResult {
  action: string;
  success: boolean;
  timestamp: number;
  details: Record<string, unknown>;
}

export class ExecutionModule {
  private readonly platform = process.platform;

  public async click(x: number, y: number, button: MouseButtonName = 'left'): Promise<ExecutionResult> {
    const targetButton = this.resolveMouseButton(button);

    await mouse.setPosition({ x: Math.round(x), y: Math.round(y) });
    await mouse.click(targetButton);

    return this.createResult('click', {
      button,
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  public async typeText(text: string): Promise<ExecutionResult> {
    await keyboard.type(text);

    return this.createResult('type_text', {
      length: text.length,
      preview: text.slice(0, 120),
    });
  }

  public async pressKey(key: string): Promise<ExecutionResult> {
    const resolvedKey = this.resolveKey(key);

    await keyboard.pressKey(resolvedKey);
    await keyboard.releaseKey(resolvedKey);

    return this.createResult('press_key', {
      key,
      resolvedKey: this.normalizeKeyName(key),
    });
  }

  public async hotkey(...keys: string[]): Promise<ExecutionResult> {
    if (keys.length === 0) {
      throw new Error('hotkey requires at least one key');
    }

    const resolvedKeys = keys.map((key) => this.resolveKey(key));

    await keyboard.pressKey(...resolvedKeys);
    await keyboard.releaseKey(...[...resolvedKeys].reverse());

    return this.createResult('hotkey', {
      keys,
      resolvedKeys: keys.map((key) => this.normalizeKeyName(key)),
    });
  }

  public async openApp(bundleId: string): Promise<ExecutionResult> {
    const command = this.buildOpenCommand(bundleId);
    await execAsync(command);

    return this.createResult('open_app', {
      bundleId,
      command,
    });
  }

  public async closeApp(bundleId: string): Promise<ExecutionResult> {
    const command = this.buildCloseCommand(bundleId);
    await execAsync(command);

    return this.createResult('close_app', {
      bundleId,
      command,
    });
  }

  private createResult(action: string, details: Record<string, unknown>): ExecutionResult {
    log.info(`[ExecutionModule] ${action}`, details);

    return {
      action,
      success: true,
      timestamp: Date.now(),
      details,
    };
  }

  private resolveMouseButton(button: MouseButtonName): Button {
    switch (button) {
      case 'middle':
        return Button.MIDDLE;
      case 'right':
        return Button.RIGHT;
      case 'left':
      default:
        return Button.LEFT;
    }
  }

  private resolveKey(input: string): Key {
    const normalizedName = this.normalizeKeyName(input);
    const keyMap = Key as unknown as Record<string, Key>;
    const resolved = keyMap[normalizedName];

    if (resolved === undefined) {
      throw new Error(`Unsupported key: ${input}`);
    }

    return resolved;
  }

  private normalizeKeyName(input: string): string {
    const trimmed = input.trim();
    const alias = KEY_ALIASES[trimmed.toLowerCase()];

    if (alias) {
      return alias;
    }

    if (/^[a-z]$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    if (/^\d$/.test(trimmed)) {
      return `Num${trimmed}`;
    }

    if (/^f\d{1,2}$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    const compact = trimmed.replace(/[\s_-]/g, '').toLowerCase();
    const matchedKey = KEY_NAMES.find((name) => name.replace(/[\s_-]/g, '').toLowerCase() === compact);

    if (!matchedKey) {
      throw new Error(`Unsupported key name: ${input}`);
    }

    return matchedKey;
  }

  private buildOpenCommand(bundleId: string): string {
    const quoted = this.shellQuote(bundleId);

    switch (this.platform) {
      case 'darwin':
        return `open -b ${quoted} || open -a ${quoted}`;
      case 'win32':
        // Windows: 使用 start 命令打开应用，支持 exe 路径或应用名
        return `start "" ${bundleId}`;
      default:
        return `sh -lc "${this.escapeDoubleQuoted(bundleId)} >/dev/null 2>&1 &"`;
    }
  }

  private buildCloseCommand(bundleId: string): string {
    const quoted = this.shellQuote(bundleId);

    switch (this.platform) {
      case 'darwin': {
        const appName = bundleId.replace(/"/g, '\\"');
        return `osascript -e 'tell application id "${appName}" to quit' || osascript -e 'tell application "${appName}" to quit'`;
      }
      case 'win32':
        // Windows: 尝试通过进程名关闭，然后强制终止
        return `taskkill /IM "${bundleId}.exe" /F 2>nul || taskkill /IM "${bundleId}" /F 2>nul || echo "Process not found"`;
      default:
        return `pkill -f ${quoted}`;
    }
  }

  /**
   * 在 Windows 上执行热键组合
   * 使用 PowerShell 模拟键盘输入
   */
  public async executeWindowsHotkey(...keys: string[]): Promise<ExecutionResult> {
    if (this.platform !== 'win32') {
      throw new Error('executeWindowsHotkey is only available on Windows');
    }

    const resolvedKeys = keys.map((key) => this.resolveKey(key));
    const normalizedKeys = resolvedKeys.map((key) => this.normalizeKeyForWindows(key));

    const psCommand = `
      Add-Type -AssemblyName System.Windows.Forms
      ${normalizedKeys.map((key) => `[System.Windows.Forms.SendKeys]::SendWait('{${key}}')`).join('+')}
    `.trim();

    try {
      await execAsync(`powershell -Command "${psCommand.replace(/"/g, '\\"')}"`);
      return this.createResult('windows_hotkey', {
        keys,
        normalizedKeys,
        platform: 'win32',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('[ExecutionModule] Windows hotkey failed', errorMessage);
      return this.createResult('windows_hotkey', {
        keys,
        normalizedKeys,
        platform: 'win32',
        error: errorMessage,
      });
    }
  }

  /**
   * 将 Key 枚举值转换为 Windows 格式
   */
  private normalizeKeyForWindows(key: Key): string {
    const keyName = String(key);
    return WINDOWS_KEY_MAP[keyName] ?? keyName;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private escapeDoubleQuoted(value: string): string {
    return value.replace(/(["\\$`])/g, '\\$1');
  }
}

export default ExecutionModule;
