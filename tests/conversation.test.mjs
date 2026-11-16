import test from 'node:test';
import assert from 'node:assert/strict';
import {newListeningState, detectSpeech} from '../src/core/turn/listening.ts';
import {historyRows} from '../src/core/api/presentation.ts';

test('continuous listening sends only after sustained speech and 1.2 seconds of silence', () => {
  let state = newListeningState(0);
  for (let now = 100; now <= 2000; now += 100) {
    const next = detectSpeech(state, 0.002, now); state = next.state; assert.equal(next.action, 'wait');
  }
  for (let now = 2100; now <= 2600; now += 100) state = detectSpeech(state, 0.06, now).state;
  for (let now = 2700; now < 3800; now += 100) {
    const next = detectSpeech(state, 0.002, now); state = next.state; assert.equal(next.action, 'wait');
  }
  assert.equal(detectSpeech(state, 0.002, 3800).action, 'send');
});
test('an isolated click or pure silence never becomes a submitted utterance', () => {
  let state = newListeningState(0);
  state = detectSpeech(state, 0.4, 100).state;
  for (let now = 200; now < 60000; now += 100) {
    const next = detectSpeech(state, 0.001, now); state = next.state; assert.equal(next.action, 'wait');
  }
  assert.equal(detectSpeech(state, 0.001, 60000).action, 'empty');
});
test('history renders visible user and assistant text without showing hidden reasoning', () => {
  const rows = historyRows([
    {seq: 1, type: 'user/message', data: {content: [{type: 'text', text: '问题'}]}},
    {seq: 2, type: 'assistant/message', data: {message: {content: [{type: 'reasoning', text: 'hidden'}, {type: 'text', text: '完整回复'}]}}},
  ]);
  assert.deepEqual(rows.map(row => row.text), ['问题', '完整回复']);
});
