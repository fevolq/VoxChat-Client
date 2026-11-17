import {useEffect, useRef, useState} from 'react';
import {AppState, Linking} from 'react-native';
import {VoxChatClient} from '../core/api/VoxChatClient';
import {ApiError} from '../core/api/errors';
import {parsePairingLink} from '../core/api/pairing';
import type {DeviceView, HistoryResponse, Selection, Session, TurnEnvelope, TurnOptions} from '../core/api/types';
import {detectSpeech, newListeningState} from '../core/turn/listening';
import {device, microphonePermission, scanPairingCode, subscribeDevice, type Credentials} from '../platform/device';

export type Stage = 'idle' | 'stopping' | 'starting' | 'recording' | 'uploading' | 'asr' | 'dsh' | 'summary' | 'tts' | 'playing';
export type ConnectionState = 'connecting' | 'unpaired' | 'failed' | 'connected';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function useConversation() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [view, setView] = useState<DeviceView | null>(null);
  const [selection, setSelection] = useState<Selection>({workspaceId: null, sessionId: null, voiceId: null});
  const recordingSelection = useRef<TurnOptions | null>(null);
  const [connection, setConnectionState] = useState<ConnectionState>('connecting');
  const connectionEpoch = useRef(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [continuous, setContinuous] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [speech, setSpeech] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
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
  const live = useRef({credentials, view, selection, connection, stage, continuous, pending});
  live.current = {credentials, view, selection, connection, stage, continuous, pending};
  const active = useRef<string | null>(null);
  const stopping = useRef<Promise<void> | null>(null);
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
  function setConnection(value: ConnectionState) { live.current.connection = value; setConnectionState(value); }
  function updateSelection(value: Selection) {
    const previous = live.current.selection;
    live.current.selection = value; setSelection(value);
    const saved = live.current.credentials;
    if (!saved || (previous.workspaceId === value.workspaceId && previous.sessionId === value.sessionId && previous.voiceId === value.voiceId)) return;
    void device.saveCredentials(JSON.stringify({...saved, selection: value})).catch(e => {
      if (mounted.current && live.current.credentials?.token === saved.token) setError(`无法保存本机配置：${message(e)}`);
    });
  }
  function clearConnection() {
    connectionEpoch.current++;
    live.current.credentials = null; live.current.view = null;
    setCredentials(null); setView(null); setSessions([]); setHistory(null);
    updateSelection({workspaceId: null, sessionId: null, voiceId: null});
    setConnection('unpaired');
  }
  function setListening(value: boolean) { live.current.continuous = value; setContinuous(value); }
  function clearResume() { if (resume.current) clearTimeout(resume.current); resume.current = null; }
  async function stop() {
    if (stopping.current) return stopping.current;
    const epoch = ++generation.current; clearResume(); pressed.current = false; setListening(false);
    const request = active.current; active.current = null;
    if (request && live.current.credentials) void api().cancel(request).catch(() => {});
    setNotice('');
    if (live.current.stage === 'idle' && !request) return;
    setPhase('stopping');
    const task = (async () => {
      try {
        await device.cancel();
        if (epoch === generation.current && mounted.current) setPhase('idle');
      } catch (e) {
        if (mounted.current) setError(message(e));
      } finally { stopping.current = null; }
    })();
    stopping.current = task;
    return task;
  }
  async function report(problem: unknown) {
    setError(message(problem)); setListening(false);
    const code = problem && typeof problem === 'object' && 'code' in problem ? problem.code : undefined;
    if ((problem instanceof ApiError && problem.status === 401) || code === 'UNAUTHORIZED' || code === 'DEVICE_REVOKED') {
      await stop(); clearConnection(); await device.saveCredentials(null);
    }
  }
  async function loadSessions(workspaceId: string) {
    const token = live.current.credentials?.token;
    const result = await api().sessions(workspaceId);
    if (!mounted.current || token !== live.current.credentials?.token || workspaceId !== live.current.selection.workspaceId) return;
    if (result.workspaceId !== workspaceId) throw new Error('服务端返回的会话列表与所选工作区不匹配');
    setSessions(result.items);
  }
  async function refresh(value = live.current.credentials) {
    if (!value) { setConnection('unpaired'); return; }
    const epoch = ++connectionEpoch.current;
    const current = () => mounted.current && epoch === connectionEpoch.current && value.token === live.current.credentials?.token;
    setConnection('connecting');
    const client = api(value);
    let next: DeviceView;
    try {
      const status = await client.status();
      if (!current()) return;
      if (status.protocol !== 2) throw new Error('插件协议版本不兼容，请更新 VoxChat 插件');
      next = await client.me();
      if (!current()) return;
      setView(next); live.current.view = next; setConnection('connected');
      const selected = live.current.selection;
      const workspaceId = next.workspaces.some(item => item.id === selected.workspaceId) ? selected.workspaceId : null;
      updateSelection({workspaceId, sessionId: workspaceId ? selected.sessionId : null,
        voiceId: next.voices.some(item => item.id === selected.voiceId) ? selected.voiceId : null});
      if (workspaceId !== selected.workspaceId) {
        setSessions([]); setHistory(null); setError('所选工作区已不可用，请重新选择');
      }
    } catch (e) {
      if (!current()) return;
      setConnection('failed'); throw e;
    }
    // Session-list errors do not invalidate a successful device authentication.
    try {
      const workspaceId = live.current.selection.workspaceId;
      if (workspaceId) await loadSessions(workspaceId);
    } catch (e) { if (current()) throw e; }
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
      connectionEpoch.current++;
      setConnection('connecting');
      try {
        const client = new VoxChatClient(value.server); const status = await client.status();
        if (status.protocol !== 2) throw new Error('插件协议版本不兼容');
        const paired = await client.pair(value.code);
        const saved = {server: value.server, token: paired.token, deviceId: paired.deviceId};
        await device.saveCredentials(JSON.stringify(saved)); setCredentials(saved); live.current.credentials = saved;
        setServer(value.server); setCode(''); await refresh(saved); setNotice('');
      } catch (e) { if (live.current.connection === 'connecting') setConnection('failed'); throw e; }
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
    if (busy.current || live.current.stage !== 'idle' || !live.current.view) return;
    const selected = live.current.selection;
    setError(''); setNotice('');
    if (kind === 'workspace') {
      if (!live.current.view.workspaces.some(item => item.id === id)) return;
      updateSelection({...selected, workspaceId: id, sessionId: id === selected.workspaceId ? selected.sessionId : null});
      setSessions([]);
    } else if (kind === 'voice') {
      if (id && !live.current.view.voices.some(item => item.id === id)) return;
      updateSelection({...selected, voiceId: id || null});
    } else {
      if (!selected.workspaceId) return;
      updateSelection({...selected, sessionId: kind === 'new' ? null : id});
      setSettings(false);
    }
    if (kind !== 'voice') { setTranscript(''); setSpeech(''); setHistory(null); }
    if (kind === 'workspace') await action(() => loadSessions(id));
  }
  async function loadHistory(older = false) {
    if (!live.current.credentials || !live.current.view) return;
    await action(async () => {
      const {workspaceId, sessionId} = live.current.selection;
      if (!workspaceId || !sessionId) { setHistory(null); return; }
      const token = live.current.credentials?.token;
      const page = await api().history(workspaceId, sessionId, older ? history?.before ?? undefined : undefined);
      if (!mounted.current || token !== live.current.credentials?.token || workspaceId !== live.current.selection.workspaceId || sessionId !== live.current.selection.sessionId) return;
      if (page.workspaceId !== workspaceId || page.sessionId !== sessionId) throw new Error('服务端返回的历史记录与所选会话不匹配');
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
    let recordingStopped = false;
    try {
      const recording = await device.stopRecording();
      recordingStopped = true;
      if (epoch !== generation.current) { device.discardRecording(recording.path); return; }
      if (!send || recording.durationMs < 350) {
        device.discardRecording(recording.path); setPhase('idle');
        if (send && !live.current.continuous) setNotice('说话时间太短，请按住按钮后再说话');
        scheduleListening(); return;
      }
      const saved = live.current.credentials!;
      const requestId = `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      active.current = requestId; setNotice('');
      const options = recordingSelection.current;
      if (!options) { device.discardRecording(recording.path); throw new Error('请先选择工作区'); }
      await device.submitTurn(saved.server, saved.token, requestId, recording.path, options);
      if (epoch !== generation.current) return;
      active.current = null; setPhase('idle'); scheduleListening();
    } catch (e) {
      if (epoch !== generation.current) return;
      active.current = null;
      if (recordingStopped) setPhase('idle');
      else await stop();
      await report(e);
    }
  }
  async function start(auto = false) {
    if (live.current.stage !== 'idle' || busy.current || !foreground.current) return;
    const selected = live.current.selection;
    if (live.current.connection !== 'connected' || !live.current.credentials || !live.current.view) return;
    if (!selected.workspaceId) {
      setError('请先选择工作区'); setSettings(true); setListening(false); return;
    }
    recordingSelection.current = {...selected, workspaceId: selected.workspaceId};
    // The server owns voice defaults and provider readiness; validate them when submitting the turn.
    const epoch = generation.current; setPhase('starting'); setError(''); setNotice('');
    try {
      await microphonePermission();
      if (epoch !== generation.current) return;
      if (!auto && !pressed.current && !live.current.continuous) { setPhase('idle'); return; }
      await device.startRecording();
      // stop() already owns cleanup; a delayed result must not cancel a newer recording.
      if (epoch !== generation.current) return;
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
      if (event.type === 'level' && live.current.stage === 'recording' && live.current.continuous) {
        const data = JSON.parse(event.value) as {level: number};
        const result = detectSpeech(vad.current, data.level, Date.now()); vad.current = result.state;
        if (result.action !== 'wait') void finish(result.action === 'send');
      }
      if (event.type === 'recordLimit') void finish();
      if (event.type === 'recordError') { stop(); setError(event.value); }
      if (event.type === 'interrupted') { stop(); setNotice(event.value); }
      if ((event.type === 'frame' || event.type === 'playing') && (!event.requestId || event.requestId !== active.current)) return;
      if (event.type === 'playing') setPhase('playing');
      if (event.type === 'frame') {
        const frame = JSON.parse(event.value) as TurnEnvelope;
        // Bind the server-created session before another (including continuous) turn can start.
        const selected = live.current.selection;
        if (active.current && frame.requestId === active.current && frame.workspaceId === selected.workspaceId && typeof frame.sessionId === 'string' && frame.sessionId && frame.sessionId !== 'null' && frame.sessionId !== 'undefined') {
          if (!selected.sessionId) updateSelection({...selected, sessionId: frame.sessionId});
        }
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
      const epoch = connectionEpoch.current;
      try {
        const value = await device.readCredentials();
        if (!mounted.current || epoch !== connectionEpoch.current) return;
        if (value) {
          const saved = JSON.parse(value) as Credentials;
          if (saved.selection) updateSelection(saved.selection);
          setCredentials(saved); live.current.credentials = saved; setServer(saved.server); await refresh(saved);
        }
        else setConnection('unpaired');
      } catch (e) { if (mounted.current) { if (live.current.connection === 'connecting') setConnection('failed'); await report(e); } }
      const url = await Linking.getInitialURL(); if (url) receiveLink(url);
    })();
    return () => { mounted.current = false; generation.current++; clearResume(); device.cancelAll(); sub.remove(); app.remove(); links.remove(); };
    // Native listeners read mutable current state; they are registered only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {credentials, view, selection, connection, sessions, history, stage, continuous, transcript, speech, error, notice, pending, copied,
    settings, setSettings, historyOpen, setHistoryOpen, server, setServer, code, setCode,
    pair, scan, choose, refresh: () => action(() => refresh()), loadHistory, press, release, lock, stop, openSettings, openHistory, copyAddress,
    disconnect: () => action(async () => { await device.saveCredentials(null); clearConnection(); setTranscript(''); setSpeech(''); setServer(''); setCode(''); setNotice(''); setHistoryOpen(false); }),
  };
}
