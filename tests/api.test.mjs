import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

function load(relative, imports = {}) {
  const source = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, Error, URL, URLSearchParams, AbortController, setTimeout, clearTimeout});
  return exports;
}
const errors = load('../src/core/api/errors.ts');
const {VoxChatClient} = load('../src/core/api/VoxChatClient.ts', {'./errors': errors});

test('session and history queries carry the explicit workspace with safe URL encoding', async () => {
  const requests = [];
  const client = new VoxChatClient('https://example.com', 'device-token', async (url, options) => {
    requests.push({url: new URL(url), options});
    return {ok: true, json: async () => ({items: []})};
  });
  const workspaceId = 'workspace /&中文';
  await client.sessions(workspaceId);
  await client.history(workspaceId, 'session /&', 17, 25);
  assert.equal(requests[0].url.pathname, '/voxchat/api/sessions');
  assert.equal(requests[1].url.pathname, '/voxchat/api/sessions/session%20%2F%26/history');
  for (const {url, options} of requests) {
    assert.equal(url.searchParams.get('workspaceId'), workspaceId);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer device-token');
    assert.equal(options.body, undefined);
  }
  assert.equal(requests[1].url.searchParams.get('before'), '17');
  assert.equal(requests[1].url.searchParams.get('limit'), '25');
});

test('client reads current server catalogs and workspace-scoped history without changing device configuration', {
  skip: !process.env.VOXCHAT_SERVER_ROOT && 'Set VOXCHAT_SERVER_ROOT to run against a VoxChat source checkout',
}, async t => {
  const {fixture, command} = await import(pathToFileURL(resolve(process.env.VOXCHAT_SERVER_ROOT, 'tests/helpers.mjs')).href);
  const f = await fixture(t);
  command(f.service, {action: 'bindDevice', deviceId: f.pair.deviceId, workspaceId: 'work-b'});
  const before = f.service.me(f.pair.deviceId);
  const requests = [];
  const client = new VoxChatClient(f.url, f.pair.token, async (url, options) => {
    requests.push({url: new URL(url), method: options.method});
    return fetch(url, options);
  });
  assert.equal((await client.status()).protocol, 2);
  const catalog = await client.me();
  assert.equal(catalog.workspaces.length, 2);
  assert.equal(catalog.voices[0].id, 'test-voice');
  assert.notEqual(catalog.voices[0].id, catalog.voices[0].value);
  const list = await client.sessions('work-b');
  assert.equal(list.workspaceId, 'work-b');
  assert.equal(list.items[0].sessionId, 'session-other');
  const history = await client.history('work-b', 'session-other');
  assert.equal(history.workspaceId, 'work-b');
  assert.equal(history.sessionId, 'session-other');
  await assert.rejects(client.history('work-b', 'session-a'), error => error.code === 'SESSION_NOT_FOUND');
  assert.deepEqual(f.service.me(f.pair.deviceId), before);
  assert.ok(requests.every(request => request.method === 'GET'));
});

test('client pairing and cancellation match the current server routes', {
  skip: !process.env.VOXCHAT_SERVER_ROOT && 'Set VOXCHAT_SERVER_ROOT to run against a VoxChat source checkout',
}, async t => {
  const {fixture, command, wav, events} = await import(pathToFileURL(resolve(process.env.VOXCHAT_SERVER_ROOT, 'tests/helpers.mjs')).href);
  const f = await fixture(t);
  const pending = command(f.service, {action: 'addDevice', name: 'contract-test'}).result;
  const publicClient = new VoxChatClient(f.url, null, fetch);
  const pair = await publicClient.pair(pending.code.toLowerCase());
  assert.equal(pair.deviceId, pending.id);
  assert.match(pair.token, /^[a-zA-Z0-9_-]{43}$/);
  const client = new VoxChatClient(f.url, pair.token, fetch);
  const catalog = await client.me();
  assert.deepEqual(catalog.workspaces, []);
  assert.deepEqual(catalog.voices, []);
  await assert.rejects(publicClient.pair(pending.code), error => error.code === 'INVALID_PAIRING_CODE');
  command(f.service, {action: 'bindDevice', deviceId: pair.deviceId, workspaceId: 'work-a'});
  // Hold ASR after the first phase frame, so DELETE cancels a real active request.
  f.service.voice.transcribe = async (_config, _audio, _type, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
    if (signal.aborted) reject(signal.reason);
  });
  const response = await fetch(`${f.url}/voxchat/api/turns?workspaceId=work-a&sessionId=session-a`, {
    method: 'POST', headers: {Authorization: `Bearer ${pair.token}`, 'Content-Type': 'audio/wav', 'X-Request-Id': 'cancel-contract'}, body: wav(),
  });
  assert.equal(response.status, 200);
  await client.cancel('cancel-contract');
  const frames = await events(response);
  assert.equal(frames[0].type, 'phase');
  assert.equal(frames.at(-1).type, 'error');
  assert.equal(frames.at(-1).error.code, 'CANCELLED');
});

test('current server emits the audio contract for a new session and continuation with optional voice', {
  skip: !process.env.VOXCHAT_SERVER_ROOT && 'Set VOXCHAT_SERVER_ROOT to run against a VoxChat source checkout',
}, async t => {
  const {fixture, upload, events} = await import(pathToFileURL(resolve(process.env.VOXCHAT_SERVER_ROOT, 'tests/helpers.mjs')).href);
  const f = await fixture(t);
  const frames = await events(await upload(f, 'new-contract', {selection: {workspaceId: 'work-a'}}));
  const sessionId = frames[0].sessionId;
  assert.match(sessionId, /^[a-zA-Z0-9_-]{1,128}$/);
  let bytes = 0, chunks = 0;
  for (const [seq, frame] of frames.entries()) {
    assert.equal(frame.protocol, 2);
    assert.equal(frame.requestId, 'new-contract');
    assert.equal(frame.workspaceId, 'work-a');
    assert.equal(frame.sessionId, sessionId);
    assert.equal(frame.seq, seq);
    if (frame.type === 'audio.start') assert.equal(frame.data.format, 'wav');
    if (frame.type === 'audio.chunk') {
      assert.equal(frame.data.index, chunks++);
      bytes += Buffer.from(frame.data.data, 'base64').length;
    }
    if (frame.type === 'audio.end') {
      assert.equal(frame.data.bytes, bytes);
      assert.equal(frame.data.chunks, chunks);
    }
  }
  assert.ok(bytes > 0);
  assert.equal(frames.at(-1).type, 'complete');
  assert.equal(frames.at(-1).data.status, 'audio_delivered');
  const firstSpeech = f.upstream.calls.find(call => call.path.endsWith('/audio/speech'));
  assert.equal(Object.hasOwn(JSON.parse(firstSpeech.body), 'voice'), false);
  const sessionCount = f.dsh.workspace('work-a').sessionIds.length;
  const continued = await events(await upload(f, 'continued-contract', {selection: {workspaceId: 'work-a', sessionId, voiceId: 'test-voice'}}));
  assert.ok(continued.every(frame => frame.sessionId === sessionId));
  assert.equal(continued.at(-1).type, 'complete');
  assert.equal(f.dsh.workspace('work-a').sessionIds.length, sessionCount);
  assert.equal(JSON.parse(f.upstream.calls.findLast(call => call.path.endsWith('/audio/speech')).body).voice, 'sample');
  const client = new VoxChatClient(f.url, f.pair.token, fetch);
  assert.equal((await client.history('work-a', sessionId)).items.length, 2);
});
