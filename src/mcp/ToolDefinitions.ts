export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface JsonSchema {
  type: JsonSchemaType;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  minimum?: number;
  additionalProperties?: boolean;
  default?: string | number | boolean | null;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

const emptyObjectSchema: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

export const PERCEPTION_TOOLS: MCPToolDefinition[] = [
  {
    name: 'perception.capture_screen',
    description: '截取当前屏幕，可选区域和输出格式。',
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
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_focused_window',
    description: '获取当前聚焦窗口。',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_running_apps',
    description: '获取当前运行中的应用进程。',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_mouse_position',
    description: '获取当前鼠标坐标。',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'perception.get_clipboard',
    description: '获取当前剪贴板内容。',
    inputSchema: emptyObjectSchema,
  },
];

export const EXECUTION_TOOLS: MCPToolDefinition[] = [
  {
    name: 'execution.click',
    description: '在指定屏幕坐标执行鼠标点击。',
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
  },
  {
    name: 'execution.type_text',
    description: '通过系统键盘输入文本。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'execution.press_key',
    description: '按下并释放单个按键。',
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
    name: 'execution.hotkey',
    description: '执行组合键。',
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
  },
  {
    name: 'execution.open_app',
    description: '打开指定应用。',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string' },
      },
      required: ['bundleId'],
      additionalProperties: false,
    },
  },
  {
    name: 'execution.close_app',
    description: '关闭指定应用。',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string' },
      },
      required: ['bundleId'],
      additionalProperties: false,
    },
  },
];

export const LEARNING_TOOLS: MCPToolDefinition[] = [
  {
    name: 'learning.get_patterns',
    description: '获取当前学习到的时间、操作和习惯模式。',
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'learning.get_prediction',
    description: '根据当前上下文获取下一步预测。',
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
    inputSchema: emptyObjectSchema,
  },
  {
    name: 'learning.set_feedback',
    description: '提交对预测结果的反馈。',
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
  },
  {
    name: 'config.set_privacy',
    description: '切换隐私模式或封禁应用。',
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
