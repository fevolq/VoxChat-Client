export interface SecureStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AudioRecorder {
  start(): Promise<void>;
  stop(): Promise<{bytes: Uint8Array; contentType: string}>;
  cancel(): Promise<void>;
}

export interface AudioPlayer {
  start(format: string, mime: string, metadata?: Record<string, unknown>): Promise<void>;
  append(bytes: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
}

export interface QrScanner {
  scan(): Promise<string>;
}
