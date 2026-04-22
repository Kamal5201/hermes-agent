/**
 * PerceptionModule - Screen capture, window management, process detection, and clipboard monitoring
 * Tech stack: node-screenshots + sharp, nut-js, ps-list, Electron clipboard API
 */

import { Monitor, Window as ScreenshotWindow } from 'node-screenshots';
import sharp from 'sharp';
import { getActiveWindow, mouse, type Point } from '@computer-use/nut-js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { clipboard } from 'electron';

const execAsync = promisify(exec);

// Types
export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInfo {
  id: string;
  title: string;
  bounds: Rectangle;
  processName: string;
  isFocused: boolean;
}

export interface RunningApp {
  pid: number;
  name: string;
  cmd: string;
}

export interface MousePosition {
  x: number;
  y: number;
}

export interface ClipboardContent {
  text: string | null;
  html: string | null;
  image: string | null;
}

export interface PerceptionConfig {
  captureScreenEnabled: boolean;
  captureOnDemandOnly: boolean;
  windowTracking: boolean;
  appMonitoring: boolean;
  clipboardMonitoring: boolean;
  mouseTracking: boolean;
}

export type ClipboardChangeCallback = (content: ClipboardContent) => void;

// Platform detection
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

export class PerceptionModule {
  private clipboardMonitoringInterval: NodeJS.Timeout | null = null;
  private lastClipboardText: string | null = null;
  private clipboardCallbacks: ClipboardChangeCallback[] = [];
  private isMonitoring = false;
  private config: PerceptionConfig = {
    captureScreenEnabled: false,
    captureOnDemandOnly: true,
    windowTracking: true,
    appMonitoring: true,
    clipboardMonitoring: true,
    mouseTracking: true,
  };

  constructor() {
    // Initialize clipboard text on construction
    try {
      this.lastClipboardText = clipboard.readText();
    } catch {
      this.lastClipboardText = null;
    }
  }

  /**
   * Capture the entire screen or a specific region
   * @param region Optional screen region to capture
   * @returns Buffer containing the screenshot
   */
  async captureScreen(region?: ScreenRegion): Promise<Buffer> {
    if (!this.config.captureScreenEnabled) {
      throw new Error('Screen capture is disabled by default. Enable it in settings first.');
    }

    try {
      const monitors = Monitor.all();
      const primaryMonitor = monitors.find((monitor) => monitor.isPrimary()) ?? monitors[0];

      if (!primaryMonitor) {
        throw new Error('No displays found');
      }

      let image = await primaryMonitor.captureImage();
      if (region) {
        image = await image.crop(
          Math.round(region.x),
          Math.round(region.y),
          Math.round(region.width),
          Math.round(region.height),
        );
      }

      return image.toPng();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PerceptionModule] Screen capture error:', errorMessage);
      
      if (isWindows) {
        // Windows-specific error handling
        throw new Error(`Screen capture failed on Windows: ${errorMessage}. Make sure the app has screen capture permissions.`);
      }
      throw error;
    }
  }

  /**
   * Capture screen and return as base64 encoded PNG
   * @param region Optional screen region to capture
   * @param format Output format (default: 'png')
   * @returns Base64 encoded string of the screenshot
   */
  async captureBase64(region?: ScreenRegion, format: 'png' | 'jpeg' | 'webp' = 'png'): Promise<string> {
    try {
      const buffer = await this.captureScreen(region);
      
      let sharpInstance = sharp(buffer);
      
      switch (format) {
        case 'jpeg':
          sharpInstance = sharpInstance.jpeg({ quality: 90 });
          break;
        case 'webp':
          sharpInstance = sharpInstance.webp({ quality: 90 });
          break;
        case 'png':
        default:
          sharpInstance = sharpInstance.png();
          break;
      }
      
      const optimizedBuffer = await sharpInstance.toBuffer();
      return optimizedBuffer.toString('base64');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PerceptionModule] Base64 capture error:', errorMessage);
      throw error;
    }
  }

  async captureScreenOnDemand(region?: ScreenRegion): Promise<Buffer> {
    if (!this.config.captureOnDemandOnly) {
      throw new Error('On-demand capture is disabled');
    }

    const previousState = this.config.captureScreenEnabled;

    try {
      this.config.captureScreenEnabled = true;
      return await this.captureScreen(region);
    } finally {
      this.config.captureScreenEnabled = previousState;
    }
  }

  async captureBase64OnDemand(region?: ScreenRegion, format: 'png' | 'jpeg' | 'webp' = 'png'): Promise<string> {
    const buffer = await this.captureScreenOnDemand(region);

    let sharpInstance = sharp(buffer);

    switch (format) {
      case 'jpeg':
        sharpInstance = sharpInstance.jpeg({ quality: 90 });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({ quality: 90 });
        break;
      case 'png':
      default:
        sharpInstance = sharpInstance.png();
        break;
    }

    const optimizedBuffer = await sharpInstance.toBuffer();
    return optimizedBuffer.toString('base64');
  }

  /**
   * Get all visible windows
   * @returns Array of window information
   */
  async getWindows(): Promise<WindowInfo[]> {
    if (!this.config.windowTracking) {
      throw new Error('Window tracking is disabled in perception settings.');
    }

    try {
      const activeWindow = await this.getActiveWindowSnapshot();
      const windows = ScreenshotWindow.all();
      const windowInfos: WindowInfo[] = [];

      for (const win of windows) {
        try {
          const bounds: Rectangle = {
            x: win.x(),
            y: win.y(),
            width: win.width(),
            height: win.height(),
          };
          const title = win.title();
          const processName = win.appName() || 'Unknown';
          const isFocused = activeWindow !== null
            && activeWindow.title === title
            && activeWindow.bounds.x === bounds.x
            && activeWindow.bounds.y === bounds.y
            && activeWindow.bounds.width === bounds.width
            && activeWindow.bounds.height === bounds.height;

          windowInfos.push({
            id: String(win.id()),
            title,
            bounds,
            processName,
            isFocused,
          });
        } catch {
          // Skip windows that can't be accessed
          continue;
        }
      }
      
      return windowInfos;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PerceptionModule] getWindows error:', errorMessage);
      
      if (isWindows) {
        // On Windows, return empty array instead of crashing
        console.warn('[PerceptionModule] Falling back to empty window list on Windows');
        return [];
      }
      throw error;
    }
  }

  /**
   * Get the currently focused window
   * @returns Window information of the focused window, or null if none
   */
  async getFocusedWindow(): Promise<WindowInfo | null> {
    if (!this.config.windowTracking) {
      return null;
    }

    try {
      const activeWindow = await this.getActiveWindowSnapshot();

      if (activeWindow) {
        const windows = ScreenshotWindow.all();
        const matchedWindow = windows.find((win) => {
          return win.title() === activeWindow.title
            && win.x() === activeWindow.bounds.x
            && win.y() === activeWindow.bounds.y
            && win.width() === activeWindow.bounds.width
            && win.height() === activeWindow.bounds.height;
        });

        return {
          id: matchedWindow ? String(matchedWindow.id()) : 'active-window',
          title: activeWindow.title,
          bounds: activeWindow.bounds,
          processName: matchedWindow?.appName() || 'Unknown',
          isFocused: true,
        };
      }

      const allWindows = await this.getWindows();
      const focusedWindow = allWindows.find((window) => window.isFocused);

      return focusedWindow || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PerceptionModule] getFocusedWindow error:', errorMessage);
      
      if (isWindows) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get running applications using ps-list
   * @returns Array of running application information
   */
  async getRunningApps(): Promise<RunningApp[]> {
    if (!this.config.appMonitoring) {
      throw new Error('Application monitoring is disabled in perception settings.');
    }

    try {
      if (isWindows) {
        return this.getRunningAppsWindows();
      } else if (isMac) {
        return this.getRunningAppsMac();
      } else {
        // Linux fallback
        return this.getRunningAppsLinux();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PerceptionModule] getRunningApps error:', errorMessage);
      
      // Return empty array on Windows to prevent crashes
      if (isWindows) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Windows fallback for getting running apps using tasklist
   */
  private async getRunningAppsWindows(): Promise<RunningApp[]> {
    try {
      const { stdout } = await execAsync('tasklist /FO CSV /NH', { encoding: 'utf8' });
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        const parts = line.split('","').map(p => p.replace(/"/g, ''));
        if (parts.length >= 2) {
          return {
            pid: parseInt(parts[1], 10) || 0,
            name: parts[0],
            cmd: '',
          };
        }
        return null;
      }).filter((app): app is RunningApp => app !== null && app.pid > 0);
    } catch {
      return [];
    }
  }

  /**
   * macOS fallback for getting running apps using ps
   */
  private async getRunningAppsMac(): Promise<RunningApp[]> {
    try {
      const { stdout } = await execAsync('ps -ax -o pid,comm | head -100', { encoding: 'utf8' });
      const lines = stdout.trim().split('\n');
      
      return lines.slice(1).map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          return {
            pid: parseInt(parts[0], 10) || 0,
            name: parts[1].split('/').pop() || parts[1],
            cmd: parts[1],
          };
        }
        return null;
      }).filter((app): app is RunningApp => app !== null && app.pid > 0);
    } catch {
      return [];
    }
  }

  /**
   * Linux fallback for getting running apps using ps
   */
  private async getRunningAppsLinux(): Promise<RunningApp[]> {
    try {
      const { stdout } = await execAsync('ps -eo pid,comm --no-headers | head -100', { encoding: 'utf8' });
      const lines = stdout.trim().split('\n');
      
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          return {
            pid: parseInt(parts[0], 10) || 0,
            name: parts[1],
            cmd: parts[1],
          };
        }
        return null;
      }).filter((app): app is RunningApp => app !== null && app.pid > 0);
    } catch {
      return [];
    }
  }

  /**
   * Get current mouse position
   * @returns Mouse position coordinates
   */
  async getMousePosition(): Promise<MousePosition> {
    if (!this.config.mouseTracking) {
      throw new Error('Mouse tracking is disabled in perception settings.');
    }

    try {
      const position: Point = await mouse.getPosition();
      return {
        x: position.x,
        y: position.y,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PerceptionModule] getMousePosition error:', errorMessage);
      
      if (isWindows) {
        // Return last known position or center of primary screen on Windows
        try {
          const monitors = Monitor.all();
          if (monitors.length > 0) {
            const primary = monitors.find((monitor) => monitor.isPrimary()) ?? monitors[0];
            return {
              x: Math.round(primary.width() / 2),
              y: Math.round(primary.height() / 2),
            };
          }
        } catch {
          // Fallback
        }
        return { x: 0, y: 0 };
      }
      throw error;
    }
  }

  /**
   * Get current clipboard content
   * @returns Clipboard content including text, html, and image
   */
  getClipboard(): ClipboardContent {
    if (!this.config.clipboardMonitoring) {
      throw new Error('Clipboard monitoring is disabled in perception settings.');
    }

    try {
      const text = clipboard.readText();
      let html: string | null = null;
      let image: string | null = null;
      
      // Try to read HTML if available
      try {
        const htmlText = clipboard.readHTML();
        if (htmlText && htmlText.trim().length > 0) {
          html = htmlText;
        }
      } catch {
        // HTML not available
      }
      
      // Try to read image if available
      try {
        const imageBuffer = clipboard.readImage();
        if (!imageBuffer.isEmpty()) {
          image = imageBuffer.toDataURL();
        }
      } catch {
        // Image not available
      }
      
      return {
        text,
        html,
        image,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[PerceptionModule] getClipboard error:', errorMessage);
      
      if (isWindows) {
        // Return empty clipboard on Windows error
        return {
          text: null,
          html: null,
          image: null,
        };
      }
      throw error;
    }
  }

  /**
   * Start monitoring clipboard changes
   * @param callback Function to call when clipboard changes
   * @param intervalMs Polling interval in milliseconds (default: 500ms)
   */
  startMonitoring(callback?: ClipboardChangeCallback, intervalMs: number = 500): void {
    if (!this.config.clipboardMonitoring) {
      console.warn('[PerceptionModule] Clipboard monitoring is disabled by configuration');
      return;
    }

    if (this.isMonitoring) {
      console.warn('[PerceptionModule] Clipboard monitoring already started');
      return;
    }

    if (callback) {
      this.clipboardCallbacks.push(callback);
    }

    this.isMonitoring = true;
    this.lastClipboardText = this.getClipboard().text;

    this.clipboardMonitoringInterval = setInterval(() => {
      try {
        const content = this.getClipboard();
        
        if (content.text !== this.lastClipboardText) {
          this.lastClipboardText = content.text;
          
          // Notify all callbacks
          for (const cb of this.clipboardCallbacks) {
            try {
              cb(content);
            } catch (error) {
              console.error('[PerceptionModule] Clipboard callback error:', error);
            }
          }
        }
      } catch (error) {
        console.error('[PerceptionModule] Clipboard monitoring error:', error);
      }
    }, intervalMs);

    console.log('[PerceptionModule] Clipboard monitoring started');
  }

  /**
   * Stop monitoring clipboard changes
   */
  stopMonitoring(): void {
    if (this.clipboardMonitoringInterval) {
      clearInterval(this.clipboardMonitoringInterval);
      this.clipboardMonitoringInterval = null;
    }
    
    this.isMonitoring = false;
    this.clipboardCallbacks = [];
    
    console.log('[PerceptionModule] Clipboard monitoring stopped');
  }

  /**
   * Add a clipboard change callback
   * @param callback Callback function to add
   */
  addClipboardCallback(callback: ClipboardChangeCallback): void {
    this.clipboardCallbacks.push(callback);
  }

  /**
   * Remove a clipboard change callback
   * @param callback Callback function to remove
   */
  removeClipboardCallback(callback: ClipboardChangeCallback): void {
    const index = this.clipboardCallbacks.indexOf(callback);
    if (index !== -1) {
      this.clipboardCallbacks.splice(index, 1);
    }
  }

  /**
   * Check if clipboard monitoring is active
   * @returns true if monitoring is active
   */
  isClipboardMonitoring(): boolean {
    return this.isMonitoring;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopMonitoring();
  }

  public getPerceptionConfig(): PerceptionConfig {
    return { ...this.config };
  }

  public setPerceptionConfig(config: Partial<PerceptionConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  private async getActiveWindowSnapshot(): Promise<{ title: string; bounds: Rectangle } | null> {
    try {
      const activeWindow = await getActiveWindow();
      const [title, region] = await Promise.all([activeWindow.title, activeWindow.region]);

      return {
        title,
        bounds: {
          x: region.left,
          y: region.top,
          width: region.width,
          height: region.height,
        },
      };
    } catch {
      return null;
    }
  }
}

// Export singleton instance for convenience
let instance: PerceptionModule | null = null;

export function getPerceptionModule(): PerceptionModule {
  if (!instance) {
    instance = new PerceptionModule();
  }
  return instance;
}

export default PerceptionModule;
