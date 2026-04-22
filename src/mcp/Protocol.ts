/**
 * MCP (Model Context Protocol) - Message Protocol Definitions
 * JSON-RPC style message types for Hermes Agent
 */

export enum MessageType {
  Request = 'request',
  Response = 'response',
  Notification = 'notification',
}

export enum MCPErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000,
}

export interface MCPError {
  code: MCPErrorCode;
  message: string;
  data?: unknown;
}

export interface MCPMessage {
  id: string | number | null;
  type: MessageType;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: MCPError;
  timestamp: number;
}

export interface MCPRequest extends MCPMessage {
  type: MessageType.Request;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse extends MCPMessage {
  type: MessageType.Response;
  result?: unknown;
  error?: MCPError;
}

export interface MCPNotification extends MCPMessage {
  type: MessageType.Notification;
  method: string;
  params?: Record<string, unknown>;
}
