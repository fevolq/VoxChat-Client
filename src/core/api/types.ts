export type ProtocolVersion = 2;

export interface PairResponse {
  deviceId: string;
  workspaceId: string | null;
  workspaceIds: string[];
  token: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface Voice {
  id: string;
  name: string;
  value: string;
}

export interface Readiness {
  asr: boolean;
  tts: boolean;
  summary: 'configured' | 'session';
}

export interface Workspace {
  id: string;
  title: string;
  path: string;
  sessionId: string | null;
  ready: Readiness;
}

export interface Session {
  sessionId: string;
  updatedAt?: string | number;
  running?: boolean;
  blank?: boolean;
  projections?: unknown;
}

export type HistoryItem = Record<string, unknown>;

export interface HistoryResponse {
  workspaceId: string;
  sessionId: string;
  items: HistoryItem[];
  hasMore: boolean;
  before: number | null;
}

export interface DeviceView {
  protocol: ProtocolVersion;
  deviceId: string;
  name: string;
  voiceId: string | null;
  voices: Voice[];
  workspaceId: string | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  sessionId: string | null;
  ready: Readiness;
}

export interface TurnEnvelope {
  protocol: ProtocolVersion;
  requestId: string;
  workspaceId: string;
  sessionId: string;
  seq: number;
  type: string;
  phase?: string;
  data?: Record<string, unknown>;
  error?: {code: string; message: string};
}
