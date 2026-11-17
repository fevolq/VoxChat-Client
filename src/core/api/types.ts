export type ProtocolVersion = 2;

// Client-owned choices. A missing session starts a new conversation on the next turn.
export interface Selection {
  workspaceId: string | null;
  sessionId: string | null;
  voiceId: string | null;
}
export interface TurnOptions extends Selection { workspaceId: string }

export interface PairResponse {
  deviceId: string;
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

export interface Workspace {
  id: string;
  title: string;
  path: string;
}

export interface Session {
  sessionId: string;
  projections?: {values: {title?: string | null}};
}

export interface HistoryItem {seq: number; type: string; data: Record<string, unknown>}

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
  voices: Voice[];
  workspaces: Workspace[];
}

export interface TurnEnvelope {
  protocol: ProtocolVersion;
  requestId: string;
  workspaceId: string;
  sessionId: string;
  seq: number;
  type: string;
  data?: Record<string, unknown>;
  error?: {code: string; message: string};
}
