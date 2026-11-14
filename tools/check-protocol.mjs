import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const protocolRoot = join(root, 'protocol');

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const status = await readJson(join(protocolRoot, 'fixtures', 'status.json'));
assert(status.name === 'VoxChat', 'status fixture must identify VoxChat');
assert(status.protocol === 2 && status.status === 'ready', 'status fixture must describe protocol v2 readiness');

const pair = await readJson(join(protocolRoot, 'fixtures', 'pair-success.json'));
assert(typeof pair.deviceId === 'string' && typeof pair.token === 'string', 'pair fixture must contain deviceId and token');
assert(Array.isArray(pair.workspaceIds), 'pair fixture must contain workspaceIds');

const events = await readJson(join(protocolRoot, 'events.json'));
assert(events.protocol === 2, 'event definitions must target protocol v2');
assert(Array.isArray(events.envelope) && events.envelope.includes('seq'), 'event definitions must declare seq');
const knownTypes = new Set(Object.keys(events.events));

async function checkStream(name, expectedTerminal) {
  const text = await readFile(join(protocolRoot, 'fixtures', name), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  let expectedSeq = 0;
  let audioIndex = 0;
  let sawTerminal = false;
  for (const [lineNumber, line] of lines.entries()) {
    let frame;
    try { frame = JSON.parse(line); } catch (error) { throw new Error(`${name}:${lineNumber + 1} is not valid JSON: ${error.message}`); }
    assert(frame.protocol === 2, `${name}:${lineNumber + 1} has an unsupported protocol`);
    assert(typeof frame.requestId === 'string' && typeof frame.type === 'string', `${name}:${lineNumber + 1} is missing its envelope`);
    assert(frame.seq === expectedSeq, `${name}:${lineNumber + 1} has a non-contiguous seq`);
    assert(knownTypes.has(frame.type), `${name}:${lineNumber + 1} uses an unknown fixture event type`);
    if (frame.type === 'audio.chunk') {
      assert(frame.data?.index === audioIndex, `${name}:${lineNumber + 1} has a non-contiguous audio index`);
      audioIndex++;
    }
    if (frame.type === expectedTerminal) {
      sawTerminal = true;
      assert(lineNumber === lines.length - 1, `${name} must end with ${expectedTerminal}`);
    }
    expectedSeq++;
  }
  assert(sawTerminal, `${name} must contain ${expectedTerminal}`);
}

await checkStream('turn-success.ndjson', 'complete');
await checkStream('turn-error.ndjson', 'error');

console.log('Protocol checks passed (protocol 2)');
