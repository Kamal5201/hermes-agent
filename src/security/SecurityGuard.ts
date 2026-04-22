/**
 * SecurityGuard.ts - 安全检查模块（增强版）
 *
 * 提供全面的安全检查功能，包括：
 * - 高风险操作白名单验证
 * - 可信来源验证
 * - 可疑内容检测（提示注入、SQL注入、XSS、命令注入等）
 * - 操作安全确认
 * - 速率限制检测
 * - 异常模式检测
 */

import log from 'electron-log/main.js';
import { RateLimiter } from './RateLimiter.js';

// ============================================================================
// 安全检查结果接口
// ============================================================================

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  preview?: string;
}

/**
 * 安全检测类型枚举
 */
export enum DetectionType {
  PROMPT_INJECTION = 'prompt_injection',
  SQL_INJECTION = 'sql_injection',
  XSS = 'xss',
  COMMAND_INJECTION = 'command_injection',
  PATH_TRAVERSAL = 'path_traversal',
  RATE_LIMIT = 'rate_limit',
  ANOMALY = 'anomaly',
}

/**
 * 安全检测结果详情
 */
export interface DetectionDetail {
  type: DetectionType;
  pattern?: string;
  matchedContent?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

/**
 * 增强版安全检查选项
 */
export interface EnhancedSecurityCheckOptions {
  /** 启用提示注入检测 */
  enablePromptInjectionCheck?: boolean;
  /** 启用 SQL 注入检测 */
  enableSqlInjectionCheck?: boolean;
  /** 启用 XSS 检测 */
  enableXssCheck?: boolean;
  /** 启用命令注入检测 */
  enableCommandInjectionCheck?: boolean;
  /** 启用路径遍历检测 */
  enablePathTraversalCheck?: boolean;
  /** 启用速率限制检测 */
  enableRateLimitCheck?: boolean;
  /** 启用异常模式检测 */
  enableAnomalyCheck?: boolean;
  /** 是否允许不安全的操作（仅记录） */
  permissiveMode?: boolean;
}

/**
 * 增强版安全检查结果
 */
export interface EnhancedSecurityCheckResult extends SecurityCheckResult {
  detections: DetectionDetail[];
  overallSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  rateLimitInfo?: {
    remaining: number;
    resetAt: number;
  };
}

// ============================================================================
// Security Guard Singleton
// ============================================================================

export class SecurityGuard {
  private static instance: SecurityGuard | null = null;

  // 高风险操作列表
  private readonly highRiskActions: Set<string> = new Set([
    'terminal_execute',
    'file_delete',
    'file_overwrite',
    'system_settings',
    'network_request',
    'code_execution',
    'database_write',
    'registry_modify',
  ]);

  // 可信来源列表
  private readonly trustedSources: Set<string> = new Set([
    'user_direct',
    'hermes_agent',
    'system_internal',
  ]);

  // 提示注入检测模式
  private readonly promptInjectionPatterns: RegExp[] = [
    /ignore[\s\S]*previous[\s\S]*instruction/i,
    /forget[\s\S]*what[\s\S]*said/i,
    /system[\s\S]*prompt[\s\S]*injection/i,
    /you[\s\S]*are[\s\S]*now[\s\S]*different/i,
    /disregard[\s\S]*previous[\s\S]*commands/i,
    /ignore[\s\S]*all[\s\S]*previous/i,
    /new[\s\S]*system[\s\S]*prompt/i,
    /override[\s\S]*safety/i,
    /disable[\s\S]*safety[\s\S]*check/i,
    /pretend[\s\S]*to[\s\S]*be/i,
    /role[\s\S]*play[\s\S]*as/i,
    /switch[\s\S]*to[\s\S]*developer[\s\S]*mode/i,
    /#{3,}.*instruction.*#{3,}/i,
    /\[INST\]|\[\/INST\]/i,
    /<\|system\|>/i,
  ];

  // SQL 注入检测模式
  private readonly sqlInjectionPatterns: RegExp[] = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b.*){2,}/i,
    /('|"|;|--|\/\*|\*\/|@@|@).*(admin|user|passwd|password|root)/i,
    /(OR|AND)\s+['"]?[\w]+['"]?\s*=\s*['"]?[\w]+['"]?/i,
    /'\s*(OR|AND)\s*'1'\s*=\s*'1/i,
    /(DROP|TRUNCATE)\s+TABLE/i,
    /EXEC\s*\(|EXECUTE\s*\(/i,
    /INTO\s+(OUTFILE|DUMPFILE)/i,
    /LOAD_FILE\s*\(/i,
    /BENCHMARK\s*\(/i,
    /SLEEP\s*\(/i,
    /pg_sleep/i,
  ];

  // XSS 检测模式
  private readonly xssPatterns: RegExp[] = [
    /<script[^>]*>.*?<\/script>/is,
    /<iframe[^>]*>.*?<\/iframe>/is,
    /javascript\s*:/i,
    /on\w+\s*=\s*["']?[^"']*["']?/i,
    /<img[^>]+onerror/i,
    /<svg[^>]+onload/i,
    /<body[^>]+onload/i,
    /<embed[^>]+src/i,
    /<object[^>]+data/i,
    /<link[^>]+href.*\.js/i,
    /eval\s*\(\s*["']/i,
    /document\.cookie/i,
    /document\.write/i,
    /innerHTML\s*=/i,
    /outerHTML\s*=/i,
  ];

  // 命令注入检测模式
  private readonly commandInjectionPatterns: RegExp[] = [
    /[;&|`$(){}\\<>]+\s*(cat|ls|cd|wget|curl|bash|sh|exec|eval|system)/i,
    /\|\s*(cat|ls|cd|wget|curl|bash|sh|nc|netcat)/i,
    /;\s*(rm|mkdir|chmod|chown)/i,
    /`[^`]+`/i,
    /\$\([^)]+\)/i,
    /\$\{[^}]+\}/i,
    /&&\s*(rm|mkdir|chmod)/i,
    /\|\|\s*(rm|mkdir|chmod)/i,
    />>\s*\/etc\//i,
    /<\s*\/etc\/passwd/i,
    /\/etc\/passwd/i,
    /\/etc\/shadow/i,
    /\.\.\/|\.\.\\/i,
  ];

  // 路径遍历检测模式
  private readonly pathTraversalPatterns: RegExp[] = [
    /\.\.\/|\.\.\\/i,
    /%2e%2e%2f|%2e%2e\//i,
    /%2e%2e%5c|%2e%2e\\/i,
    /\.\.%2f|\.\.%5c/i,
    /\.\.%c0%af/i,
    /\.\.%252f/i,
    /\/etc\/passwd/i,
    /\/etc\/shadow/i,
    /C:\\Windows\\System32/i,
    /\/proc\/self/i,
    /\/proc\/cmdline/i,
    /\/proc\/environ/i,
  ];

  // 速率限制器引用
  private rateLimiter: RateLimiter;

  // 检查选项
  private checkOptions: EnhancedSecurityCheckOptions = {
    enablePromptInjectionCheck: true,
    enableSqlInjectionCheck: true,
    enableXssCheck: true,
    enableCommandInjectionCheck: true,
    enablePathTraversalCheck: true,
    enableRateLimitCheck: true,
    enableAnomalyCheck: false,
    permissiveMode: false,
  };

  private constructor() {
    this.rateLimiter = RateLimiter.getInstance();
    log.info('[SecurityGuard] Initialized with enhanced security patterns');
  }

  /**
   * Get the singleton instance of SecurityGuard
   */
  public static getInstance(): SecurityGuard {
    if (!SecurityGuard.instance) {
      SecurityGuard.instance = new SecurityGuard();
    }
    return SecurityGuard.instance;
  }

  /**
   * Check if an operation is from a trusted source
   */
  public isTrustedSource(source: string): boolean {
    return this.trustedSources.has(source);
  }

  /**
   * Check if an operation is high-risk
   */
  public isHighRiskAction(operation: string): boolean {
    return this.highRiskActions.has(operation);
  }

  /**
   * 检测提示注入攻击
   */
  public detectPromptInjection(content: string): boolean {
    for (const pattern of this.promptInjectionPatterns) {
      if (pattern.test(content)) {
        log.warn(`[SecurityGuard] Prompt injection pattern detected: ${pattern.source}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 检测 SQL 注入攻击
   */
  public detectSqlInjection(content: string): boolean {
    for (const pattern of this.sqlInjectionPatterns) {
      if (pattern.test(content)) {
        log.warn(`[SecurityGuard] SQL injection pattern detected: ${pattern.source}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 检测 XSS 攻击
   */
  public detectXss(content: string): boolean {
    for (const pattern of this.xssPatterns) {
      if (pattern.test(content)) {
        log.warn(`[SecurityGuard] XSS pattern detected: ${pattern.source}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 检测命令注入攻击
   */
  public detectCommandInjection(content: string): boolean {
    for (const pattern of this.commandInjectionPatterns) {
      if (pattern.test(content)) {
        log.warn(`[SecurityGuard] Command injection pattern detected: ${pattern.source}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 检测路径遍历攻击
   */
  public detectPathTraversal(content: string): boolean {
    for (const pattern of this.pathTraversalPatterns) {
      if (pattern.test(content)) {
        log.warn(`[SecurityGuard] Path traversal pattern detected: ${pattern.source}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 统一的可疑内容检测（兼容旧接口）
   */
  public detectSuspiciousContent(content: string): boolean {
    return (
      this.detectPromptInjection(content) ||
      this.detectSqlInjection(content) ||
      this.detectXss(content) ||
      this.detectCommandInjection(content) ||
      this.detectPathTraversal(content)
    );
  }

  /**
   * 执行增强版安全检查
   *
   * @param operation 操作标识符
   * @param source 操作来源
   * @param content 可选的要检测的内容
   * @param options 检查选项
   * @returns 增强版安全检查结果
   */
  public enhancedCheckOperation(
    operation: string,
    source: string,
    content?: string,
    options?: EnhancedSecurityCheckOptions
  ): EnhancedSecurityCheckResult {
    const opts = { ...this.checkOptions, ...options };
    const detections: DetectionDetail[] = [];
    const now = Date.now();

    log.debug(`[SecurityGuard] Enhanced check: operation=${operation} source=${source}`);

    // 1. 速率限制检查
    if (opts.enableRateLimitCheck) {
      const rateLimitResult = this.rateLimiter.checkAndConsume(source);

      if (!rateLimitResult.allowed) {
        detections.push({
          type: DetectionType.RATE_LIMIT,
          severity: 'high',
          description: `Rate limit exceeded: ${rateLimitResult.reason}`,
        });

        if (!opts.permissiveMode) {
          return {
            allowed: false,
            reason: rateLimitResult.reason,
            requiresConfirmation: false,
            detections,
            overallSeverity: 'high',
            rateLimitInfo: {
              remaining: rateLimitResult.remaining,
              resetAt: rateLimitResult.resetAt,
            },
          };
        }
      }
    }

    // 2. 内容安全检测
    if (content) {
      // 提示注入检测
      if (opts.enablePromptInjectionCheck && this.detectPromptInjection(content)) {
        detections.push({
          type: DetectionType.PROMPT_INJECTION,
          severity: 'critical',
          description: 'Prompt injection attack detected',
          matchedContent: content.substring(0, 200),
        });
      }

      // SQL 注入检测
      if (opts.enableSqlInjectionCheck && this.detectSqlInjection(content)) {
        detections.push({
          type: DetectionType.SQL_INJECTION,
          severity: 'critical',
          description: 'SQL injection attack detected',
          matchedContent: content.substring(0, 200),
        });
      }

      // XSS 检测
      if (opts.enableXssCheck && this.detectXss(content)) {
        detections.push({
          type: DetectionType.XSS,
          severity: 'high',
          description: 'Cross-site scripting (XSS) detected',
          matchedContent: content.substring(0, 200),
        });
      }

      // 命令注入检测
      if (opts.enableCommandInjectionCheck && this.detectCommandInjection(content)) {
        detections.push({
          type: DetectionType.COMMAND_INJECTION,
          severity: 'critical',
          description: 'Command injection attack detected',
          matchedContent: content.substring(0, 200),
        });
      }

      // 路径遍历检测
      if (opts.enablePathTraversalCheck && this.detectPathTraversal(content)) {
        detections.push({
          type: DetectionType.PATH_TRAVERSAL,
          severity: 'high',
          description: 'Path traversal attack detected',
          matchedContent: content.substring(0, 200),
        });
      }

      // 非 permissive 模式下，关键检测直接阻止
      if (!opts.permissiveMode && detections.length > 0) {
        const hasCritical = detections.some(d => d.severity === 'critical');
        if (hasCritical) {
          return {
            allowed: false,
            reason: 'Critical security threat detected',
            requiresConfirmation: false,
            detections,
            overallSeverity: 'critical',
          };
        }
      }
    }

    // 3. 来源验证
    if (!this.isTrustedSource(source)) {
      detections.push({
        type: DetectionType.ANOMALY,
        severity: 'medium',
        description: `Untrusted source: ${source}`,
      });

      if (!opts.permissiveMode) {
        return {
          allowed: false,
          reason: `Untrusted source: ${source}`,
          requiresConfirmation: false,
          detections,
          overallSeverity: 'medium',
        };
      }
    }

    // 4. 高风险操作检查
    if (this.isHighRiskAction(operation)) {
      detections.push({
        type: DetectionType.ANOMALY,
        severity: 'low',
        description: `High-risk action: ${operation}`,
      });

      return {
        allowed: true,
        reason: `High-risk action: ${operation}`,
        requiresConfirmation: true,
        preview: `Action: ${operation} from source: ${source}`,
        detections,
        overallSeverity: detections.length > 0 ? 'medium' : 'low',
      };
    }

    // 计算总体严重程度
    const overallSeverity = this.calculateOverallSeverity(detections);

    return {
      allowed: true,
      reason: detections.length === 0 ? 'Operation approved' : 'Operation approved with warnings',
      requiresConfirmation: false,
      detections,
      overallSeverity,
    };
  }

  /**
   * 计算总体严重程度
   */
  private calculateOverallSeverity(detections: DetectionDetail[]): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    if (detections.length === 0) return 'none';

    const hasCritical = detections.some(d => d.severity === 'critical');
    const hasHigh = detections.some(d => d.severity === 'high');
    const hasMedium = detections.some(d => d.severity === 'medium');

    if (hasCritical) return 'critical';
    if (hasHigh) return 'high';
    if (hasMedium) return 'medium';
    return 'low';
  }

  /**
   * 更新检查选项
   */
  public updateCheckOptions(options: Partial<EnhancedSecurityCheckOptions>): void {
    this.checkOptions = { ...this.checkOptions, ...options };
    log.info(`[SecurityGuard] Check options updated: ${JSON.stringify(options)}`);
  }

  /**
   * 获取检查选项
   */
  public getCheckOptions(): EnhancedSecurityCheckOptions {
    return { ...this.checkOptions };
  }

  /**
   * 获取安全统计信息
   */
  public getSecurityStats(): {
    promptInjectionPatterns: number;
    sqlInjectionPatterns: number;
    xssPatterns: number;
    commandInjectionPatterns: number;
    pathTraversalPatterns: number;
    highRiskActions: number;
    trustedSources: number;
  } {
    return {
      promptInjectionPatterns: this.promptInjectionPatterns.length,
      sqlInjectionPatterns: this.sqlInjectionPatterns.length,
      xssPatterns: this.xssPatterns.length,
      commandInjectionPatterns: this.commandInjectionPatterns.length,
      pathTraversalPatterns: this.pathTraversalPatterns.length,
      highRiskActions: this.highRiskActions.size,
      trustedSources: this.trustedSources.size,
    };
  }

  /**
   * Perform a complete security check on an operation
   * 
   * @param operation - The operation identifier
   * @param source - The source of the operation
   * @param content - Optional content to check for suspicious patterns
   * @returns SecurityCheckResult with allowed status and details
   */
  public checkOperation(
    operation: string,
    source: string,
    content?: string
  ): SecurityCheckResult {
    log.debug(`[SecurityGuard] Checking operation: ${operation} from source: ${source}`);

    // Check for prompt injection in content if provided
    if (content && this.detectSuspiciousContent(content)) {
      log.warn(`[SecurityGuard] Operation blocked - suspicious content detected: ${operation}`);
      return {
        allowed: false,
        reason: 'Suspicious content detected - potential prompt injection attack',
        requiresConfirmation: false,
        preview: content.substring(0, 100)
      };
    }

    // Check if source is trusted
    if (!this.isTrustedSource(source)) {
      log.warn(`[SecurityGuard] Untrusted source: ${source}`);
      return {
        allowed: false,
        reason: `Untrusted source: ${source}`,
        requiresConfirmation: false
      };
    }

    // Check if operation is high-risk
    if (this.isHighRiskAction(operation)) {
      log.info(`[SecurityGuard] High-risk operation requires confirmation: ${operation}`);
      return {
        allowed: true,
        reason: `High-risk action: ${operation}`,
        requiresConfirmation: true,
        preview: `Action: ${operation} from source: ${source}`
      };
    }

    // Operation is allowed
    return {
      allowed: true,
      reason: 'Operation approved'
    };
  }

  /**
   * Add a source to the trusted sources list
   */
  public addTrustedSource(source: string): void {
    this.trustedSources.add(source);
    log.info(`[SecurityGuard] Added trusted source: ${source}`);
  }

  /**
   * Remove a source from the trusted sources list
   */
  public removeTrustedSource(source: string): void {
    this.trustedSources.delete(source);
    log.info(`[SecurityGuard] Removed trusted source: ${source}`);
  }

  /**
   * Add an action to the high-risk actions list
   */
  public addHighRiskAction(action: string): void {
    this.highRiskActions.add(action);
    log.info(`[SecurityGuard] Added high-risk action: ${action}`);
  }

  /**
   * Remove an action from the high-risk actions list
   */
  public removeHighRiskAction(action: string): void {
    this.highRiskActions.delete(action);
    log.info(`[SecurityGuard] Removed high-risk action: ${action}`);
  }
}
