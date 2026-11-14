import type {ApiErrorBody} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = await response.json() as Partial<ApiErrorBody>;
    } catch {
      // Keep the status when the server did not return the documented JSON body.
    }
    return new ApiError(
      response.status,
      body.error?.code ?? 'HTTP_ERROR',
      body.error?.message ?? `VoxChat 请求失败（HTTP ${response.status}）`,
    );
  }
}
