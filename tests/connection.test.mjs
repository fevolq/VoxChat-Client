import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/screens/useConversation.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const saved = {server: 'https://example.com', token: 'device-token', deviceId: 'device'};
const deviceView = {workspaceId: 'workspace', sessionId: 'server-session', voiceId: 'server-voice',
  workspaces: [{id: 'workspace'}, {id: 'other'}], voices: [{id: 'voice', value: 'provider-voice-value'}], ready: {asr: true, tts: true}};
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
class ApiError extends Error { constructor(status) { super('request failed'); this.status = status; } }

// Run the real hook against controlled React state and native/network boundaries.
// No Android runtime or service is needed to exercise delayed startup and failures.
function harness(readCredentials = async () => JSON.stringify(saved)) {
  const slots = [], effects = [], persisted = [];
  let cursor = 0, firstRender = true, eventListener;
  const api = {
    status: async () => ({protocol: 2}),
    me: async () => deviceView,
    sessions: async workspaceId => ({workspaceId, items: [{sessionId: 'target-session'}]}),
  };
  const device = {
    readCredentials,
    saveCredentials: async value => { persisted.push(value); },
    cancel: async () => {}, cancelAll() {},
    startRecording: async () => {},
    stopRecording: async () => ({path: '/record.wav', durationMs: 1000}),
    submitTurn: async () => {}, discardRecording() {},
  };
  const modules = {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ??= {current: initial}; },
      useEffect(callback) { if (firstRender) effects.push(callback); },
    },
    'react-native': {
      AppState: {addEventListener: () => ({remove() {}})},
      Linking: {addEventListener: () => ({remove() {}}), getInitialURL: async () => null},
    },
    '../core/api/VoxChatClient': {VoxChatClient: class {constructor() {return api;}}},
    '../core/api/errors': {ApiError},
    '../core/api/pairing': {parsePairingLink() {throw new Error('Not used');}},
    '../core/turn/listening': {newListeningState: () => ({})},
    '../platform/device': {device, microphonePermission: async () => {}, subscribeDevice: listener => {eventListener = listener; return {remove() {}};}},
  };
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    return modules[name];
  }, Error, setTimeout, clearTimeout});
  const render = () => {cursor = 0; const result = exports.useConversation(); firstRender = false; return result;};
  const initial = render();
  const cleanups = effects.map(effect => effect());
  return {initial, render, api, device, persisted, emit: event => eventListener(event), dispose: () => cleanups.forEach(cleanup => cleanup?.())};
}

test('startup stays connecting until stored credentials are read, then identifies unpaired devices', async t => {
  const read = deferred(), h = harness(() => read.promise); t.after(h.dispose);
  assert.equal(h.initial.connection, 'connecting');
  read.resolve(null); await flush();
  assert.equal(h.render().connection, 'unpaired');
});

test('opening settings during startup and history while idle never enters the voice stopping state', async t => {
  const read = deferred(), h = harness(() => read.promise); t.after(h.dispose);
  h.device.cancel = async () => {assert.fail('idle navigation must not cancel native audio');};
  const opening = h.render().openSettings();
  assert.equal(h.render().stage, 'idle');
  await opening;
  assert.equal(h.render().settings, true);
  assert.equal(h.render().stage, 'idle');
  read.resolve(JSON.stringify(saved)); await flush();
  h.api.history = async () => ({items: []});
  const history = h.render().openHistory();
  assert.equal(h.render().stage, 'idle');
  await history;
  assert.equal(h.render().historyOpen, true);
  assert.equal(h.render().stage, 'idle');
});

test('opening settings during playback still waits for native audio to stop', async t => {
  const h = harness(), cancelled = deferred(), upload = deferred(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace');
  h.api.cancel = async () => {};
  h.device.submitTurn = async (_server, _token, requestId) => {
    h.emit({type: 'playing', requestId}); await upload.promise;
  };
  h.render().press(); await flush(); h.render().release(); await flush();
  let cancellations = 0;
  h.device.cancel = () => {cancellations++; return cancelled.promise;};
  const opening = h.render().openSettings();
  assert.equal(cancellations, 1);
  assert.equal(h.render().stage, 'stopping');
  assert.equal(h.render().settings, false);
  cancelled.resolve(); await opening;
  assert.equal(h.render().stage, 'idle');
  assert.equal(h.render().settings, true);
  upload.resolve(); await flush();
});

for (const kind of ['session', 'new']) {
  test(`${kind} returns home immediately without a mutation or refresh request`, async t => {
    const h = harness(); t.after(h.dispose);
    await flush();
    await h.render().choose('workspace', 'workspace');
    h.render().setSettings(true);
    for (const key of ['selectSession', 'createSession', 'status', 'me', 'sessions']) {
      h.api[key] = () => assert.fail(`selection must not call ${key}`);
    }
    await h.render().choose(kind, 'target-session');
    assert.equal(h.render().settings, false);
    assert.equal(h.render().selection.sessionId, kind === 'new' ? null : 'target-session');
    assert.equal(h.render().pending, false);
  });
}

test('local choices survive refresh and workspace changes clear the previous session', async t => {
  const h = harness(); t.after(h.dispose);
  await flush();
  assert.equal(h.render().selection.workspaceId, null, 'server-owned selections must not drive the client');
  await h.render().choose('workspace', 'workspace');
  await h.render().choose('session', 'target-session');
  await h.render().choose('voice', 'voice');
  await h.render().refresh();
  assert.equal(h.render().selection.sessionId, 'target-session');
  assert.equal(h.render().selection.voiceId, 'voice');
  let queried;
  h.api.sessions = async workspaceId => {queried = workspaceId; return {workspaceId, items: []};};
  await h.render().choose('workspace', 'other');
  assert.equal(queried, 'other');
  assert.equal(h.render().selection.sessionId, null);
  assert.equal(h.render().selection.voiceId, 'voice');
  await h.render().choose('voice', '');
  assert.equal(h.render().selection.voiceId, null);
});

test('audio carries local choices and a new session returned by the server is reused', async t => {
  const h = harness(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'other');
  const uploads = [];
  h.device.submitTurn = async (server, token, requestId, path, options) => {
    uploads.push({...options});
    assert.equal(server, saved.server); assert.equal(token, saved.token); assert.equal(path, '/record.wav');
    h.emit({type: 'frame', requestId, value: JSON.stringify({type: 'phase', requestId, workspaceId: 'other', sessionId: 'created-session', data: {phase: 'asr'}})});
  };
  h.render().press(); await flush();
  assert.equal(h.render().stage, 'recording', 'new sessions do not require an existing ID');
  h.render().release(); await flush();
  assert.deepEqual(uploads[0], {workspaceId: 'other', sessionId: null, voiceId: null});
  assert.equal(h.render().selection.sessionId, 'created-session');
  assert.equal(JSON.parse(h.persisted.at(-1)).selection.sessionId, 'created-session');
  await h.render().choose('voice', 'voice');
  h.render().press(); await flush(); h.render().release(); await flush();
  assert.deepEqual(uploads[1], {workspaceId: 'other', sessionId: 'created-session', voiceId: 'voice'});
  await h.render().choose('new');
  assert.equal(h.render().selection.sessionId, null);
  assert.equal(JSON.parse(h.persisted.at(-1)).selection.sessionId, null);
});

test('local selections are restored after restart and sent with the next recording', async t => {
  const h = harness(); t.after(h.dispose);
  await flush();
  await h.render().choose('workspace', 'workspace');
  await h.render().choose('session', 'target-session');
  await h.render().choose('voice', 'voice');
  const stored = h.persisted.at(-1);
  const next = harness(async () => stored); t.after(next.dispose);
  await flush();
  assert.equal(next.render().connection, 'connected');
  assert.equal(next.render().selection.workspaceId, 'workspace');
  assert.equal(next.render().selection.sessionId, 'target-session');
  assert.equal(next.render().selection.voiceId, 'voice');
  assert.equal(next.render().settings, false);
  let submitted;
  next.device.submitTurn = async (_server, _token, _request, _path, options) => { submitted = {...options}; };
  next.render().press(); await flush(); next.render().release(); await flush();
  assert.deepEqual(submitted, {workspaceId: 'workspace', sessionId: 'target-session', voiceId: 'voice'});
  await next.render().disconnect();
  assert.equal(next.persisted.at(-1), null);
});

test('failed startup connection retains saved choices for retry', async t => {
  const stored = JSON.stringify({...saved, selection: {workspaceId: 'workspace', sessionId: 'target-session', voiceId: null}});
  const h = harness(async () => stored); t.after(h.dispose);
  h.api.status = async () => {throw new Error('network failed');};
  await flush();
  assert.equal(h.render().connection, 'failed');
  assert.equal(h.render().selection.sessionId, 'target-session');
  assert.deepEqual(h.persisted, []);
  h.api.status = async () => ({protocol: 2});
  await h.render().refresh();
  assert.equal(h.render().selection.sessionId, 'target-session');
});

test('unavailable restored workspace and voice are removed from local storage', async t => {
  const h = harness(async () => JSON.stringify({...saved, selection: {workspaceId: 'removed', sessionId: 'old-session', voiceId: 'removed'}})); t.after(h.dispose);
  await flush();
  assert.deepEqual(JSON.parse(h.persisted.at(-1)).selection, {workspaceId: null, sessionId: null, voiceId: null});
  assert.match(h.render().error, /工作区已不可用/);
});

test('local save failures are visible without delaying session navigation', async t => {
  const h = harness(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace');
  h.render().setSettings(true);
  h.device.saveCredentials = async () => {throw new Error('disk full');};
  await h.render().choose('session', 'target-session'); await flush();
  assert.equal(h.render().settings, false);
  assert.match(h.render().error, /无法保存本机配置：disk full/);
});

test('history is read using the local workspace and session', async t => {
  const h = harness(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'other'); await h.render().choose('session', 'target-session');
  h.api.history = async (workspaceId, sessionId) => {
    assert.equal(workspaceId, 'other'); assert.equal(sessionId, 'target-session');
    return {workspaceId, sessionId, items: []};
  };
  await h.render().loadHistory();
  assert.equal(h.render().history.sessionId, 'target-session');
});

test('minimal server catalog with no voices or legacy readiness allows new-session recording', async t => {
  const h = harness(); t.after(h.dispose);
  h.api.me = async () => ({protocol: 2, deviceId: 'device', name: 'phone',
    workspaces: [{id: 'workspace', title: '工作区', path: '/workspace'}], voices: []});
  await flush();
  await h.render().choose('workspace', 'workspace');
  h.render().press(); await flush();
  assert.equal(h.render().stage, 'recording');
  assert.equal(h.render().selection.sessionId, null);
  assert.equal(h.render().selection.voiceId, null);
  await h.render().stop();
});

for (const phase of ['asr', 'tts']) {
  test(`a server-created session survives ${phase} failure without automatic retry`, async t => {
    const h = harness(); t.after(h.dispose);
    await flush(); await h.render().choose('workspace', 'workspace');
    const uploads = [];
    h.device.submitTurn = async (_server, _token, requestId, _path, options) => {
      uploads.push({...options});
      h.emit({type: 'frame', requestId, value: JSON.stringify({type: 'phase', requestId,
        workspaceId: 'workspace', sessionId: 'created-session', data: {phase}})});
      throw new Error(`${phase} 服务暂不可用`);
    };
    h.render().press(); await flush(); h.render().release(); await flush();
    assert.equal(h.render().selection.sessionId, 'created-session');
    assert.equal(h.render().error, `${phase} 服务暂不可用`);
    assert.equal(h.render().stage, 'idle');
    assert.equal(uploads.length, 1, 'failure must not automatically retry the command');
    h.device.submitTurn = async (_server, _token, _id, _path, options) => {uploads.push({...options});};
    h.render().press(); await flush(); h.render().release(); await flush();
    assert.equal(uploads[1].sessionId, 'created-session');
  });
}

test('a plugin ignoring workspace query parameters cannot populate another workspace list', async t => {
  const h = harness(); t.after(h.dispose);
  await flush();
  h.api.sessions = async () => ({workspaceId: 'workspace', items: [{sessionId: 'wrong-session'}]});
  await h.render().choose('workspace', 'other');
  assert.equal(h.render().sessions.length, 0);
  assert.match(h.render().error, /工作区不匹配/);
  assert.equal(h.render().selection.workspaceId, 'other');
});

test('cancelled turn frames cannot replace a newly chosen conversation', async t => {
  const h = harness(), upload = deferred(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace');
  let requestId;
  h.api.cancel = async () => {};
  h.device.submitTurn = async (_server, _token, id) => {requestId = id; await upload.promise;};
  h.render().press(); await flush(); h.render().release(); await flush();
  await h.render().stop(); await h.render().choose('new');
  h.emit({type: 'frame', requestId, value: JSON.stringify({type: 'phase', requestId, workspaceId: 'workspace', sessionId: 'cancelled-session', data: {phase: 'asr'}})});
  assert.equal(h.render().selection.sessionId, null);
  assert.equal(h.render().stage, 'idle');
  upload.resolve(); await flush();
});

test('authentication failure can be retried without losing the saved pairing', async t => {
  const read = deferred(), h = harness(() => read.promise); t.after(h.dispose);
  h.api.me = async () => {throw new Error('network unavailable');};
  read.resolve(JSON.stringify(saved)); await flush();
  assert.equal(h.render().connection, 'failed');
  assert.equal(h.render().credentials.token, saved.token);
  assert.deepEqual(h.persisted, []);
  const me = deferred(); h.api.me = () => me.promise;
  const retry = h.render().refresh(); await flush();
  assert.equal(h.render().connection, 'connecting');
  me.resolve(deviceView); await retry;
  assert.equal(h.render().connection, 'connected');
  h.api.status = async () => {throw new Error('timeout');};
  await h.render().refresh();
  assert.equal(h.render().connection, 'failed');
  assert.ok(h.render().view, 'cached data must not imply a live connection');
});

test('session-list failure does not turn a successfully authenticated device into disconnected', async t => {
  const h = harness(); t.after(h.dispose);
  h.api.sessions = async () => {throw new Error('sessions unavailable');};
  await flush();
  await h.render().choose('workspace', 'workspace');
  assert.equal(h.render().connection, 'connected');
  assert.match(h.render().error, /sessions unavailable/);
});

test('invalid credentials become unpaired and delayed responses cannot restore the connection', async t => {
  const h = harness(); t.after(h.dispose);
  h.api.me = async () => {throw new ApiError(401);};
  await flush();
  assert.equal(h.render().connection, 'unpaired');
  assert.equal(h.render().credentials, null);
  assert.deepEqual(h.persisted, [null]);

  const slow = harness(), me = deferred(); t.after(slow.dispose);
  slow.api.me = () => me.promise; await flush();
  await slow.render().disconnect();
  me.resolve(deviceView); await flush();
  assert.equal(slow.render().connection, 'unpaired');
  assert.equal(slow.render().view, null);
});

test('refresh silently replaces an unavailable voice with the default and allows recording', async t => {
  const h = harness(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace'); await h.render().choose('voice', 'voice');
  h.api.me = async () => ({...deviceView, voices: []});
  await h.render().refresh();
  assert.equal(h.render().selection.voiceId, null);
  assert.equal(h.render().error, '');
  assert.equal(h.render().settings, false);
  h.render().press(); await flush();
  assert.equal(h.render().stage, 'recording');
  assert.equal(h.render().selection.voiceId, null);
  await h.render().stop();
});

for (const code of ['UNAUTHORIZED', 'DEVICE_REVOKED']) {
  test(`native ${code} failure clears credentials without depending on a separate event`, async t => {
    const h = harness(); t.after(h.dispose);
    await flush(); await h.render().choose('workspace', 'workspace');
    h.device.submitTurn = async () => {throw Object.assign(new Error('设备凭证已失效'), {code});};
    h.render().press(); await flush(); h.render().release(); await flush();
    assert.equal(h.render().connection, 'unpaired');
    assert.equal(h.render().credentials, null);
    assert.equal(h.persisted.at(-1), null);
  });
}

test('overlapping stop calls share cleanup and prohibit recording until it completes', async t => {
  const h = harness(), cancelled = deferred(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace');
  h.render().press(); await flush();
  let count = 0;
  h.device.cancel = async () => {count++; await cancelled.promise;};
  const first = h.render().stop(), second = h.render().stop();
  h.render().press(); await flush();
  assert.equal(count, 1);
  assert.equal(h.render().stage, 'stopping');
  cancelled.resolve(); await Promise.all([first, second]);
  assert.equal(h.render().stage, 'idle');
});

test('failed stop remains stopped from starting a new recording until cleanup succeeds', async t => {
  const h = harness(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace');
  h.render().press(); await flush();
  h.device.cancel = async () => {throw new Error('麦克风未能停止');};
  await h.render().stop();
  assert.equal(h.render().stage, 'stopping');
  assert.equal(h.render().error, '麦克风未能停止');
  h.device.cancel = async () => {};
  await h.render().stop();
  assert.equal(h.render().stage, 'idle');
});

test('unscoped or stale playback events cannot animate an idle home screen', async t => {
  const h = harness(); t.after(h.dispose);
  await flush();
  h.emit({type: 'playing'});
  h.emit({type: 'playing', requestId: 'old-request'});
  h.emit({type: 'frame', value: JSON.stringify({type: 'phase', data: {phase: 'tts'}})});
  assert.equal(h.render().stage, 'idle');
});

test('a delayed start result after stop cannot cancel a newer recording', async t => {
  const h = harness(), oldStart = deferred(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace');
  let starts = 0, cancellations = 0;
  h.device.startRecording = async () => {if (++starts === 1) await oldStart.promise;};
  h.device.cancelAll = () => {cancellations++;};
  h.render().press(); await flush();
  assert.equal(h.render().stage, 'starting');
  await h.render().stop();
  h.render().press(); await flush();
  assert.equal(h.render().stage, 'recording');
  oldStart.resolve(); await flush();
  assert.equal(cancellations, 0);
  assert.equal(h.render().stage, 'recording');
  await h.render().stop();
});

test('failed recording finalization waits for native cleanup before allowing another recording', async t => {
  const h = harness(), cleanup = deferred(); t.after(h.dispose);
  await flush(); await h.render().choose('workspace', 'workspace');
  h.device.stopRecording = async () => {throw new Error('麦克风未能停止');};
  let cancellations = 0, starts = 0;
  h.device.startRecording = async () => {starts++;};
  h.device.cancel = async () => {cancellations++; await cleanup.promise;};
  h.render().press(); await flush(); h.render().release(); await flush();
  assert.equal(h.render().stage, 'stopping');
  assert.equal(cancellations, 1);
  h.render().press(); await flush();
  assert.equal(starts, 1);
  cleanup.resolve(); await flush();
  assert.equal(h.render().stage, 'idle');
  assert.equal(h.render().error, '麦克风未能停止');
});
