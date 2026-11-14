import type {TurnEnvelope} from '../api/types';

interface TurnSnapshot {
  requestId: string;
  phase: string | null;
  transcript: string | null;
  reply: string | null;
  speechText: string | null;
  audioChunks: number;
}

export type TurnState =
  | {status: 'idle'}
  | ({status: 'running'} & TurnSnapshot)
  | ({status: 'complete'} & TurnSnapshot)
  | ({status: 'failed'; code: string; message: string} & TurnSnapshot);

export const initialTurnState: TurnState = {status: 'idle'};

export function reduceTurn(state: TurnState, frame: TurnEnvelope): TurnState {
  const current: TurnSnapshot = state.status === 'idle'
    ? {requestId: frame.requestId, phase: null, transcript: null, reply: null, speechText: null, audioChunks: 0}
    : state;
  if (current.requestId !== frame.requestId) throw new Error('VoxChat 轮次混入了其他请求');

  if (frame.type === 'error') {
    return {
      status: 'failed',
      ...current,
      code: frame.error?.code ?? 'TURN_FAILED',
      message: frame.error?.message ?? '语音请求失败',
    };
  }

  const running = {status: 'running' as const, ...current};

  if (frame.type === 'complete') {
    return {status: 'complete', ...current};
  }
  if (frame.type === 'phase') return {...running, phase: String(frame.data?.phase ?? '')};
  if (frame.type === 'transcript') return {...running, transcript: String(frame.data?.text ?? '')};
  if (frame.type === 'reply') return {...running, reply: String(frame.data?.text ?? '')};
  if (frame.type === 'speech.text') return {...running, speechText: String(frame.data?.text ?? '')};
  if (frame.type === 'audio.chunk') return {...running, audioChunks: running.audioChunks + 1};
  return running;
}
