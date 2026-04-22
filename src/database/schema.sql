-- Hermes Companion SQLite Schema
-- Version 1.0.0

-- User configuration settings
CREATE TABLE IF NOT EXISTS user_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    value_type TEXT DEFAULT 'string',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_user_config_key ON user_config(key);

-- Window history tracking
CREATE TABLE IF NOT EXISTS window_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_id TEXT NOT NULL,
    title TEXT,
    url TEXT,
    app_name TEXT,
    process_id INTEGER,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER,
    closed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_window_history_window_id ON window_history(window_id);
CREATE INDEX IF NOT EXISTS idx_window_history_start_time ON window_history(start_time);
CREATE INDEX IF NOT EXISTS idx_window_history_app_name ON window_history(app_name);

-- Operation history log
CREATE TABLE IF NOT EXISTS operation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_type TEXT NOT NULL,
    target TEXT,
    details TEXT,
    result TEXT,
    error TEXT,
    duration INTEGER,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_operation_history_type ON operation_history(operation_type);
CREATE INDEX IF NOT EXISTS idx_operation_history_timestamp ON operation_history(timestamp);

-- Application usage statistics
CREATE TABLE IF NOT EXISTS app_usage_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT NOT NULL,
    app_path TEXT,
    duration INTEGER NOT NULL DEFAULT 0,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    date TEXT NOT NULL,
    focus_time INTEGER DEFAULT 0,
    idle_time INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_app_usage_stats_app_name ON app_usage_stats(app_name);
CREATE INDEX IF NOT EXISTS idx_app_usage_stats_date ON app_usage_stats(date);

-- Time-based patterns (when user works, peak hours, etc.)
CREATE TABLE IF NOT EXISTS time_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT NOT NULL,
    day_of_week INTEGER,
    hour_start INTEGER,
    hour_end INTEGER,
    date_start INTEGER,
    date_end INTEGER,
    frequency INTEGER DEFAULT 0,
    avg_duration INTEGER,
    confidence REAL DEFAULT 0.0,
    metadata TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_time_patterns_type ON time_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_time_patterns_day ON time_patterns(day_of_week);

-- Operation patterns (sequence of operations, workflows)
CREATE TABLE IF NOT EXISTS operation_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_name TEXT NOT NULL,
    pattern_hash TEXT UNIQUE NOT NULL,
    operation_sequence TEXT NOT NULL,
    frequency INTEGER DEFAULT 1,
    avg_duration INTEGER,
    success_rate REAL DEFAULT 1.0,
    last_occurrence INTEGER,
    metadata TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_operation_patterns_hash ON operation_patterns(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_operation_patterns_name ON operation_patterns(pattern_name);

-- User habits (detected habits and routines)
CREATE TABLE IF NOT EXISTS user_habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_name TEXT NOT NULL,
    trigger_context TEXT,
    trigger_type TEXT,
    action_sequence TEXT NOT NULL,
    frequency INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0.0,
    last_triggered INTEGER,
    is_active INTEGER DEFAULT 1,
    metadata TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_user_habits_name ON user_habits(habit_name);
CREATE INDEX IF NOT EXISTS idx_user_habits_active ON user_habits(is_active);

-- Attention/focus records
CREATE TABLE IF NOT EXISTS attention_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER,
    focus_score REAL DEFAULT 0.0,
    attention_rate REAL DEFAULT 0.0,
    interruptions INTEGER DEFAULT 0,
    context TEXT,
    task_name TEXT,
    productivity_score REAL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_attention_records_start ON attention_records(start_time);
CREATE INDEX IF NOT EXISTS idx_attention_records_duration ON attention_records(duration);

-- Learning progress tracking
CREATE TABLE IF NOT EXISTS learning_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_type TEXT NOT NULL,
    model_name TEXT,
    accuracy REAL,
    loss REAL,
    training_samples INTEGER,
    validation_samples INTEGER,
    learning_rate REAL,
    epoch INTEGER,
    batch_size INTEGER,
    metrics TEXT,
    trained_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_learning_progress_model ON learning_progress(model_type);
CREATE INDEX IF NOT EXISTS idx_learning_progress_trained ON learning_progress(trained_at);

-- Prediction cache
CREATE TABLE IF NOT EXISTS prediction_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_key TEXT UNIQUE NOT NULL,
    prediction_type TEXT NOT NULL,
    prediction_data TEXT NOT NULL,
    confidence REAL DEFAULT 0.0,
    model_version TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER,
    accessed_at INTEGER,
    access_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_prediction_cache_key ON prediction_cache(prediction_key);
CREATE INDEX IF NOT EXISTS idx_prediction_cache_type ON prediction_cache(prediction_type);
CREATE INDEX IF NOT EXISTS idx_prediction_cache_expires ON prediction_cache(expires_at);

-- MCP (Model Context Protocol) sessions
CREATE TABLE IF NOT EXISTS mcp_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    session_type TEXT,
    status TEXT DEFAULT 'active',
    context_id TEXT,
    started_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    ended_at INTEGER,
    duration INTEGER,
    request_count INTEGER DEFAULT 0,
    token_usage INTEGER DEFAULT 0,
    metadata TEXT,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_sessions_session_id ON mcp_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_status ON mcp_sessions(status);
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_started ON mcp_sessions(started_at);

-- Security audit log
CREATE TABLE IF NOT EXISTS security_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    user_id TEXT,
    source_ip TEXT,
    resource TEXT,
    action TEXT,
    details TEXT,
    result TEXT,
    error_code TEXT,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_security_audit_type ON security_audit(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_severity ON security_audit(severity);
CREATE INDEX IF NOT EXISTS idx_security_audit_timestamp ON security_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit(user_id);
