import DatabaseManager, {
  WindowHistory,
  OperationHistory,
  AppUsageStats,
  TimePattern,
  OperationPattern,
  UserHabit,
  UserConfig,
  AttentionRecord,
  LearningProgress,
  PredictionCache,
  SecurityAudit
} from '../database/DatabaseManager';

export interface UserDataExport {
  windowHistory: WindowHistory[];
  operationHistory: OperationHistory[];
  appUsageStats: AppUsageStats[];
  patterns: {
    timePatterns: TimePattern[];
    operationPatterns: OperationPattern[];
    userHabits: UserHabit[];
  };
  config: UserConfig[];
  exportedAt: number;
}

export enum PrivacyLevel {
  CONSERVATIVE = 'conservative',
  BALANCED = 'balanced',
  FULL = 'full',
}

export interface PrivacyPreset {
  level: PrivacyLevel;
  label: string;
  description: string;
  allowedDataTypes: string[];
}

export interface DataStatistics {
  windowHistoryCount: number;
  operationHistoryCount: number;
  patternsCount: number;
  oldestRecord: number | null;
  newestRecord: number | null;
}

export interface Operation {
  appName?: string;
  bundleId?: string;
  type?: string;
  target?: string;
}

const PRIVACY_PRESETS: PrivacyPreset[] = [
  {
    level: PrivacyLevel.CONSERVATIVE,
    label: '🛡️ 保守模式',
    description: '只记录应用使用时间，不记录任何内容',
    allowedDataTypes: ['app_duration', 'session_time'],
  },
  {
    level: PrivacyLevel.BALANCED,
    label: '⚖️ 平衡模式',
    description: '+窗口标题和操作模式',
    allowedDataTypes: ['app_duration', 'session_time', 'window_title', 'operation_pattern'],
  },
  {
    level: PrivacyLevel.FULL,
    label: '🤝 信任模式',
    description: '完整学习能力，包括预测和建议',
    allowedDataTypes: ['app_duration', 'session_time', 'window_title', 'operation_pattern', 'prediction', 'suggestion'],
  },
];

export class PrivacyManager {
  private static instance: PrivacyManager | null = null;

  private sensitiveApps: Set<string> = new Set([
    'Safari',
    'Chrome',
    'Messages',
    'Mail',
    'FaceTime',
    'Vault',
    '1Password',
    'Keychain Access',
    'Keychain'
  ]);

  private privacyMode: boolean = false;
  private privacyLevel: PrivacyLevel = PrivacyLevel.BALANCED;
  private blockedApps: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): PrivacyManager {
    if (!PrivacyManager.instance) {
      PrivacyManager.instance = new PrivacyManager();
    }
    return PrivacyManager.instance;
  }

  public static resetInstance(): void {
    if (PrivacyManager.instance) {
      PrivacyManager.instance = null;
    }
  }

  public shouldRecordOperation(operation: Operation): boolean {
    if (this.privacyMode) {
      return false;
    }

    if (operation.appName && this.sensitiveApps.has(operation.appName)) {
      return false;
    }

    if (operation.bundleId && this.blockedApps.has(operation.bundleId)) {
      return false;
    }

    return this.getRequiredDataTypes(operation).every((dataType) => this.canUseData(dataType));
  }

  public setPrivacyMode(enabled: boolean): void {
    this.privacyMode = enabled;
  }

  public getPrivacyMode(): boolean {
    return this.privacyMode;
  }

  public setPrivacyLevel(level: PrivacyLevel): void {
    this.privacyLevel = level;
  }

  public getPrivacyLevel(): PrivacyLevel {
    return this.privacyLevel;
  }

  public getPrivacyPresets(): PrivacyPreset[] {
    return PRIVACY_PRESETS.map((preset) => ({
      ...preset,
      allowedDataTypes: [...preset.allowedDataTypes],
    }));
  }

  public canUseData(dataType: string): boolean {
    const preset = PRIVACY_PRESETS.find((item) => item.level === this.privacyLevel);
    return preset?.allowedDataTypes.includes(dataType) ?? false;
  }

  public blockApp(bundleId: string): void {
    this.blockedApps.add(bundleId);
  }

  public unblockApp(bundleId: string): void {
    this.blockedApps.delete(bundleId);
  }

  public isAppBlocked(bundleId: string): boolean {
    return this.blockedApps.has(bundleId);
  }

  public isAppSensitive(appName: string): boolean {
    return this.sensitiveApps.has(appName);
  }

  public getSensitiveApps(): string[] {
    return Array.from(this.sensitiveApps);
  }

  public getBlockedApps(): string[] {
    return Array.from(this.blockedApps);
  }

  public async exportUserData(): Promise<UserDataExport> {
    const db = DatabaseManager.getInstance();

    const windowHistory = db.getWindowHistory(10000, 0);
    const operationHistory = db.getOperationHistory(10000, 0);
    const appUsageStats = db.getAppUsageStats('');
    const timePatterns = db.getTimePatterns();
    const operationPatterns = db.getAllOperationPatterns();
    const userHabits = db.getAllUserHabits();
    const config = db.getAllUserConfigs();

    return {
      windowHistory,
      operationHistory,
      appUsageStats,
      patterns: {
        timePatterns,
        operationPatterns,
        userHabits
      },
      config,
      exportedAt: Date.now()
    };
  }

  public async exportUserDataAsJSON(): Promise<string> {
    const data = await this.exportUserData();
    return JSON.stringify(data, null, 2);
  }

  public getDataStatistics(): DataStatistics {
    const db = DatabaseManager.getInstance();
    const database = db.getDb();

    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM window_history) AS windowHistoryCount,
        (SELECT COUNT(*) FROM operation_history) AS operationHistoryCount,
        (
          (SELECT COUNT(*) FROM time_patterns) +
          (SELECT COUNT(*) FROM operation_patterns) +
          (SELECT COUNT(*) FROM user_habits)
        ) AS patternsCount
    `).get() as {
      windowHistoryCount: number;
      operationHistoryCount: number;
      patternsCount: number;
    };

    const oldestRecordRow = database.prepare(`
      SELECT MIN(record_time) AS timestamp
      FROM (
        SELECT start_time AS record_time FROM window_history
        UNION ALL
        SELECT timestamp AS record_time FROM operation_history
        UNION ALL
        SELECT created_at AS record_time FROM time_patterns
        UNION ALL
        SELECT created_at AS record_time FROM operation_patterns
        UNION ALL
        SELECT created_at AS record_time FROM user_habits
      )
      WHERE record_time IS NOT NULL
    `).get() as { timestamp: number | null };

    const newestRecordRow = database.prepare(`
      SELECT MAX(record_time) AS timestamp
      FROM (
        SELECT COALESCE(end_time, start_time) AS record_time FROM window_history
        UNION ALL
        SELECT timestamp AS record_time FROM operation_history
        UNION ALL
        SELECT updated_at AS record_time FROM time_patterns
        UNION ALL
        SELECT updated_at AS record_time FROM operation_patterns
        UNION ALL
        SELECT updated_at AS record_time FROM user_habits
      )
      WHERE record_time IS NOT NULL
    `).get() as { timestamp: number | null };

    return {
      windowHistoryCount: counts.windowHistoryCount,
      operationHistoryCount: counts.operationHistoryCount,
      patternsCount: counts.patternsCount,
      oldestRecord: oldestRecordRow.timestamp,
      newestRecord: newestRecordRow.timestamp,
    };
  }

  public async deleteAllData(): Promise<void> {
    const db = DatabaseManager.getInstance();
    const database = db.getDb();

    database.exec('DELETE FROM window_history');
    database.exec('DELETE FROM operation_history');
    database.exec('DELETE FROM app_usage_stats');
    database.exec('DELETE FROM time_patterns');
    database.exec('DELETE FROM operation_patterns');
    database.exec('DELETE FROM user_habits');
    database.exec('DELETE FROM user_config');
    database.exec('DELETE FROM attention_records');
    database.exec('DELETE FROM learning_progress');
    database.exec('DELETE FROM prediction_cache');
    database.exec('DELETE FROM mcp_sessions');
    database.exec('DELETE FROM security_audit');
  }

  private getRequiredDataTypes(operation: Operation): string[] {
    const requiredDataTypes = new Set<string>(['app_duration', 'session_time']);
    const operationType = operation.type?.toLowerCase();

    if (operation.target) {
      requiredDataTypes.add('window_title');
    }

    if (!operationType) {
      return Array.from(requiredDataTypes);
    }

    if (operationType.includes('predict')) {
      requiredDataTypes.add('prediction');
      return Array.from(requiredDataTypes);
    }

    if (operationType.includes('suggest')) {
      requiredDataTypes.add('suggestion');
      return Array.from(requiredDataTypes);
    }

    if (operationType.includes('window') || operationType.includes('focus')) {
      requiredDataTypes.add('window_title');
      requiredDataTypes.add('operation_pattern');
      return Array.from(requiredDataTypes);
    }

    requiredDataTypes.add('operation_pattern');
    return Array.from(requiredDataTypes);
  }
}

export default PrivacyManager;
