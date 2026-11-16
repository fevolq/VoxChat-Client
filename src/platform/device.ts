import {NativeEventEmitter, NativeModules, PermissionsAndroid, Platform} from 'react-native';

export interface Credentials {server: string; token: string; deviceId: string}
interface DeviceNative {
  readCredentials(): Promise<string | null>;
  saveCredentials(value: string | null): Promise<void>;
  copyText(value: string): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<{path: string; durationMs: number}>;
  discardRecording(path: string): void;
  submitTurn(server: string, token: string, id: string, path: string): Promise<void>;
  cancelAll(): void;
  cancel(): Promise<void>;
}
export interface DeviceEvent {type: string; value: string; requestId?: string}
const native = NativeModules.VoiceDevice;
export const device = native as DeviceNative;
export async function scanPairingCode(): Promise<string | null> {
  if (Platform.OS !== 'android' || !NativeModules.QrScanner) throw new Error('当前设备暂不支持相机扫码，请手动输入配对信息');
  const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (!await PermissionsAndroid.check(permission)) {
    const result = await PermissionsAndroid.request(permission, {title: '允许 VoxChat 使用相机', message: '用于扫描电脑端的设备配对二维码。', buttonPositive: '继续', buttonNegative: '取消'});
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('需要相机权限；请在系统设置中允许 VoxChat 使用相机');
  }
  return NativeModules.QrScanner.scan();
}
export function subscribeDevice(callback: (event: DeviceEvent) => void) {
  return new NativeEventEmitter(native).addListener('VoxChatDevice', event => callback(event as DeviceEvent));
}
export async function microphonePermission() {
  if (Platform.OS !== 'android' || !native) throw new Error('当前版本的语音功能需要 Android 设备');
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) return;
  const result = await PermissionsAndroid.request(permission, {title: '允许 VoxChat 使用麦克风', message: '按住说话或开启持续监听时，需要录制你的声音。', buttonPositive: '继续', buttonNegative: '取消'});
  if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('需要麦克风权限；请在系统设置中允许 VoxChat 录音');
}
