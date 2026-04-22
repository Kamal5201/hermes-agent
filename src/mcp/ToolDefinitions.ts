export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface JsonSchema {
  type: JsonSchemaType;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
  default?: string | number | boolean | null;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  category: 'perception' | 'execution' | 'learning' | 'config' | 'mcp';
  version: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  requiresConfirmation?: boolean;
  capabilities?: string[];
}

const emptyObjectSchema: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const executionResultSchema: JsonSchema = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    success: { type: 'boolean' },
    timestamp: { type: 'number' },
    details: { type: 'object' },
  },
  required: ['action', 'success', 'timestamp', 'details'],
  additionalProperties: false,
};

export const MCP_META_TOOLS: MCPToolDefinition[] = [
  {
    name: 'mcp.ping',
    description: '检查 MCP 协议连接、版本与基础能力。',
    category: 'mcp',
    version: '1.1.0',
    inputSchema: emptyObjectSchema,
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        protocolVersion: { type: 'string' },
        timestamp: { type: 'number' },
      },
      required: ['ok', 'protocolVersion', 'timestamp'],
      additionalProperties: false,
    },
  },
  {
    name: 'mcp.list_tools',
    description: '返回当前 MCP 工具定义清单。',
    category: 'mcp',
    version: '1.1.0',
    inputSchema: emptyObjectSchema,
    outputSchema: {
      type: 'object',
      properties: {
        tools: {
          type: 'array',
          items: { type: 'object' },
        },
        count: { type: 'number' },
      },
      required: ['tools', 'count'],
      additionalProperties: false,
    },
  },
];

export const PERCEPTION_TOOLS: MCPToolDefinition[] = [
  {
    name: 'perception.capture_screen',
    description: '截取当前屏幕，可选区域和输出格式。',
    category: 'perception',
    version: '1.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: '可选截图区域。',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['x', 'y', 'width', 'height'],
          additionalProperties: false,
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg', 'webp'],
          default: 'png',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'perception.get_windows',
    description: '获取当前可见窗口列表。',
    category: 'perception',
    version: '1.0.0',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_focused_window',
    description: '获取当前聚焦窗口。',
    category: 'perception',
    version: '1.0.0',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_running_apps',
    description: '获取当前运行中的应用进程。',
    category: 'perception',
    version: '1.0.0',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_mouse_position',
    description: '获取当前鼠标坐标。',
    category: 'perception',
    version: '1.0.0',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_clipboard',
    description: '获取当前剪贴板内容。',
    category: 'perception',
    version: '1.0.0',
    inputSchema: emptyObjectSchema,
  },
];

export const EXECUTION_TOOLS: MCPToolDefinition[] = [
  {
    name: 'execution.click',
    description: '在指定屏幕坐标执行鼠标点击。',
    category: 'execution',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: {
          type: 'string',
          enum: ['left', 'middle', 'right'],
          default: 'left',
        },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.double_click',
    description: '在指定屏幕坐标执行双击。',
    category: 'execution',
    version: '1.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: {
          type: 'string',
          enum: ['left', 'middle', 'right'],
          default: 'left',
        },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.move_mouse',
    description: '移动鼠标到指定坐标，不执行点击。',
    category: 'execution',
    version: '1.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.drag',
    description: '从起点拖拽到终点。',
    category: 'execution',
    version: '1.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number' },
        fromY: { type: 'number' },
        toX: { type: 'number' },
        toY: { type: 'number' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
    requiresConfirmation: true,
  },
  {
    name: 'execution.scroll',
    description: '按步数滚动鼠标滚轮，支持横向和纵向。',
    category: 'execution',
    version: '1.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        xSteps: { type: 'number', default: 0 },
        ySteps: { type: 'number', default: 0 },
      },
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.wait',
    description: '等待一段时间，用于脚本节拍控制。',
    category: 'execution',
    version: '1.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', minimum: 0 },
      },
      required: ['ms'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.type_text',
    description: '通过系统键盘输入文本。',
    category: 'execution',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.press_key',
    description: '按下并释放单个按键。',
    category: 'execution',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.hotkey',
    description: '执行组合键。',
    category: 'execution',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['keys'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.open_app',
    description: '打开指定应用。',
    category: 'execution',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string' },
      },
      required: ['bundleId'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
  },
  {
    name: 'execution.close_app',
    description: '关闭指定应用。',
    category: 'execution',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string' },
      },
      required: ['bundleId'],
      additionalProperties: false,
    },
    outputSchema: executionResultSchema,
    requiresConfirmation: true,
  },
];

export const LEARNING_TOOLS: MCPToolDefinition[] = [
  {
    name: 'learning.get_patterns',
    description: '获取当前学习到的时间、操作和习惯模式。',
    category: 'learning',
    version: '1.0.0',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'learning.get_prediction',
    description: '根据当前上下文获取下一步预测。',
    category: 'learning',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        currentApp: { type: 'string' },
        time: { type: 'number' },
        recentApps: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'learning.get_user_profile',
    description: '获取当前用户画像。',
    category: 'learning',
    version: '1.0.0',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'learning.get_cycle_status',
    description: '获取 7 天学习周期执行状态和当前学习率。',
    category: 'learning',
    version: '1.1.0',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'learning.run_cycle_day',
    description: '执行指定天数或下一天的学习周期。',
    category: 'learning',
    version: '1.1.0',
    inputSchema: {
      type: 'object',
      properties: {
        day: { type: 'number', minimum: 1, maximum: 7 },
        next: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'learning.set_feedback',
    description: '提交对预测结果的反馈。',
    category: 'learning',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        predictionType: { type: 'string' },
        predictedApp: { type: 'string' },
        actualApp: { type: 'string' },
        context: { type: 'string' },
        feedback: {
          type: 'string',
          enum: ['accept', 'reject', 'modify'],
        },
        predictionId: { type: 'string' },
        correct: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
];

export const CONFIG_TOOLS: MCPToolDefinition[] = [
  {
    name: 'config.config_get',
    description: '获取指定配置项。',
    category: 'config',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'config.config_set',
    description: '写入指定配置项。',
    category: 'config',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: {
          type: 'object',
          description: '配置值，序列化后存储。',
        },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    requiresConfirmation: true,
  },
  {
    name: 'config.set_privacy',
    description: '切换隐私模式或封禁应用。',
    category: 'config',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        bundleId: { type: 'string' },
        blocked: { type: 'boolean' },
        level: {
          type: 'string',
          enum: ['conservative', 'balanced', 'full'],
        },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
  },
];

export const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  ...MCP_META_TOOLS,
  ...PERCEPTION_TOOLS,
  ...EXECUTION_TOOLS,
  ...LEARNING_TOOLS,
  ...CONFIG_TOOLS,
];

export const TOOL_NAME_MAP: Record<string, string> = TOOL_DEFINITIONS.reduce<Record<string, string>>((acc, tool) => {
  const shortName = tool.name.split('.').pop();

  if (shortName) {
    acc[shortName] = tool.name;
  }

  acc[tool.name] = tool.name;
  return acc;
}, {});

export function getToolDefinition(name: string): MCPToolDefinition | undefined {
  const fullName = TOOL_NAME_MAP[name] ?? name;
  return TOOL_DEFINITIONS.find((tool) => tool.name === fullName);
}
