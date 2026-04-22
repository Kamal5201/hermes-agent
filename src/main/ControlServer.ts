import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { getLogger } from './logger';

export interface ControlInboxMessage {
  type: string;
  text: string;
  timestamp: number;
}

export interface ControlServerApp {
  popInbox(): ControlInboxMessage[];
  handleControlCommand(action: string, params?: Record<string, unknown>): Promise<unknown>;
}

type CommandRequest = {
  action?: unknown;
  params?: unknown;
};

export class ControlServer {
  private readonly logger = getLogger('ControlServer');
  private server: Server | null = null;

  constructor(
    private readonly app: ControlServerApp,
    private readonly port = 29371,
    private readonly host = '127.0.0.1',
  ) {}

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, this.host);
    });

    this.server = server;
    this.logger.info(`Control server listening on http://${this.host}:${this.port}`);
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.isLocalRequest(req)) {
        this.writeJson(res, 403, { error: 'Forbidden' });
        return;
      }

      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);

      if (method === 'GET' && url.pathname === '/health') {
        this.writeText(res, 200, 'OK');
        return;
      }

      if (method === 'GET' && url.pathname === '/inbox') {
        this.writeJson(res, 200, { messages: this.app.popInbox() });
        return;
      }

      if (method === 'POST' && url.pathname === '/command') {
        const payload = await this.readJsonBody(req);
        const action = typeof payload.action === 'string' ? payload.action.trim() : '';

        if (!action) {
          this.writeJson(res, 400, { error: 'Missing command action' });
          return;
        }

        const params = this.isRecord(payload.params) ? payload.params : {};
        const result = await this.app.handleControlCommand(action, params);
        this.writeJson(res, 200, { ok: true, action, result });
        return;
      }

      if ((method === 'GET' || method === 'POST') && (url.pathname === '/health' || url.pathname === '/inbox' || url.pathname === '/command')) {
        this.writeJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      this.writeJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Control server request failed', error);
      this.writeJson(res, 500, { error: message });
    }
  }

  private async readJsonBody(req: IncomingMessage): Promise<CommandRequest> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of req) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      chunks.push(buffer);
      totalBytes += buffer.length;

      if (totalBytes > 1_000_000) {
        throw new Error('Request body too large');
      }
    }

    if (chunks.length === 0) {
      return {};
    }

    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as CommandRequest;
    } catch (error) {
      throw new Error(
        error instanceof Error ? `Invalid JSON body: ${error.message}` : 'Invalid JSON body',
      );
    }
  }

  private isLocalRequest(req: IncomingMessage): boolean {
    const remoteAddress = req.socket.remoteAddress;
    return remoteAddress === '127.0.0.1'
      || remoteAddress === '::1'
      || remoteAddress === '::ffff:127.0.0.1';
  }

  private writeJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
  }

  private writeText(res: ServerResponse, statusCode: number, body: string): void {
    res.writeHead(statusCode, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}

export default ControlServer;
