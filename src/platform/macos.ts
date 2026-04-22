/**
 * macOS Platform Support
 * 
 * Hermes Companion - macOS 客户端支持
 * 支持 macOS 14+ (Sonoma) 及以上版本
 */

import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'path';

// macOS 特有模块
const nutjs = require('@computer-use/nut-js');

// AppleScript 执行器
export async function executeAppleScript(script: string): Promise<string> {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

// macOS 菜单栏
export function createMacMenu(mainWindow: BrowserWindow): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: '偏好设置...',
          accelerator: 'Cmd+,',
          click: () => mainWindow.webContents.send('open-settings'),
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    },
    {
      label: '文件',
      submenu: [
        { role: 'close' as const },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'delete' as const },
        { type: 'separator' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        { type: 'separator' as const },
        {
          label: '总是置顶',
          type: 'checkbox',
          accelerator: 'Cmd+T',
          click: (menuItem) => {
            mainWindow.setAlwaysOnTop(menuItem.checked);
          },
        },
        { type: 'separator' as const },
        { role: 'front' as const },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'Hermes 帮助',
          click: () => shell.openExternal('https://hermes.example.com/help'),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// macOS 系统托盘 (Menu Bar)
export class MacOSTray {
  private tray: Tray | null = null;
  
  constructor(private mainWindow: BrowserWindow) {
    this.createTray();
  }
  
  private createTray(): void {
    // 创建托盘图标
    const icon = nativeImage.createFromPath(
      path.join(__dirname, '../../assets/icon.png')
    );
    
    this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
    this.tray.setToolTip('Hermes Companion');
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示 Hermes',
        click: () => this.mainWindow.show(),
      },
      {
        label: '隐私模式',
        type: 'checkbox',
        click: (menuItem) => {
          this.mainWindow.webContents.send('toggle-privacy', menuItem.checked);
        },
      },
      { type: 'separator' },
      {
        label: '学习进度',
        click: () => {
          this.mainWindow.webContents.send('show-learning');
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]);
    
    this.tray.setContextMenu(contextMenu);
    
    // 点击托盘图标显示窗口
    this.tray.on('click', () => {
      this.mainWindow.show();
    });
  }
  
  public destroy(): void {
    this.tray?.destroy();
  }
}

// Apple Vision Pro 支持 (未来)
export interface VisionProSupport {
  // 空间计算
  calculateSpatialPosition(window: BrowserWindow): Promise<SpatialPosition>;
  
  // 窗口悬停
  attachToWindow(window: BrowserWindow, position: SpatialPosition): Promise<void>;
}

interface SpatialPosition {
  x: number;
  y: number;
  z: number;
  rotation: {
    pitch: number;
    yaw: number;
    roll: number;
  };
}

// AirDrop 支持
export async function shareViaAirDrop(data: {
  filename: string;
  content: Buffer;
}): Promise<boolean> {
  // 使用 macOS share menu
  const script = `
    tell application "Finder"
      set tempFile to (POSIX file "/tmp/${data.filename}") as text
      do shell script "cp /dev/stdin " & quoted form of tempFile
    end tell
  `;
  
  try {
    await executeAppleScript(script);
    return true;
  } catch {
    return false;
  }
}

// Spotlight 集成
export async function indexInSpotlight(data: {
  title: string;
  content: string;
  identifier: string;
}): Promise<void> {
  const script = `
    mdimport -r -d2 <<< '${data.identifier}'
  `;
  await executeAppleScript(script);
}

// macOS 通知
export function sendMacNotification(options: {
  title: string;
  body: string;
  sound?: boolean;
}): void {
  // 使用 macOS 原生通知
  const { Notification } = require('electron');
  new Notification({
    title: options.title,
    body: options.body,
    sound: options.sound ?? true,
  }).show();
}

// Focus 模式集成
export async function isFocusModeEnabled(): Promise<boolean> {
  const script = `
    tell application "System Events"
      tell application process "ControlCenter"
        if exists menu item "专注模式" of menu bar item "Control Center" of menu bar 1 then
          return "true"
        else
          return "false"
        end if
      end tell
    end tell
  `;
  
  const result = await executeAppleScript(script);
  return result.trim() === 'true';
}

// Sidecar 支持 (作为第二屏幕)
export function isSidecarActive(): Promise<boolean> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('system_profiler SPDisplaysDataType | grep -i sidecar', (error: Error | null) => {
      resolve(!error);
    });
  });
}

export default {
  executeAppleScript,
  createMacMenu,
  MacOSTray,
  sendMacNotification,
  isFocusModeEnabled,
  isSidecarActive,
  shareViaAirDrop,
};
