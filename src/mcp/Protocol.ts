/**
 * MCP (Model Context Protocol) - Message Protocol Definitions
 * JSON-RPC inspired message format for Hermes Agent
 */

import { randomUUID } from 'crypto';

export const MCP_JSONRPC_VERSION = '2.0';
export const MCP_PROTOCOL_VERSION = '2026-04-22';

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

export interface MCPMessageMeta {
  priority?: 'high' | 'normal' | 'low';
  traceId?: string;
  origin?: string;
  capabilities?: string[];
}

export interface MCPMessage {
  jsonrpc: typeof MCP_JSONRPC_VERSION;
  protocolVersion: string;
  id: string | number | null;
  type: MessageType;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: MCPError;
  timestamp: number;
  meta?: MCPMessageMeta;
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

export function createRequest(
  method: string,
  params?: Record<string, unknown>,
  meta?: MCPMessageMeta,
): MCPRequest {
  return {
    jsonrpc: MCP_JSONRPC_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    id: randomUUID(),
    type: MessageType.Request,
    method,
    params,
    timestamp: Date.now(),
    meta,
  };
}

export function createResponse(
  id: MCPMessage['id'],
  result?: unknown,
  error?: MCPError,
  meta?: MCPMessageMeta,
): MCPResponse {
  return {
    jsonrpc: MCP_JSONRPC_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    id,
    type: MessageType.Response,
    result,
    error,
    timestamp: Date.now(),
    meta,
  };
}

export function createNotification(
  method: string,
  params?: Record<string, unknown>,
  meta?: MCPMessageMeta,
): MCPNotification {
  return {
    jsonrpc: MCP_JSONRPC_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    id: null,
    type: MessageType.Notification,
    method,
    params,
    timestamp: Date.now(),
    meta,
  };
}

export function isMCPRequest(message: MCPMessage): message is MCPRequest {
  return message.type === MessageType.Request && typeof message.method === 'string';
}

export function isMCPResponse(message: MCPMessage): message is MCPResponse {
  return message.type === MessageType.Response;
}

export function isMCPNotification(message: MCPMessage): message is MCPNotification {
  return message.type === MessageType.Notification && typeof message.method === 'string';
}

export function validateMCPMessage(value: unknown): { valid: boolean; message?: MCPMessage; errors: string[] } {
  if (typeof value !== 'object' || value === null) {
    return {
      valid: false,
      errors: ['Message must be an object'],
    };
  }

  const message = value as Partial<MCPMessage>;
  const errors: string[] = [];

  if (message.jsonrpc !== undefined && message.jsonrpc !== MCP_JSONRPC_VERSION) {
    errors.push(`Unsupported jsonrpc version: ${String(message.jsonrpc)}`);
  }

  if (message.protocolVersion !== undefined && typeof message.protocolVersion !== 'string') {
    errors.push('protocolVersion must be a string');
  }

  if (typeof message.id !== 'string' && typeof message.id !== 'number' && message.id !== null) {
    errors.push('id must be a string, number, or null');
  }

  if (!Object.values(MessageType).includes(message.type as MessageType)) {
    errors.push(`Invalid message type: ${String(message.type)}`);
  }

  if (typeof message.timestamp !== 'number') {
    errors.push('timestamp must be a number');
  }

  if ((message.type === MessageType.Request || message.type === MessageType.Notification) && typeof message.method !== 'string') {
    errors.push('method is required for request and notification messages');
  }

  return {
    valid: errors.length === 0,
    message: errors.length === 0 ? normalizeMCPMessage(message as MCPMessage) : undefined,
    errors,
  };
}

function normalizeMCPMessage(message: MCPMessage): MCPMessage {
  return {
    jsonrpc: message.jsonrpc ?? MCP_JSONRPC_VERSION,
    protocolVersion: message.protocolVersion ?? MCP_PROTOCOL_VERSION,
    id: message.id ?? null,
    type: message.type,
    method: message.method,
    params: message.params,
    result: message.result,
    error: message.error,
    timestamp: message.timestamp ?? Date.now(),
    meta: message.meta,
  };
}
