import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

interface StatePayload {
  state: string;
  previousState?: string;
  ui?: Record<string, unknown>;
  timestamp?: number;
}

interface MessagePayload {
  id: string | number | null;
  type: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: Record<string, unknown>;
  timestamp: number;
}

interface ChatMessagePayload {
  text: string;
  speaker?: string;
  timestamp?: number;
}

type StateCallback = (payload: StatePayload) => void;
type MessageCallback = (payload: MessagePayload) => void;
type ChatMessageCallback = (payload: ChatMessagePayload) => void;

const wrapListener = <TPayload>(channel: string, callback: (payload: TPayload) => void): (() => void) => {
  const listener = (_event: IpcRendererEvent, payload: TPayload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const wrapSignalListener = (channel: string, callback: () => void): (() => void) => {
  const listener = () => callback();
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const hermesApi = {
  perception: {
    captureScreen: () => ipcRenderer.invoke('perception:captureScreen'),
    getWindows: () => ipcRenderer.invoke('perception:getWindows'),
    getRunningApps: () => ipcRenderer.invoke('perception:getRunningApps'),
    getClipboard: () => ipcRenderer.invoke('perception:getClipboard'),
  },

  execution: {
    click: (x: number, y: number, button?: string) => ipcRenderer.invoke('execution:click', x, y, button),
    typeText: (text: string) => ipcRenderer.invoke('execution:typeText', text),
    pressKey: (key: string) => ipcRenderer.invoke('execution:pressKey', key),
    hotkey: (...keys: string[]) => ipcRenderer.invoke('execution:hotkey', keys),
    openApp: (bundleId: string) => ipcRenderer.invoke('execution:openApp', bundleId),
    closeApp: (bundleId: string) => ipcRenderer.invoke('execution:closeApp', bundleId),
  },

  state: {
    getCurrent: () => ipcRenderer.invoke('state:getCurrent'),
    onStateChange: (callback: StateCallback) => wrapListener('state:changed', callback),
  },

  learning: {
    getProfile: () => ipcRenderer.invoke('learning:getProfile'),
    getPatterns: () => ipcRenderer.invoke('learning:getPatterns'),
    setFeedback: (predictionId: string, correct: boolean) => ipcRenderer.invoke('learning:setFeedback', predictionId, correct),
  },

  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value),
  },

  security: {
    checkOperation: (operation: string, source: string) => ipcRenderer.invoke('security:check', operation, source),
  },

  sendChatMessage: (text: string) => ipcRenderer.send('chat:send', text),

  chat: {
    send: (text: string) => ipcRenderer.send('chat:send', text),
    onMessage: (callback: ChatMessageCallback) => wrapListener('chat:message', callback),
    onFocusRequest: (callback: () => void) => wrapSignalListener('chat:focus-input', callback),
  },

  mcp: {
    connect: (url: string) => ipcRenderer.invoke('mcp:connect', url),
    disconnect: () => ipcRenderer.invoke('mcp:disconnect'),
    send: (message: unknown) => ipcRenderer.invoke('mcp:send', message),
    onMessage: (callback: MessageCallback) => wrapListener('mcp:message', callback),
  },
};

contextBridge.exposeInMainWorld('hermes', hermesApi);

declare global {
  interface Window {
    hermes: typeof hermesApi;
  }
}
