import type {
  DeviceView,
  HistoryResponse,
  PairResponse,
  Session,
  Voice,
  Readiness,
} from './types';
import {ApiError} from './errors';

const apiPath = '/voxchat/api';

export class VoxChatClient {
  constructor(
    private readonly origin: string,
    private readonly token: string | null = null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async status(): Promise<{name: string; protocol: 2; status: string}> {
    return this.json('/status', {method: 'GET'}, false);
  }

  async pair(code: string): Promise<PairResponse> {
    return this.json('/pair', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code}),
    }, false);
  }

  async me(): Promise<DeviceView> {
    return this.json('/me', {method: 'GET'});
  }

  async selectVoice(voiceId: string | null): Promise<{voiceId: string | null; items: Voice[]}> {
    return this.json('/voice', this.jsonRequest('PUT', {voiceId}));
  }

  async selectWorkspace(workspaceId: string): Promise<{workspaceId: string; sessionId: string | null; ready: Readiness}> {
    return this.json('/workspace', this.jsonRequest('PUT', {workspaceId}));
  }

  async sessions(): Promise<{workspaceId: string; items: Session[]}> {
    return this.json('/sessions', {method: 'GET'});
  }
  async createSession(): Promise<{workspaceId: string; sessionId: string}> {
    return this.json('/sessions', this.jsonRequest('POST', {}));
  }

  async history(sessionId: string, before?: number, limit = 100): Promise<HistoryResponse> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('历史记录数量应为 1–500');
    if (before !== undefined && (!Number.isInteger(before) || before < 0)) throw new Error('历史记录游标无效');
    const query = new URLSearchParams({limit: String(limit)});
    if (before !== undefined) query.set('before', String(before));
    return this.json(`/sessions/${encodeURIComponent(sessionId)}/history?${query.toString()}`, {method: 'GET'});
  }

  async selectSession(sessionId: string): Promise<{workspaceId: string; sessionId: string}> {
    return this.json('/session', this.jsonRequest('PUT', {sessionId}));
  }

  async cancel(requestId: string): Promise<void> {
    await this.json(`/turns/${encodeURIComponent(requestId)}`, {method: 'DELETE'});
  }

  private jsonRequest(method: string, value: unknown): RequestInit {
    return {
      method,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(value),
    };
  }

  private async json<T>(path: string, init: RequestInit, auth = true): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.fetcher(this.url(path), {
        ...init, signal: controller.signal,
        headers: {...(init.headers ?? {}), ...(auth ? this.authHeaders() : {})},
      });
      if (!response.ok) throw await ApiError.fromResponse(response);
      return await response.json() as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('连接超时，请检查地址和网络；已提交的操作请先刷新状态');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  private authHeaders(): Record<string, string> {
    return this.token ? {Authorization: `Bearer ${this.token}`} : {};
  }

  private url(path: string): string {
    return `${this.origin.replace(/\/+$/, '')}${apiPath}${path}`;
  }
}
