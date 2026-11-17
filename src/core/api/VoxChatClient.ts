import type {
  DeviceView,
  HistoryResponse,
  PairResponse,
  Session,
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

  async sessions(workspaceId: string): Promise<{workspaceId: string; items: Session[]}> {
    return this.json(`/sessions?${new URLSearchParams({workspaceId}).toString()}`, {method: 'GET'});
  }

  async history(workspaceId: string, sessionId: string, before?: number, limit = 100): Promise<HistoryResponse> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('历史记录数量应为 1–500');
    if (before !== undefined && (!Number.isInteger(before) || before < 0)) throw new Error('历史记录游标无效');
    const query = new URLSearchParams({workspaceId, limit: String(limit)});
    if (before !== undefined) query.set('before', String(before));
    return this.json(`/sessions/${encodeURIComponent(sessionId)}/history?${query.toString()}`, {method: 'GET'});
  }

  async cancel(requestId: string): Promise<void> {
    await this.json(`/turns/${encodeURIComponent(requestId)}`, {method: 'DELETE'});
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
