import type {
  DeviceView,
  HistoryResponse,
  PairResponse,
  Session,
  Voice,
  Workspace,
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

  async voices(): Promise<{voiceId: string | null; items: Voice[]}> {
    return this.json('/voices', {method: 'GET'});
  }

  async selectVoice(voiceId: string | null): Promise<{voiceId: string | null; items: Voice[]}> {
    return this.json('/voice', this.jsonRequest('PUT', {voiceId}));
  }

  async workspaces(): Promise<{workspaceId: string | null; items: Workspace[]}> {
    return this.json('/workspaces', {method: 'GET'});
  }

  async selectWorkspace(workspaceId: string): Promise<{workspaceId: string; sessionId: string | null; ready: boolean}> {
    return this.json('/workspace', this.jsonRequest('PUT', {workspaceId}));
  }

  async sessions(): Promise<{workspaceId: string; items: Session[]}> {
    return this.json('/sessions', {method: 'GET'});
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

  async turn(requestId: string, audio: Uint8Array, contentType: string): Promise<Response> {
    const response = await this.fetcher(this.url('/turns'), {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': contentType,
        'X-Request-Id': requestId,
      },
      body: audio,
    });
    if (!response.ok) throw await ApiError.fromResponse(response);
    return response;
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
    const response = await this.fetcher(this.url(path), {
      ...init,
      headers: {...(init.headers ?? {}), ...(auth ? this.authHeaders() : {})},
    });
    if (!response.ok) throw await ApiError.fromResponse(response);
    return response.json() as Promise<T>;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? {Authorization: `Bearer ${this.token}`} : {};
  }

  private url(path: string): string {
    return `${this.origin.replace(/\/+$/, '')}${apiPath}${path}`;
  }
}
