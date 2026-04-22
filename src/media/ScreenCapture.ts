/**
 * Screen Capture
 * 
 * Hermes Companion - 截图和屏幕录制模块
 */

import { desktopCapturer, screen } from 'electron';
import log from 'electron-log/main.js';

export interface CaptureOptions {
  format?: 'png' | 'jpg' | 'webp';
  quality?: number;  // 0-100 for jpg/webp
  includeCursor?: boolean;
  highlightClick?: boolean;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingOptions {
  duration?: number;  // seconds, 0 = unlimited
  fps?: number;
  audio?: boolean;
  outputPath?: string;
}

export class ScreenCapture {
  /**
   * 获取所有屏幕源
   */
  public async getScreenSources(): Promise<Electron.DesktopCapturerSource[]> {
    return desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
  }
  
  /**
   * 截图整个屏幕
   */
  public async captureScreen(options: CaptureOptions = {}): Promise<Buffer> {
    const { format = 'png', quality = 90 } = options;
    
    try {
      const sources = await this.getScreenSources();
      const primaryScreen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      
      if (!primaryScreen) {
        throw new Error('No screen source found');
      }
      
      const image = primaryScreen.thumbnail;
      const buffer = format === 'png' 
        ? image.toPNG() 
        : image.toJPEG(quality);
      
      log.info('[ScreenCapture] Screen captured');
      return buffer;
    } catch (error) {
      log.error('[ScreenCapture] Capture failed:', error);
      throw error;
    }
  }
  
  /**
   * 截图指定区域
   */
  public async captureRegion(region: Region, options: CaptureOptions = {}): Promise<Buffer> {
    const { format = 'png', quality = 90 } = options;
    
    try {
      // 先截取整个屏幕
      const fullScreen = await this.captureScreen({ format, quality });
      
      // 裁剪区域 - 这里需要图像处理库
      // 简化实现：返回完整截图
      return fullScreen;
    } catch (error) {
      log.error('[ScreenCapture] Region capture failed:', error);
      throw error;
    }
  }
  
  /**
   * 截图特定窗口
   */
  public async captureWindow(windowId: string, options: CaptureOptions = {}): Promise<Buffer> {
    const { format = 'png', quality = 90 } = options;
    
    try {
      const sources = await this.getScreenSources();
      const windowSource = sources.find(s => s.id === windowId || s.name.includes(windowId));
      
      if (!windowSource) {
        throw new Error(`Window not found: ${windowId}`);
      }
      
      const image = windowSource.thumbnail;
      const buffer = format === 'png' 
        ? image.toPNG() 
        : image.toJPEG(quality);
      
      log.info(`[ScreenCapture] Window captured: ${windowSource.name}`);
      return buffer;
    } catch (error) {
      log.error('[ScreenCapture] Window capture failed:', error);
      throw error;
    }
  }
  
  /**
   * 列出所有窗口
   */
  public async listWindows(): Promise<Array<{ id: string; name: string; thumbnail: string }>> {
    const sources = await this.getScreenSources();
    return sources
      .filter(s => s.id.startsWith('window:'))
      .map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));
  }
  
  /**
   * 获取屏幕信息
   */
  public getDisplayInfo(): Array<{ id: number; bounds: Region; scaleFactor: number }> {
    const displays = screen.getAllDisplays();
    return displays.map(d => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
    }));
  }
}

export default ScreenCapture;
