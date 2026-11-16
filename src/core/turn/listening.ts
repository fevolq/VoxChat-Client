export interface ListeningState {startedAt: number; lastVoiceAt: number; voicedMs: number; lastSampleAt: number; noise: number}
export function newListeningState(now: number): ListeningState {
  return {startedAt: now, lastVoiceAt: now, voicedMs: 0, lastSampleAt: now, noise: 0.003};
}
/** Require sustained speech before allowing silence to submit a turn. */
export function detectSpeech(state: ListeningState, level: number, now: number): {state: ListeningState; action: 'wait' | 'send' | 'empty'} {
  const elapsed = Math.max(0, Math.min(200, now - state.lastSampleAt));
  const voiced = level > Math.max(0.012, state.noise * 3);
  const next = {...state, lastSampleAt: now,
    lastVoiceAt: voiced ? now : state.lastVoiceAt,
    voicedMs: state.voicedMs + (voiced ? elapsed : 0),
    noise: voiced ? state.noise : state.noise * 0.95 + level * 0.05};
  if (next.voicedMs >= 250 && (now - next.lastVoiceAt >= 1200 || now - state.startedAt >= 60000)) return {state: next, action: 'send'};
  if (now - state.startedAt >= 60000) return {state: next, action: 'empty'};
  return {state: next, action: 'wait'};
}
