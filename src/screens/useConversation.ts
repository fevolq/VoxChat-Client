import {useEffect, useRef, useState} from 'react';
import {AppState, Linking} from 'react-native';
import {VoxChatClient} from '../core/api/VoxChatClient';
import {ApiError} from '../core/api/errors';
import {parsePairingLink} from '../core/api/pairing';
import type {DeviceView, HistoryResponse, Session, TurnEnvelope} from '../core/api/types';
import {detectSpeech, newListeningState} from '../core/turn/listening';
import {device, microphonePermission, scanPairingCode, subscribeDevice, type Credentials} from '../platform/device';

export type Stage = 'idle' | 'stopping' | 'starting' | 'recording' | 'uploading' | 'asr' | 'dsh' | 'summary' | 'tts' | 'playing';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function useConversation() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [view, setView] = useState<DeviceView | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [continuous, setContinuous] = useState(false);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [speech, setSpeech] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settings, setSettings] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [server, setServer] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    if (!settings || !credentials) setCopied(false);
    return () => { if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, [settings, credentials]);
  const live = useRef({credentials, view, stage, continuous, pending});
  live.current = {credentials, view, stage, continuous, pending};
  const active = useRef<string | null>(null);
  const generation = useRef(0);
  const pressed = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const foreground = useRef(true);
  const vad = useRef(newListeningState(Date.now()));
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  const api = (value = live.current.credentials) => {
    if (!value) throw new Error('请先在设置中配对设备');
    return new VoxChatClient(value.server, value.token);
  };
  function setPhase(value: Stage) { live.current.stage = value; setStage(value); }
  function setListening(value: boolean) { live.current.continuous = value; setContinuous(value); }
  function clearResume() { if (resume.current) clearTimeout(resume.current); resume.current = null; }
  async function stop() {
    const epoch = ++generation.current; clearResume(); pressed.current = false; setListening(false);
    const request = active.current; active.current = null;
    if (request && live.current.credentials) void api().cancel(request).catch(() => {});
    setPhase('stopping'); setLevel(0); setNotice('');
    try { await device?.cancel(); } finally { if (epoch === generation.current && mounted.current) setPhase('idle'); }
  }
  async function report(problem: unknown) {
    setError(message(problem)); setListening(false);
    if (problem instanceof ApiError && problem.status === 401) {
      stop(); await device.saveCredentials(null); setCredentials(null); live.current.credentials = null; setView(null);
    } else if (problem instanceof ApiError && [403, 404, 422].includes(problem.status)) {
      try { const next = await api().me(); setView(next); live.current.view = next; } catch {}
    }
  }
  async function refresh(value = live.current.credentials) {
    const client = api(value); const status = await client.status();
    if (status.protocol !== 2) throw new Error('插件协议版本不兼容，请更新 VoxChat 插件');
    const next = await client.me();
    setView(next); live.current.view = next;
    setSessions(next.workspaceId ? (await client.sessions()).items : []);
  }
  async function action(work: () => Promise<void>) {
    if (busy.current || live.current.stage !== 'idle') return;
    busy.current = true; setPending(true); setError('');
    try { await work(); } catch (e) { await report(e); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function pair() {
    await action(async () => {
      const value = server.startsWith('voxchat:') ? parsePairingLink(server.trim()) : parsePairingLink(`voxchat://pair?server=${encodeURIComponent(server.trim())}&code=${encodeURIComponent(code.trim())}`);
      const client = new VoxChatClient(value.server); const status = await client.status();
      if (status.protocol !== 2) throw new Error('插件协议版本不兼容');
      const paired = await client.pair(value.code);
      const saved = {server: value.server, token: paired.token, deviceId: paired.deviceId};
      await device.saveCredentials(JSON.stringify(saved)); setCredentials(saved); live.current.credentials = saved;
      setServer(value.server); setCode(''); await refresh(saved); setNotice('');
    });
  }
  async function refreshSettings() {
    await action(async () => {
      setRefreshing(true);
      try { await refresh(); } finally { if (mounted.current) setRefreshing(false); }
    });
  }
  async function copyAddress() {
    const address = live.current.credentials?.server;
    if (!address) return;
    try {
      await device.copyText(address);
      if (!mounted.current || live.current.credentials?.server !== address) return;
      if (copyTimer.current) clearTimeout(copyTimer.current);
      setCopied(true);
      copyTimer.current = setTimeout(() => { setCopied(false); copyTimer.current = null; }, 2000);
    } catch (e) { if (mounted.current) setError(message(e)); }
  }
  async function scan() {
    await action(async () => {
      setNotice('');
      const contents = await scanPairingCode();
      if (!contents || !mounted.current) return;
      const value = parsePairingLink(contents.trim());
      setServer(value.server); setCode(value.code);
      setNotice('');
    });
  }
  async function choose(kind: 'workspace' | 'session' | 'voice' | 'new', id = '') {
    await action(async () => {
      const client = api();
      if (kind === 'workspace') await client.selectWorkspace(id);
      if (kind === 'session') await client.selectSession(id);
      if (kind === 'voice') await client.selectVoice(id || null);
      if (kind === 'new') {
        try { await client.createSession(); } catch (e) {
          if (e instanceof ApiError && [404, 405].includes(e.status)) throw new Error('请先更新电脑上的 VoxChat 插件，以启用新建会话');
          throw e;
        }
      }
      if (kind !== 'voice') { setTranscript(''); setSpeech(''); setHistory(null); }
      await refresh();
      if (kind === 'session' || kind === 'new') setSettings(false);
    });
  }
  async function loadHistory(older = false) {
    if (!live.current.credentials || !live.current.view) return;
    await action(async () => {
      const sessionId = live.current.view?.sessionId;
      if (!sessionId) { setHistory(null); return; }
      const page = await api().history(sessionId, older ? history?.before ?? undefined : undefined);
      setHistory(previous => older && previous?.sessionId === page.sessionId ? {...page, items: [...page.items, ...previous.items]} : page);
    });
  }
  function scheduleListening() {
    clearResume();
    if (live.current.continuous && foreground.current) resume.current = setTimeout(() => { void start(true); }, 450);
  }
  async function finish(send = true) {
    if (live.current.stage !== 'recording') return;
    const epoch = generation.current; setPhase('uploading');
    try {
      const recording = await device.stopRecording();
      if (epoch !== generation.current) { device.discardRecording(recording.path); return; }
      if (!send || recording.durationMs < 350) {
        device.discardRecording(recording.path); setPhase('idle');
        if (send && !live.current.continuous) setNotice('说话时间太短，请按住按钮后再说话');
        scheduleListening(); return;
      }
      const saved = live.current.credentials!;
      const requestId = `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      active.current = requestId; setNotice('');
      await device.submitTurn(saved.server, saved.token, requestId, recording.path);
      if (epoch !== generation.current) return;
      active.current = null; setPhase('idle'); setLevel(0); scheduleListening();
    } catch (e) {
      if (epoch !== generation.current) return;
      active.current = null; setPhase('idle'); setLevel(0); await report(e);
    }
  }
  async function start(auto = false) {
    if (live.current.stage !== 'idle' || busy.current || !foreground.current) return;
    const selected = live.current.view;
    if (!live.current.credentials || !selected) return;
    if (!selected.workspaceId || !selected.sessionId) {
      setError(!selected.workspaceId ? '请先选择工作区' : '请先选择会话'); setSettings(true); setListening(false); return;
    }
    // The server owns voice defaults and provider readiness; validate them when submitting the turn.
    const epoch = generation.current; setPhase('starting'); setError(''); setNotice('');
    try {
      await microphonePermission();
      if (epoch !== generation.current) return;
      if (!auto && !pressed.current && !live.current.continuous) { setPhase('idle'); return; }
      await device.startRecording();
      if (epoch !== generation.current) { device.cancelAll(); return; }
      vad.current = newListeningState(Date.now()); setTranscript(''); setPhase('recording');
      if (!auto && !pressed.current && !live.current.continuous) await finish();
    } catch (e) { if (epoch === generation.current) { setPhase('idle'); await report(e); } }
  }
  function press() {
    if (live.current.continuous || (live.current.stage !== 'idle' && live.current.stage !== 'starting')) { stop(); return; }
    pressed.current = true; void start();
  }
  function release() { pressed.current = false; if (!live.current.continuous) void finish(); }
  function lock() { if (['starting', 'recording'].includes(live.current.stage)) { setListening(true); setNotice('持续监听已开启，停顿后自动发送'); } }
  async function openSettings() { await stop(); setSettings(true); if (live.current.credentials) void action(() => refresh()); }
  async function openHistory() {
    if (!live.current.credentials || !live.current.view) return;
    await stop(); setHistoryOpen(true); void loadHistory();
  }
  useEffect(() => {
    const sub = subscribeDevice(event => {
      if (event.type === 'level' && live.current.stage === 'recording') {
        const data = JSON.parse(event.value) as {level: number}; setLevel(Math.min(1, data.level * 12));
        if (live.current.continuous) {
          const result = detectSpeech(vad.current, data.level, Date.now()); vad.current = result.state;
          if (result.action !== 'wait') void finish(result.action === 'send');
        }
      }
      if (event.type === 'recordLimit') void finish();
      if (event.type === 'recordError') { stop(); setError(event.value); }
      if (event.type === 'interrupted') { stop(); setNotice(event.value); }
      if (event.requestId && event.requestId !== active.current) return;
      if (event.type === 'playing') setPhase('playing');
      if (event.type === 'unauthorized') {
        stop(); void device.saveCredentials(null); setCredentials(null); live.current.credentials = null; setView(null); setError('设备凭证已失效，请重新配对');
      }
      if (event.type === 'frame') {
        const frame = JSON.parse(event.value) as TurnEnvelope;
        if (frame.type === 'phase' && ['asr', 'dsh', 'summary', 'tts'].includes(String(frame.data?.phase))) setPhase(frame.data!.phase as Stage);
        if (frame.type === 'transcript') setTranscript(String(frame.data?.text ?? ''));
        if (frame.type === 'speech.text') setSpeech(String(frame.data?.text ?? ''));
      }
    });
    const app = AppState.addEventListener('change', next => { foreground.current = next === 'active'; if (!foreground.current) stop(); });
    const receiveLink = (url: string) => {
      if (!url.startsWith('voxchat:')) return;
      try { const value = parsePairingLink(url); stop(); setServer(value.server); setCode(value.code); setSettings(true); setNotice(''); } catch (e) { setError(message(e)); }
    };
    const links = Linking.addEventListener('url', event => receiveLink(event.url));
    void (async () => {
      try {
        const value = await device.readCredentials();
        if (!mounted.current) return;
        if (value) { const saved = JSON.parse(value) as Credentials; setCredentials(saved); live.current.credentials = saved; setServer(saved.server); await refresh(saved); }
      } catch (e) { await report(e); }
      const url = await Linking.getInitialURL(); if (url) receiveLink(url);
    })();
    return () => { mounted.current = false; generation.current++; clearResume(); device.cancelAll(); sub.remove(); app.remove(); links.remove(); };
    // Native listeners read mutable current state; they are registered only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {credentials, view, sessions, history, stage, continuous, level, transcript, speech, error, notice, pending, refreshing, copied,
    settings, setSettings, historyOpen, setHistoryOpen, server, setServer, code, setCode,
    pair, scan, choose, refresh: refreshSettings, loadHistory, press, release, lock, stop, openSettings, openHistory, copyAddress,
    disconnect: () => action(async () => { await device.saveCredentials(null); live.current.credentials = null; live.current.view = null; setCredentials(null); setView(null); setSessions([]); setHistory(null); setTranscript(''); setSpeech(''); setServer(''); setCode(''); setNotice(''); setHistoryOpen(false); }),
  };
}
