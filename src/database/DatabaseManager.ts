import Database, { Database as DatabaseType } from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface UserConfig {
  id?: number;
  key: string;
  value: string;
  value_type?: string;
  created_at?: number;
  updated_at?: number;
}

export interface WindowHistory {
  id?: number;
  window_id: string;
  title?: string;
  url?: string;
  app_name?: string;
  process_id?: number;
  start_time: number;
  end_time?: number;
  duration?: number;
  closed?: number;
  created_at?: number;
}

export interface OperationHistory {
  id?: number;
  operation_type: string;
  target?: string;
  details?: string;
  result?: string;
  error?: string;
  duration?: number;
  timestamp?: number;
  created_at?: number;
}

export interface AppUsageStats {
  id?: number;
  app_name: string;
  app_path?: string;
  duration?: number;
  start_time: number;
  end_time?: number;
  date: string;
  focus_time?: number;
  idle_time?: number;
  created_at?: number;
  updated_at?: number;
}

export interface TimePattern {
  id?: number;
  pattern_type: string;
  day_of_week?: number;
  hour_start?: number;
  hour_end?: number;
  date_start?: number;
  date_end?: number;
  frequency?: number;
  avg_duration?: number;
  confidence?: number;
  metadata?: string;
  created_at?: number;
  updated_at?: number;
}

export interface OperationPattern {
  id?: number;
  pattern_name: string;
  pattern_hash: string;
  operation_sequence: string;
  frequency?: number;
  avg_duration?: number;
  success_rate?: number;
  last_occurrence?: number;
  metadata?: string;
  created_at?: number;
  updated_at?: number;
}

export interface UserHabit {
  id?: number;
  habit_name: string;
  trigger_context?: string;
  trigger_type?: string;
  action_sequence: string;
  frequency?: number;
  confidence?: number;
  last_triggered?: number;
  is_active?: number;
  metadata?: string;
  created_at?: number;
  updated_at?: number;
}

export interface AttentionRecord {
  id?: number;
  start_time: number;
  end_time?: number;
  duration?: number;
  focus_score?: number;
  attention_rate?: number;
  interruptions?: number;
  context?: string;
  task_name?: string;
  productivity_score?: number;
  created_at?: number;
}

export interface LearningProgress {
  id?: number;
  model_type: string;
  model_name?: string;
  accuracy?: number;
  loss?: number;
  training_samples?: number;
  validation_samples?: number;
  learning_rate?: number;
  epoch?: number;
  batch_size?: number;
  metrics?: string;
  trained_at?: number;
  created_at?: number;
}

export interface PredictionCache {
  id?: number;
  prediction_key: string;
  prediction_type: string;
  prediction_data: string;
  confidence?: number;
  model_version?: string;
  created_at?: number;
  expires_at?: number;
  accessed_at?: number;
  access_count?: number;
}

export interface McpSession {
  id?: number;
  session_id: string;
  session_type?: string;
  status?: string;
  context_id?: string;
  started_at?: number;
  ended_at?: number;
  duration?: number;
  request_count?: number;
  token_usage?: number;
  metadata?: string;
  error?: string;
  created_at?: number;
}

export interface SecurityAudit {
  id?: number;
  event_type: string;
  severity?: string;
  user_id?: string;
  source_ip?: string;
  resource?: string;
  action?: string;
  details?: string;
  result?: string;
  error_code?: string;
  timestamp?: number;
  created_at?: number;
}

export class DatabaseManager {
  private db: DatabaseType;
  private static instance: DatabaseManager | null = null;

  private constructor(dbPath: string) {
    const dbDir = join(dbPath, '..');
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  public static getInstance(dbPath?: string): DatabaseManager {
    if (!DatabaseManager.instance) {
      const defaultPath = dbPath || join(__dirname, '..', '..', 'data', 'hermes.db');
      DatabaseManager.instance = new DatabaseManager(defaultPath);
    }
    return DatabaseManager.instance;
  }

  public static resetInstance(): void {
    if (DatabaseManager.instance) {
      DatabaseManager.instance.close();
      DatabaseManager.instance = null;
    }
  }

  public initialize(): void {
    const schemaPath = join(__dirname, 'schema.sql');
    if (existsSync(schemaPath)) {
      const schema = require('fs').readFileSync(schemaPath, 'utf8');
      this.db.exec(schema);
    }
  }

  public close(): void {
    this.db.close();
  }

  public getDb(): DatabaseType {
    return this.db;
  }

  // ==================== USER_CONFIG ====================

  public createUserConfig(config: UserConfig): number {
    const stmt = this.db.prepare(`
      INSERT INTO user_config (key, value, value_type, created_at, updated_at)
      VALUES (@key, @value, @value_type, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...config, value_type: config.value_type || 'string' });
    return result.lastInsertRowid as number;
  }

  public getUserConfig(key: string): UserConfig | undefined {
    const stmt = this.db.prepare('SELECT * FROM user_config WHERE key = ?');
    return stmt.get(key) as UserConfig | undefined;
  }

  public getAllUserConfigs(): UserConfig[] {
    const stmt = this.db.prepare('SELECT * FROM user_config ORDER BY key');
    return stmt.all() as UserConfig[];
  }

  public updateUserConfig(key: string, value: string, valueType?: string): number {
    const updates: Record<string, unknown> = { key, value };
    let sql = 'UPDATE user_config SET value = ?, updated_at = strftime(\'%s\', \'now\')';
    if (valueType) {
      sql += ', value_type = ?';
      updates.value_type = valueType;
    }
    sql += ' WHERE key = ?';
    const stmt = this.db.prepare(sql);
    const result = stmt.run(valueType ? [value, valueType, key] : [value, key]);
    return result.changes;
  }

  public deleteUserConfig(key: string): number {
    const stmt = this.db.prepare('DELETE FROM user_config WHERE key = ?');
    const result = stmt.run(key);
    return result.changes;
  }

  // ==================== WINDOW_HISTORY ====================

  public createWindowHistory(window: WindowHistory): number {
    const stmt = this.db.prepare(`
      INSERT INTO window_history (window_id, title, url, app_name, process_id, start_time, end_time, duration, closed, created_at)
      VALUES (@window_id, @title, @url, @app_name, @process_id, @start_time, @end_time, @duration, @closed, strftime('%s', 'now'))
    `);
    const result = stmt.run({
      ...window,
      closed: window.closed ?? 0,
      duration: window.duration ?? null,
    });
    return result.lastInsertRowid as number;
  }

  public getWindowHistory(limit = 100, offset = 0): WindowHistory[] {
    const stmt = this.db.prepare('SELECT * FROM window_history ORDER BY start_time DESC LIMIT ? OFFSET ?');
    return stmt.all(limit, offset) as WindowHistory[];
  }

  public getWindowById(windowId: string): WindowHistory | undefined {
    const stmt = this.db.prepare('SELECT * FROM window_history WHERE window_id = ? AND closed = 0 ORDER BY start_time DESC LIMIT 1');
    return stmt.get(windowId) as WindowHistory | undefined;
  }

  public updateWindowHistory(id: number, updates: Partial<WindowHistory>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.end_time !== undefined) { fields.push('end_time = ?'); values.push(updates.end_time); }
    if (updates.duration !== undefined) { fields.push('duration = ?'); values.push(updates.duration); }
    if (updates.closed !== undefined) { fields.push('closed = ?'); values.push(updates.closed); }
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.url !== undefined) { fields.push('url = ?'); values.push(updates.url); }
    if (fields.length === 0) return 0;
    fields.push('end_time = COALESCE(?, end_time)');
    values.push(updates.end_time);
    const sql = `UPDATE window_history SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run([...values, id]);
    return result.changes;
  }

  public closeWindow(windowId: string): number {
    const endTime = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE window_history 
      SET closed = 1, end_time = ?, duration = ? - start_time 
      WHERE window_id = ? AND closed = 0
    `);
    const result = stmt.run(endTime, endTime, windowId);
    return result.changes;
  }

  public deleteWindowHistory(id: number): number {
    const stmt = this.db.prepare('DELETE FROM window_history WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== OPERATION_HISTORY ====================

  public createOperationHistory(op: OperationHistory): number {
    const stmt = this.db.prepare(`
      INSERT INTO operation_history (operation_type, target, details, result, error, duration, timestamp, created_at)
      VALUES (@operation_type, @target, @details, @result, @error, @duration, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run(op);
    return result.lastInsertRowid as number;
  }

  public getOperationHistory(limit = 100, offset = 0): OperationHistory[] {
    const stmt = this.db.prepare('SELECT * FROM operation_history ORDER BY timestamp DESC LIMIT ? OFFSET ?');
    return stmt.all(limit, offset) as OperationHistory[];
  }

  public getOperationsByType(type: string, limit = 50): OperationHistory[] {
    const stmt = this.db.prepare('SELECT * FROM operation_history WHERE operation_type = ? ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(type, limit) as OperationHistory[];
  }

  public getRecentOperations(sinceTimestamp: number): OperationHistory[] {
    const stmt = this.db.prepare('SELECT * FROM operation_history WHERE timestamp >= ? ORDER BY timestamp DESC');
    return stmt.all(sinceTimestamp) as OperationHistory[];
  }

  public deleteOperationHistory(id: number): number {
    const stmt = this.db.prepare('DELETE FROM operation_history WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== APP_USAGE_STATS ====================

  public createAppUsageStats(stats: AppUsageStats): number {
    const stmt = this.db.prepare(`
      INSERT INTO app_usage_stats (app_name, app_path, duration, start_time, end_time, date, focus_time, idle_time, created_at, updated_at)
      VALUES (@app_name, @app_path, @duration, @start_time, @end_time, @date, @focus_time, @idle_time, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...stats, duration: stats.duration ?? 0, focus_time: stats.focus_time ?? 0, idle_time: stats.idle_time ?? 0 });
    return result.lastInsertRowid as number;
  }

  public getAppUsageStats(date: string): AppUsageStats[] {
    const stmt = this.db.prepare('SELECT * FROM app_usage_stats WHERE date = ? ORDER BY duration DESC');
    return stmt.all(date) as AppUsageStats[];
  }

  public getAppUsageByName(appName: string, limit = 30): AppUsageStats[] {
    const stmt = this.db.prepare('SELECT * FROM app_usage_stats WHERE app_name = ? ORDER BY date DESC LIMIT ?');
    return stmt.all(appName, limit) as AppUsageStats[];
  }

  public updateAppUsageStats(id: number, updates: Partial<AppUsageStats>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.duration !== undefined) { fields.push('duration = ?'); values.push(updates.duration); }
    if (updates.end_time !== undefined) { fields.push('end_time = ?'); values.push(updates.end_time); }
    if (updates.focus_time !== undefined) { fields.push('focus_time = ?'); values.push(updates.focus_time); }
    if (updates.idle_time !== undefined) { fields.push('idle_time = ?'); values.push(updates.idle_time); }
    fields.push('updated_at = strftime(\'%s\', \'now\')');
    if (fields.length === 1) return 0;
    values.push(id);
    const sql = `UPDATE app_usage_stats SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(values);
    return result.changes;
  }

  public deleteAppUsageStats(id: number): number {
    const stmt = this.db.prepare('DELETE FROM app_usage_stats WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== TIME_PATTERNS ====================

  public createTimePattern(pattern: TimePattern): number {
    const stmt = this.db.prepare(`
      INSERT INTO time_patterns (pattern_type, day_of_week, hour_start, hour_end, date_start, date_end, frequency, avg_duration, confidence, metadata, created_at, updated_at)
      VALUES (@pattern_type, @day_of_week, @hour_start, @hour_end, @date_start, @date_end, @frequency, @avg_duration, @confidence, @metadata, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...pattern, frequency: pattern.frequency ?? 0, confidence: pattern.confidence ?? 0 });
    return result.lastInsertRowid as number;
  }

  public getTimePatterns(patternType?: string): TimePattern[] {
    if (patternType) {
      const stmt = this.db.prepare('SELECT * FROM time_patterns WHERE pattern_type = ? ORDER BY frequency DESC');
      return stmt.all(patternType) as TimePattern[];
    }
    const stmt = this.db.prepare('SELECT * FROM time_patterns ORDER BY frequency DESC');
    return stmt.all() as TimePattern[];
  }

  public getTimePatternsByDay(dayOfWeek: number): TimePattern[] {
    const stmt = this.db.prepare('SELECT * FROM time_patterns WHERE day_of_week = ? ORDER BY frequency DESC');
    return stmt.all(dayOfWeek) as TimePattern[];
  }

  public updateTimePattern(id: number, updates: Partial<TimePattern>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowedFields = ['pattern_type', 'day_of_week', 'hour_start', 'hour_end', 'date_start', 'date_end', 'frequency', 'avg_duration', 'confidence', 'metadata'];
    for (const field of allowedFields) {
      if (updates[field as keyof TimePattern] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field as keyof TimePattern]);
      }
    }
    if (fields.length === 0) return 0;
    fields.push('updated_at = strftime(\'%s\', \'now\')');
    values.push(id);
    const sql = `UPDATE time_patterns SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(values);
    return result.changes;
  }

  public deleteTimePattern(id: number): number {
    const stmt = this.db.prepare('DELETE FROM time_patterns WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== OPERATION_PATTERNS ====================

  public createOperationPattern(pattern: OperationPattern): number {
    const stmt = this.db.prepare(`
      INSERT INTO operation_patterns (pattern_name, pattern_hash, operation_sequence, frequency, avg_duration, success_rate, last_occurrence, metadata, created_at, updated_at)
      VALUES (@pattern_name, @pattern_hash, @operation_sequence, @frequency, @avg_duration, @success_rate, @last_occurrence, @metadata, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...pattern, frequency: pattern.frequency ?? 1, success_rate: pattern.success_rate ?? 1.0 });
    return result.lastInsertRowid as number;
  }

  public getOperationPatternByHash(hash: string): OperationPattern | undefined {
    const stmt = this.db.prepare('SELECT * FROM operation_patterns WHERE pattern_hash = ?');
    return stmt.get(hash) as OperationPattern | undefined;
  }

  public getAllOperationPatterns(): OperationPattern[] {
    const stmt = this.db.prepare('SELECT * FROM operation_patterns ORDER BY frequency DESC');
    return stmt.all() as OperationPattern[];
  }

  public updateOperationPattern(id: number, updates: Partial<OperationPattern>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowedFields = ['pattern_name', 'operation_sequence', 'frequency', 'avg_duration', 'success_rate', 'last_occurrence', 'metadata'];
    for (const field of allowedFields) {
      if (updates[field as keyof OperationPattern] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field as keyof OperationPattern]);
      }
    }
    if (fields.length === 0) return 0;
    fields.push('updated_at = strftime(\'%s\', \'now\')');
    values.push(id);
    const sql = `UPDATE operation_patterns SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(values);
    return result.changes;
  }

  public incrementPatternFrequency(hash: string): number {
    const stmt = this.db.prepare(`
      UPDATE operation_patterns 
      SET frequency = frequency + 1, last_occurrence = strftime('%s', 'now'), updated_at = strftime('%s', 'now')
      WHERE pattern_hash = ?
    `);
    const result = stmt.run(hash);
    return result.changes;
  }

  public deleteOperationPattern(id: number): number {
    const stmt = this.db.prepare('DELETE FROM operation_patterns WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== USER_HABITS ====================

  public createUserHabit(habit: UserHabit): number {
    const stmt = this.db.prepare(`
      INSERT INTO user_habits (habit_name, trigger_context, trigger_type, action_sequence, frequency, confidence, last_triggered, is_active, metadata, created_at, updated_at)
      VALUES (@habit_name, @trigger_context, @trigger_type, @action_sequence, @frequency, @confidence, @last_triggered, @is_active, @metadata, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...habit, frequency: habit.frequency ?? 0, confidence: habit.confidence ?? 0, is_active: habit.is_active ?? 1 });
    return result.lastInsertRowid as number;
  }

  public getActiveUserHabits(): UserHabit[] {
    const stmt = this.db.prepare('SELECT * FROM user_habits WHERE is_active = 1 ORDER BY confidence DESC');
    return stmt.all() as UserHabit[];
  }

  public getUserHabitByName(name: string): UserHabit | undefined {
    const stmt = this.db.prepare('SELECT * FROM user_habits WHERE habit_name = ?');
    return stmt.get(name) as UserHabit | undefined;
  }

  public getAllUserHabits(): UserHabit[] {
    const stmt = this.db.prepare('SELECT * FROM user_habits ORDER BY confidence DESC');
    return stmt.all() as UserHabit[];
  }

  public updateUserHabit(id: number, updates: Partial<UserHabit>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    const allowedFields = ['habit_name', 'trigger_context', 'trigger_type', 'action_sequence', 'frequency', 'confidence', 'last_triggered', 'is_active', 'metadata'];
    for (const field of allowedFields) {
      if (updates[field as keyof UserHabit] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field as keyof UserHabit]);
      }
    }
    if (fields.length === 0) return 0;
    fields.push('updated_at = strftime(\'%s\', \'now\')');
    values.push(id);
    const sql = `UPDATE user_habits SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(values);
    return result.changes;
  }

  public triggerHabit(id: number): number {
    const stmt = this.db.prepare(`
      UPDATE user_habits 
      SET last_triggered = strftime('%s', 'now'), frequency = frequency + 1, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    const result = stmt.run(id);
    return result.changes;
  }

  public deleteUserHabit(id: number): number {
    const stmt = this.db.prepare('DELETE FROM user_habits WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== ATTENTION_RECORDS ====================

  public createAttentionRecord(record: AttentionRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO attention_records (start_time, end_time, duration, focus_score, attention_rate, interruptions, context, task_name, productivity_score, created_at)
      VALUES (@start_time, @end_time, @duration, @focus_score, @attention_rate, @interruptions, @context, @task_name, @productivity_score, strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...record, interruptions: record.interruptions ?? 0, focus_score: record.focus_score ?? 0, attention_rate: record.attention_rate ?? 0 });
    return result.lastInsertRowid as number;
  }

  public getAttentionRecords(limit = 100, offset = 0): AttentionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM attention_records ORDER BY start_time DESC LIMIT ? OFFSET ?');
    return stmt.all(limit, offset) as AttentionRecord[];
  }

  public getAttentionRecordById(id: number): AttentionRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM attention_records WHERE id = ?');
    return stmt.get(id) as AttentionRecord | undefined;
  }

  public updateAttentionRecord(id: number, updates: Partial<AttentionRecord>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.end_time !== undefined) { fields.push('end_time = ?'); values.push(updates.end_time); }
    if (updates.duration !== undefined) { fields.push('duration = ?'); values.push(updates.duration); }
    if (updates.focus_score !== undefined) { fields.push('focus_score = ?'); values.push(updates.focus_score); }
    if (updates.attention_rate !== undefined) { fields.push('attention_rate = ?'); values.push(updates.attention_rate); }
    if (updates.interruptions !== undefined) { fields.push('interruptions = ?'); values.push(updates.interruptions); }
    if (updates.context !== undefined) { fields.push('context = ?'); values.push(updates.context); }
    if (updates.task_name !== undefined) { fields.push('task_name = ?'); values.push(updates.task_name); }
    if (updates.productivity_score !== undefined) { fields.push('productivity_score = ?'); values.push(updates.productivity_score); }
    if (fields.length === 0) return 0;
    values.push(id);
    const sql = `UPDATE attention_records SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(values);
    return result.changes;
  }

  public deleteAttentionRecord(id: number): number {
    const stmt = this.db.prepare('DELETE FROM attention_records WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== LEARNING_PROGRESS ====================

  public createLearningProgress(progress: LearningProgress): number {
    const stmt = this.db.prepare(`
      INSERT INTO learning_progress (model_type, model_name, accuracy, loss, training_samples, validation_samples, learning_rate, epoch, batch_size, metrics, trained_at, created_at)
      VALUES (@model_type, @model_name, @accuracy, @loss, @training_samples, @validation_samples, @learning_rate, @epoch, @batch_size, @metrics, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run(progress);
    return result.lastInsertRowid as number;
  }

  public getLearningProgress(modelType?: string, limit = 50): LearningProgress[] {
    if (modelType) {
      const stmt = this.db.prepare('SELECT * FROM learning_progress WHERE model_type = ? ORDER BY trained_at DESC LIMIT ?');
      return stmt.all(modelType, limit) as LearningProgress[];
    }
    const stmt = this.db.prepare('SELECT * FROM learning_progress ORDER BY trained_at DESC LIMIT ?');
    return stmt.all(limit) as LearningProgress[];
  }

  public getLatestLearningProgress(modelType: string): LearningProgress | undefined {
    const stmt = this.db.prepare('SELECT * FROM learning_progress WHERE model_type = ? ORDER BY trained_at DESC LIMIT 1');
    return stmt.get(modelType) as LearningProgress | undefined;
  }

  public deleteLearningProgress(id: number): number {
    const stmt = this.db.prepare('DELETE FROM learning_progress WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== PREDICTION_CACHE ====================

  public createPredictionCache(prediction: PredictionCache): number {
    const stmt = this.db.prepare(`
      INSERT INTO prediction_cache (prediction_key, prediction_type, prediction_data, confidence, model_version, created_at, expires_at, accessed_at, access_count)
      VALUES (@prediction_key, @prediction_type, @prediction_data, @confidence, @model_version, strftime('%s', 'now'), @expires_at, strftime('%s', 'now'), 0)
    `);
    const result = stmt.run({ ...prediction, confidence: prediction.confidence ?? 0, access_count: 0 });
    return result.lastInsertRowid as number;
  }

  public getPredictionCache(key: string): PredictionCache | undefined {
    const stmt = this.db.prepare('SELECT * FROM prediction_cache WHERE prediction_key = ?');
    const prediction = stmt.get(key) as PredictionCache | undefined;
    if (prediction) {
      const updateStmt = this.db.prepare('UPDATE prediction_cache SET accessed_at = strftime(\'%s\', \'now\'), access_count = access_count + 1 WHERE prediction_key = ?');
      updateStmt.run(key);
    }
    return prediction;
  }

  public getValidPredictions(predictionType?: string): PredictionCache[] {
    const now = Math.floor(Date.now() / 1000);
    if (predictionType) {
      const stmt = this.db.prepare('SELECT * FROM prediction_cache WHERE prediction_type = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC');
      return stmt.all(predictionType, now) as PredictionCache[];
    }
    const stmt = this.db.prepare('SELECT * FROM prediction_cache WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC');
    return stmt.all(now) as PredictionCache[];
  }

  public updatePredictionCache(id: number, updates: Partial<PredictionCache>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.prediction_data !== undefined) { fields.push('prediction_data = ?'); values.push(updates.prediction_data); }
    if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(updates.confidence); }
    if (updates.expires_at !== undefined) { fields.push('expires_at = ?'); values.push(updates.expires_at); }
    if (fields.length === 0) return 0;
    values.push(id);
    const sql = `UPDATE prediction_cache SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(values);
    return result.changes;
  }

  public deletePredictionCache(id: number): number {
    const stmt = this.db.prepare('DELETE FROM prediction_cache WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  public cleanupExpiredPredictions(): number {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare('DELETE FROM prediction_cache WHERE expires_at IS NOT NULL AND expires_at < ?');
    const result = stmt.run(now);
    return result.changes;
  }

  // ==================== MCP_SESSIONS ====================

  public createMcpSession(session: McpSession): number {
    const stmt = this.db.prepare(`
      INSERT INTO mcp_sessions (session_id, session_type, status, context_id, started_at, request_count, token_usage, metadata, created_at)
      VALUES (@session_id, @session_type, @status, @context_id, strftime('%s', 'now'), @request_count, @token_usage, @metadata, strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...session, status: session.status ?? 'active', request_count: session.request_count ?? 0, token_usage: session.token_usage ?? 0 });
    return result.lastInsertRowid as number;
  }

  public getMcpSession(sessionId: string): McpSession | undefined {
    const stmt = this.db.prepare('SELECT * FROM mcp_sessions WHERE session_id = ?');
    return stmt.get(sessionId) as McpSession | undefined;
  }

  public getActiveMcpSessions(): McpSession[] {
    const stmt = this.db.prepare('SELECT * FROM mcp_sessions WHERE status = \'active\' ORDER BY started_at DESC');
    return stmt.all() as McpSession[];
  }

  public updateMcpSession(sessionId: string, updates: Partial<McpSession>): number {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.ended_at !== undefined) { fields.push('ended_at = ?'); values.push(updates.ended_at); }
    if (updates.duration !== undefined) { fields.push('duration = ?'); values.push(updates.duration); }
    if (updates.request_count !== undefined) { fields.push('request_count = ?'); values.push(updates.request_count); }
    if (updates.token_usage !== undefined) { fields.push('token_usage = ?'); values.push(updates.token_usage); }
    if (updates.metadata !== undefined) { fields.push('metadata = ?'); values.push(updates.metadata); }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error); }
    if (fields.length === 0) return 0;
    values.push(sessionId);
    const sql = `UPDATE mcp_sessions SET ${fields.join(', ')} WHERE session_id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(values);
    return result.changes;
  }

  public endMcpSession(sessionId: string): number {
    const endedAt = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE mcp_sessions 
      SET status = 'ended', ended_at = ?, duration = ? - started_at 
      WHERE session_id = ? AND status = 'active'
    `);
    const result = stmt.run(endedAt, endedAt, sessionId);
    return result.changes;
  }

  public deleteMcpSession(id: number): number {
    const stmt = this.db.prepare('DELETE FROM mcp_sessions WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== SECURITY_AUDIT ====================

  public createSecurityAudit(audit: SecurityAudit): number {
    const stmt = this.db.prepare(`
      INSERT INTO security_audit (event_type, severity, user_id, source_ip, resource, action, details, result, error_code, timestamp, created_at)
      VALUES (@event_type, @severity, @user_id, @source_ip, @resource, @action, @details, @result, @error_code, strftime('%s', 'now'), strftime('%s', 'now'))
    `);
    const result = stmt.run({ ...audit, severity: audit.severity ?? 'info' });
    return result.lastInsertRowid as number;
  }

  public getSecurityAudits(limit = 100, offset = 0): SecurityAudit[] {
    const stmt = this.db.prepare('SELECT * FROM security_audit ORDER BY timestamp DESC LIMIT ? OFFSET ?');
    return stmt.all(limit, offset) as SecurityAudit[];
  }

  public getSecurityAuditsByType(eventType: string, limit = 100): SecurityAudit[] {
    const stmt = this.db.prepare('SELECT * FROM security_audit WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(eventType, limit) as SecurityAudit[];
  }

  public getSecurityAuditsBySeverity(severity: string, limit = 100): SecurityAudit[] {
    const stmt = this.db.prepare('SELECT * FROM security_audit WHERE severity = ? ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(severity, limit) as SecurityAudit[];
  }

  public getSecurityAuditsByUser(userId: string, limit = 100): SecurityAudit[] {
    const stmt = this.db.prepare('SELECT * FROM security_audit WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(userId, limit) as SecurityAudit[];
  }

  public getRecentSecurityAudits(sinceTimestamp: number): SecurityAudit[] {
    const stmt = this.db.prepare('SELECT * FROM security_audit WHERE timestamp >= ? ORDER BY timestamp DESC');
    return stmt.all(sinceTimestamp) as SecurityAudit[];
  }

  public deleteSecurityAudit(id: number): number {
    const stmt = this.db.prepare('DELETE FROM security_audit WHERE id = ?');
    const result = stmt.run(id);
    return result.changes;
  }

  // ==================== UTILITY METHODS ====================

  public vacuum(): void {
    this.db.exec('VACUUM');
  }

  public getDatabaseSize(): number {
    const result = this.db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as { size: number };
    return result.size;
  }

  public backup(backupPath: string): void {
    this.db.backup(backupPath);
  }

  // ==================== BATCH OPERATIONS ====================

  /**
   * 批量插入窗口历史记录
   * 使用事务提高性能
   */
  public batchInsertWindowHistory(records: WindowHistory[]): number {
    if (records.length === 0) {
      return 0;
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO window_history (window_id, title, url, app_name, process_id, start_time, end_time, duration, closed, created_at)
      VALUES (@window_id, @title, @url, @app_name, @process_id, @start_time, @end_time, @duration, @closed, strftime('%s', 'now'))
    `);

    const insertMany = this.db.transaction((items: WindowHistory[]) => {
      let inserted = 0;
      for (const record of items) {
        const result = insertStmt.run({
          window_id: record.window_id,
          title: record.title ?? null,
          url: record.url ?? null,
          app_name: record.app_name ?? null,
          process_id: record.process_id ?? null,
          start_time: record.start_time,
          end_time: record.end_time ?? null,
          closed: record.closed ?? 0,
          duration: record.duration ?? null,
        });
        if (result.changes > 0) {
          inserted++;
        }
      }
      return inserted;
    });

    return insertMany(records);
  }

  /**
   * 批量插入操作历史记录
   */
  public batchInsertOperationHistory(records: OperationHistory[]): number {
    if (records.length === 0) {
      return 0;
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO operation_history (operation_type, target, details, result, error, duration, timestamp, created_at)
      VALUES (@operation_type, @target, @details, @result, @error, @duration, strftime('%s', 'now'), strftime('%s', 'now'))
    `);

    const insertMany = this.db.transaction((items: OperationHistory[]) => {
      let inserted = 0;
      for (const record of items) {
        const result = insertStmt.run(record);
        if (result.changes > 0) {
          inserted++;
        }
      }
      return inserted;
    });

    return insertMany(records);
  }

  /**
   * 批量插入应用使用统计
   */
  public batchInsertAppUsageStats(records: AppUsageStats[]): number {
    if (records.length === 0) {
      return 0;
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO app_usage_stats (app_name, app_path, duration, start_time, end_time, date, focus_time, idle_time, created_at, updated_at)
      VALUES (@app_name, @app_path, @duration, @start_time, @end_time, @date, @focus_time, @idle_time, strftime('%s', 'now'), strftime('%s', 'now'))
    `);

    const insertMany = this.db.transaction((items: AppUsageStats[]) => {
      let inserted = 0;
      for (const record of items) {
        const result = insertStmt.run({
          ...record,
          duration: record.duration ?? 0,
          focus_time: record.focus_time ?? 0,
          idle_time: record.idle_time ?? 0,
        });
        if (result.changes > 0) {
          inserted++;
        }
      }
      return inserted;
    });

    return insertMany(records);
  }

  /**
   * 批量插入安全审计记录
   */
  public batchInsertSecurityAudit(records: SecurityAudit[]): number {
    if (records.length === 0) {
      return 0;
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO security_audit (event_type, severity, user_id, source_ip, resource, action, details, result, error_code, timestamp, created_at)
      VALUES (@event_type, @severity, @user_id, @source_ip, @resource, @action, @details, @result, @error_code, strftime('%s', 'now'), strftime('%s', 'now'))
    `);

    const insertMany = this.db.transaction((items: SecurityAudit[]) => {
      let inserted = 0;
      for (const record of items) {
        const result = insertStmt.run({
          ...record,
          severity: record.severity ?? 'info',
        });
        if (result.changes > 0) {
          inserted++;
        }
      }
      return inserted;
    });

    return insertMany(records);
  }

  /**
   * 批量更新窗口历史记录（批量关闭）
   */
  public batchCloseWindowHistory(windowIds: string[]): number {
    if (windowIds.length === 0) {
      return 0;
    }

    const endTime = Math.floor(Date.now() / 1000);
    
    const updateStmt = this.db.prepare(`
      UPDATE window_history 
      SET closed = 1, end_time = ?, duration = ? - start_time 
      WHERE window_id = ? AND closed = 0
    `);

    const updateMany = this.db.transaction((ids: string[]) => {
      let updated = 0;
      for (const windowId of ids) {
        const result = updateStmt.run(endTime, endTime, windowId);
        updated += result.changes;
      }
      return updated;
    });

    return updateMany(windowIds);
  }

  /**
   * 批量更新用户习惯触发次数
   */
  public batchTriggerHabits(habitIds: number[]): number {
    if (habitIds.length === 0) {
      return 0;
    }

    const updateStmt = this.db.prepare(`
      UPDATE user_habits 
      SET last_triggered = strftime('%s', 'now'), frequency = frequency + 1, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);

    const updateMany = this.db.transaction((ids: number[]) => {
      let updated = 0;
      for (const id of ids) {
        const result = updateStmt.run(id);
        updated += result.changes;
      }
      return updated;
    });

    return updateMany(habitIds);
  }

  /**
   * 批量删除过期记录
   * @param table 表名
   * @param timestampField 时间戳字段名
   * @param olderThanDays 早于多少天删除
   */
  public batchDeleteExpiredRecords(
    table: string,
    timestampField: string,
    olderThanDays: number
  ): number {
    const cutoffTime = Math.floor(Date.now() / 1000) - (olderThanDays * 24 * 60 * 60);
    
    const safeTables = ['window_history', 'operation_history', 'attention_records', 'prediction_cache', 'mcp_sessions', 'security_audit'];
    if (!safeTables.includes(table)) {
      throw new Error(`Unsafe table name: ${table}`);
    }

    const stmt = this.db.prepare(`DELETE FROM ${table} WHERE ${timestampField} < ?`);
    const result = stmt.run(cutoffTime);
    return result.changes;
  }

  /**
   * 执行批量操作（通用）
   * @param operations 要执行的操作数组
   */
  public executeBatch(operations: Array<{ sql: string; params?: unknown[] }>): number {
    const execBatch = this.db.transaction((ops: Array<{ sql: string; params?: unknown[] }>) => {
      let totalChanges = 0;
      for (const op of ops) {
        const stmt = this.db.prepare(op.sql);
        const result = stmt.run(op.params ?? []);
        totalChanges += result.changes;
      }
      return totalChanges;
    });

    return execBatch(operations);
  }

  /**
   * 批量upsert操作（插入或更新）
   * @param table 表名
   * @param records 要upsert的记录
   * @param uniqueField 唯一字段名
   */
  public batchUpsert<T extends Record<string, unknown>>(
    table: string,
    records: T[],
    uniqueField: string
  ): number {
    if (records.length === 0) {
      return 0;
    }

    const safeTables = ['user_config', 'time_patterns', 'operation_patterns', 'user_habits', 'prediction_cache'];
    if (!safeTables.includes(table)) {
      throw new Error(`Unsafe table name for upsert: ${table}`);
    }

    const execUpsert = this.db.transaction((items: T[]) => {
      let upserted = 0;
      for (const record of items) {
        const uniqueValue = record[uniqueField];
        if (uniqueValue === undefined) {
          continue;
        }

        // 构建更新字段（排除唯一字段和自动生成的字段）
        const updateFields: string[] = [];
        const values: unknown[] = [];
        const excludeFields = [uniqueField, 'id', 'created_at'];
        
        for (const [key, value] of Object.entries(record)) {
          if (excludeFields.includes(key)) {
            continue;
          }
          updateFields.push(`${key} = ?`);
          values.push(value);
        }

        if (updateFields.length === 0) {
          continue;
        }

        // 检查是否存在
        const checkStmt = this.db.prepare(`SELECT id FROM ${table} WHERE ${uniqueField} = ?`);
        const existing = checkStmt.get(uniqueValue);

        if (existing) {
          // 更新
          values.push(uniqueValue);
          const updateStmt = this.db.prepare(`UPDATE ${table} SET ${updateFields.join(', ')} WHERE ${uniqueField} = ?`);
          const result = updateStmt.run(values);
          upserted += result.changes;
        } else {
          // 插入
          const fields = Object.keys(record).filter((k) => !excludeFields.includes(k));
          const placeholders = fields.map(() => '?').join(', ');
          const insertValues = fields.map((f) => record[f]);
          
          const insertStmt = this.db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`);
          const result = insertStmt.run(insertValues);
          upserted += result.changes;
        }
      }
      return upserted;
    });

    return execUpsert(records);
  }
}

export default DatabaseManager;
