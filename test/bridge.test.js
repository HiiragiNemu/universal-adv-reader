import assert from 'node:assert/strict';
import test from 'node:test';

import { connectToAdvApp } from '../packages/bridge/src/client.js';
import { connectMessage } from '../packages/bridge/src/protocol.js';
import { attachBridgeProvider } from '../packages/bridge/src/provider.js';

class LocalWindow {
  location = { origin: 'https://reader.example' };
  #listeners = new Set();

  addEventListener(name, listener) {
    if (name === 'message') this.#listeners.add(listener);
  }

  removeEventListener(name, listener) {
    if (name === 'message') this.#listeners.delete(listener);
  }

  dispatch(data, origin, ports = []) {
    for (const listener of [...this.#listeners]) listener({ data, origin, ports });
  }

  postMessage(data, targetOrigin, ports = []) {
    assert.equal(targetOrigin, this.location.origin);
    queueMicrotask(() => this.dispatch(data, this.location.origin, ports));
  }
}

test('MessagePort provider rejects other origins and serves exact actions to same-origin clients', async () => {
  const targetWindow = new LocalWindow();
  const provider = attachBridgeProvider({
    targetWindow,
    appId: 'universal-adv-reader',
    capabilities: ['story.read', 'voice.play'],
    actions: {
      'story.getLocation': async () => ({ eventId: 'line-001' }),
    },
  });

  const rejectedChannel = new MessageChannel();
  targetWindow.dispatch(connectMessage('untrusted'), 'https://other.example', [rejectedChannel.port2]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(provider.connectionCount, 0);
  rejectedChannel.port1.close();
  rejectedChannel.port2.close();

  const client = await connectToAdvApp({
    targetWindow,
    targetOrigin: targetWindow.location.origin,
    timeoutMs: 500,
  });
  assert.equal(provider.connectionCount, 1);
  assert.deepEqual(client.capabilities, ['story.read', 'voice.play']);
  assert.deepEqual(await client.request('story.getLocation'), { eventId: 'line-001' });
  await assert.rejects(client.request('story.open'), /story.open/);

  client.close();
  provider.dispose();
});
