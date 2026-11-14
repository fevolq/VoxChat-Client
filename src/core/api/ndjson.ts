import type {TurnEnvelope} from './types';

export async function* decodeNdjson(
  chunks: AsyncIterable<Uint8Array | ArrayBuffer | string>,
): AsyncGenerator<TurnEnvelope> {
  const decoder = new TextDecoder();
  let buffer = '';
  let expectedSeq = 0;
  let requestId: string | null = null;
  let expectedAudioIndex = 0;

  for await (const chunk of chunks) {
    if (typeof chunk === 'string') buffer += chunk;
    else buffer += decoder.decode(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk, {stream: true});

    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield acceptFrame(parseFrame(line));
    }
  }

  buffer += decoder.decode();
  const trailing = buffer.trim();
  if (trailing) yield acceptFrame(parseFrame(trailing));

  function acceptFrame(frame: TurnEnvelope): TurnEnvelope {
    if (requestId === null) requestId = frame.requestId;
    if (frame.requestId !== requestId) throw new Error('VoxChat 流响应混入了其他请求');
    if (frame.seq !== expectedSeq) throw new Error('VoxChat 流响应序号不连续');
    if (frame.type === 'audio.chunk') {
      const index = frame.data?.index;
      if (index !== expectedAudioIndex) throw new Error('VoxChat 音频块序号不连续');
      expectedAudioIndex++;
    }
    expectedSeq++;
    return frame;
  }
}

function parseFrame(line: string): TurnEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('VoxChat 流响应包含无效 JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('VoxChat 流响应帧必须是对象');
  }
  const frame = value as Partial<TurnEnvelope>;
  if (frame.protocol !== 2 || typeof frame.requestId !== 'string' || typeof frame.type !== 'string'
    || typeof frame.seq !== 'number') {
    throw new Error('VoxChat 流响应帧缺少公共字段');
  }
  return frame as TurnEnvelope;
}
