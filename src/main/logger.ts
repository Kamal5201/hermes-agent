import fs from 'fs';
import path from 'path';
import electronLog from 'electron-log/main.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  appName?: string;
  level?: LogLevel;
  maxSize?: number;
  maxFiles?: number;
}

export interface Logger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

let initialized = false;

export function initializeLogger(options: LoggerOptions = {}): void {
  if (initialized) {
    return;
  }

  electronLog.initialize();

  const level = options.level ?? 'info';
  const maxSize = options.maxSize ?? 10 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 5;

  electronLog.transports.file.level = level;
  electronLog.transports.console.level = level;
  electronLog.transports.file.maxSize = maxSize;
  electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  electronLog.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

  if (options.appName) {
    electronLog.transports.file.setAppName(options.appName);
  }

  electronLog.transports.file.archiveLogFn = (oldLogFile) => {
    rotateLogFiles(oldLogFile.path, maxFiles);
  };

  initialized = true;
}

export function getLogger(moduleName: string): Logger {
  const formatArgs = (message: string, meta: unknown[]): [string, ...unknown[]] => {
    const prefix = `[${moduleName}] ${message}`;
    return [prefix, ...meta];
  };

  return {
    debug(message: string, ...meta: unknown[]) {
      electronLog.debug(...formatArgs(message, meta));
    },
    info(message: string, ...meta: unknown[]) {
      electronLog.info(...formatArgs(message, meta));
    },
    warn(message: string, ...meta: unknown[]) {
      electronLog.warn(...formatArgs(message, meta));
    },
    error(message: string, ...meta: unknown[]) {
      electronLog.error(...formatArgs(message, meta));
    },
  };
}

function rotateLogFiles(logPath: string, maxFiles: number): void {
  const parsed = path.parse(logPath);

  for (let index = maxFiles; index >= 1; index -= 1) {
    const archivedPath = buildArchivePath(parsed.dir, parsed.name, parsed.ext, index);

    if (!fs.existsSync(archivedPath)) {
      continue;
    }

    if (index === maxFiles) {
      fs.unlinkSync(archivedPath);
      continue;
    }

    const nextArchivedPath = buildArchivePath(parsed.dir, parsed.name, parsed.ext, index + 1);
    fs.renameSync(archivedPath, nextArchivedPath);
  }

  if (fs.existsSync(logPath)) {
    fs.renameSync(logPath, buildArchivePath(parsed.dir, parsed.name, parsed.ext, 1));
  }
}

function buildArchivePath(directory: string, name: string, extension: string, index: number): string {
  return path.join(directory, `${name}.${index}${extension}`);
}
