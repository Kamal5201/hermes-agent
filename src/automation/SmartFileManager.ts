/**
 * Smart File Manager
 * 
 * Hermes Companion - 智能文件管理
 * 支持文件自动分类、搜索、整理
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import log from 'electron-log/main.js';

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  accessedAt: Date;
  type: FileType;
  tags: string[];
  category?: string;
  thumbnail?: string;
}

export enum FileType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  CODE = 'code',
  ARCHIVE = 'archive',
  OTHER = 'other',
}

export interface FolderStats {
  path: string;
  totalFiles: number;
  totalSize: number;
  byType: Record<FileType, number>;
  largestFiles: FileInfo[];
  recentFiles: FileInfo[];
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileInfo[];
  potentialSavings: number;
}

export class SmartFileManager extends EventEmitter {
  private index: Map<string, FileInfo> = new Map();
  private watchedFolders: Set<string> = new Set();
  
  // 文件类型映射
  private readonly extensionMap: Record<string, FileType> = {
    // 图片
    '.jpg': FileType.IMAGE, '.jpeg': FileType.IMAGE, '.png': FileType.IMAGE,
    '.gif': FileType.IMAGE, '.bmp': FileType.IMAGE, '.webp': FileType.IMAGE,
    '.svg': FileType.IMAGE, '.ico': FileType.IMAGE, '.tiff': FileType.IMAGE,
    // 视频
    '.mp4': FileType.VIDEO, '.avi': FileType.VIDEO, '.mkv': FileType.VIDEO,
    '.mov': FileType.VIDEO, '.wmv': FileType.VIDEO, '.flv': FileType.VIDEO,
    '.webm': FileType.VIDEO,
    // 音频
    '.mp3': FileType.AUDIO, '.wav': FileType.AUDIO, '.flac': FileType.AUDIO,
    '.aac': FileType.AUDIO, '.ogg': FileType.AUDIO, '.wma': FileType.AUDIO,
    // 文档
    '.pdf': FileType.DOCUMENT, '.doc': FileType.DOCUMENT, '.docx': FileType.DOCUMENT,
    '.xls': FileType.DOCUMENT, '.xlsx': FileType.DOCUMENT,
    '.ppt': FileType.DOCUMENT, '.pptx': FileType.DOCUMENT,
    '.txt': FileType.DOCUMENT, '.md': FileType.DOCUMENT,
    // 代码
    '.js': FileType.CODE, '.ts': FileType.CODE, '.py': FileType.CODE,
    '.java': FileType.CODE, '.cpp': FileType.CODE, '.c': FileType.CODE,
    '.html': FileType.CODE, '.css': FileType.CODE, '.json': FileType.CODE,
    // 压缩
    '.zip': FileType.ARCHIVE, '.rar': FileType.ARCHIVE, '.7z': FileType.ARCHIVE,
    '.tar': FileType.ARCHIVE, '.gz': FileType.ARCHIVE,
  };
  
  constructor() {
    super();
  }
  
  /**
   * 获取文件类型
   */
  private getFileType(extension: string): FileType {
    return this.extensionMap[extension.toLowerCase()] || FileType.OTHER;
  }
  
  /**
   * 扫描文件夹
   */
  public async scanFolder(folderPath: string, recursive: boolean = true): Promise<FileInfo[]> {
    log.info(`[SmartFileManager] Scanning: ${folderPath}`);
    const files: FileInfo[] = [];
    
    try {
      await this.scanRecursive(folderPath, files, recursive);
      
      // 更新索引
      for (const file of files) {
        this.index.set(file.path, file);
      }
      
      this.emit('scanCompleted', { folder: folderPath, count: files.length });
      return files;
    } catch (error) {
      log.error('[SmartFileManager] Scan error:', error);
      this.emit('scanError', error);
      throw error;
    }
  }
  
  private async scanRecursive(dir: string, files: FileInfo[], recursive: boolean): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            const ext = path.extname(entry.name);
            
            const fileInfo: FileInfo = {
              path: fullPath,
              name: entry.name,
              extension: ext,
              size: stat.size,
              createdAt: stat.birthtime,
              modifiedAt: stat.mtime,
              accessedAt: stat.atime,
              type: this.getFileType(ext),
              tags: [],
            };
            
            files.push(fileInfo);
          } catch (err) {
            log.warn(`[SmartFileManager] Cannot stat: ${fullPath}`);
          }
        } else if (entry.isDirectory() && recursive) {
          // 跳过隐藏目录和系统目录
          if (!entry.name.startsWith('.') && !['node_modules', '__pycache__'].includes(entry.name)) {
            await this.scanRecursive(fullPath, files, recursive);
          }
        }
      }
    } catch (err) {
      log.warn(`[SmartFileManager] Cannot read dir: ${dir}`);
    }
  }
  
  /**
   * 搜索文件
   */
  public search(query: string, filters?: {
    type?: FileType;
    extensions?: string[];
    minSize?: number;
    maxSize?: number;
    modifiedAfter?: Date;
    tags?: string[];
  }): FileInfo[] {
    const lowerQuery = query.toLowerCase();
    
    return Array.from(this.index.values()).filter(file => {
      // 名称匹配
      if (!file.name.toLowerCase().includes(lowerQuery)) {
        return false;
      }
      
      // 类型过滤
      if (filters?.type && file.type !== filters.type) {
        return false;
      }
      
      // 扩展名过滤
      if (filters?.extensions && !filters.extensions.includes(file.extension)) {
        return false;
      }
      
      // 大小过滤
      if (filters?.minSize && file.size < filters.minSize) {
        return false;
      }
      if (filters?.maxSize && file.size > filters.maxSize) {
        return false;
      }
      
      // 修改时间过滤
      if (filters?.modifiedAfter && file.modifiedAt < filters.modifiedAfter) {
        return false;
      }
      
      // 标签过滤
      if (filters?.tags && filters.tags.length > 0) {
        if (!filters.tags.some(tag => file.tags.includes(tag))) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  /**
   * 按类型分类文件
   */
  public categorizeByType(files?: FileInfo[]): Record<FileType, FileInfo[]> {
    const fileList = files || Array.from(this.index.values());
    
    const categories: Record<FileType, FileInfo[]> = {
      [FileType.IMAGE]: [],
      [FileType.VIDEO]: [],
      [FileType.AUDIO]: [],
      [FileType.DOCUMENT]: [],
      [FileType.CODE]: [],
      [FileType.ARCHIVE]: [],
      [FileType.OTHER]: [],
    };
    
    for (const file of fileList) {
      categories[file.type].push(file);
    }
    
    return categories;
  }
  
  /**
   * 获取文件夹统计
   */
  public async getFolderStats(folderPath: string): Promise<FolderStats> {
    const files = await this.scanFolder(folderPath);
    
    const byType: Record<string, number> = {};
    let totalSize = 0;
    
    for (const file of files) {
      totalSize += file.size;
      byType[file.type] = (byType[file.type] || 0) + file.size;
    }
    
    // 最大文件
    const largestFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 10);
    
    // 最近文件
    const recentFiles = [...files].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()).slice(0, 10);
    
    return {
      path: folderPath,
      totalFiles: files.length,
      totalSize,
      byType: byType as Record<FileType, number>,
      largestFiles,
      recentFiles,
    };
  }
  
  /**
   * 查找重复文件
   */
  public async findDuplicates(folderPath: string): Promise<DuplicateGroup[]> {
    log.info(`[SmartFileManager] Finding duplicates in: ${folderPath}`);
    
    const files = await this.scanFolder(folderPath);
    const sizeGroups: Map<number, FileInfo[]> = new Map();
    
    // 按大小分组
    for (const file of files) {
      const existing = sizeGroups.get(file.size);
      if (existing) {
        existing.push(file);
      } else {
        sizeGroups.set(file.size, [file]);
      }
    }
    
    const duplicates: DuplicateGroup[] = [];
    
    // 只处理有多个文件的组
    for (const [size, group] of sizeGroups) {
      if (group.length > 1) {
        // 计算哈希来确认真正的重复
        // 这里简化处理，实际应该计算文件哈希
        const potentialSavings = size * (group.length - 1);
        
        duplicates.push({
          hash: group[0].path, // 简化：使用第一个文件的路径作为哈希
          size,
          files: group,
          potentialSavings,
        });
      }
    }
    
    return duplicates.sort((a, b) => b.potentialSavings - a.potentialSavings);
  }
  
  /**
   * 批量重命名
   */
  public async batchRename(
    files: FileInfo[], 
    pattern: (name: string, index: number) => string
  ): Promise<{ original: string; renamed: string }[]> {
    const results: { original: string; renamed: string }[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dir = path.dirname(file.path);
      const newName = pattern(file.name, i);
      const newPath = path.join(dir, newName);
      
      try {
        await fs.rename(file.path, newPath);
        results.push({ original: file.path, renamed: newPath });
        
        // 更新索引
        const updatedFile: FileInfo = { ...file, path: newPath, name: newName };
        this.index.delete(file.path);
        this.index.set(newPath, updatedFile);
      } catch (err) {
        log.error(`[SmartFileManager] Rename failed: ${file.path}`, err);
      }
    }
    
    this.emit('batchRenamed', results);
    return results;
  }
  
  /**
   * 智能清理建议
   */
  public async getCleanupSuggestions(folderPath: string): Promise<{
    largeFiles: FileInfo[];
    oldFiles: FileInfo[];
    emptyFolders: string[];
    duplicateGroups: DuplicateGroup[];
  }> {
    const files = await this.scanFolder(folderPath);
    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);
    
    // 大文件 (>100MB)
    const largeFiles = files.filter(f => f.size > 100 * 1024 * 1024);
    
    // 旧文件 (1年未访问)
    const oldFiles = files.filter(f => f.accessedAt < oneYearAgo);
    
    // 查找空文件夹
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const emptyFolders: string[] = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(folderPath, entry.name);
        const dirContents = await fs.readdir(fullPath);
        if (dirContents.length === 0) {
          emptyFolders.push(fullPath);
        }
      }
    }
    
    // 重复文件
    const duplicateGroups = await this.findDuplicates(folderPath);
    
    return {
      largeFiles,
      oldFiles,
      emptyFolders,
      duplicateGroups,
    };
  }
  
  public getIndexedFiles(): FileInfo[] {
    return Array.from(this.index.values());
  }
}

export default SmartFileManager;
