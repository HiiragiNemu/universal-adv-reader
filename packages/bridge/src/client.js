import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  connectMessage,
  requestMessage,
} from './protocol.js';

const randomId = () => globalThis.crypto?.randomUUID?.()
  ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function connectToAdvApp({
  targetWindow,
  targetOrigin,
  timeoutMs = 5_000,
  messageChannelFactory = () => new MessageChannel(),
}) {
  if (!targetWindow?.postMessage) throw new TypeError('targetWindow is required');
  if (typeof targetOrigin !== 'string' || !targetOrigin) throw new TypeError('targetOrigin is required');
  const channel = messageChannelFactory();
  const port = channel.port1;
  const pending = new Map();
  const connectId = randomId();
  let closed = false;

  const connected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge connection timed out')), timeoutMs);
    port.onmessage = (event) => {
      const message = event.data;
      if (
        message?.channel !== BRIDGE_CHANNEL
        || message?.version !== BRIDGE_VERSION
      ) return;
      if (message.type === 'connected' && message.requestId === connectId) {
        clearTimeout(timer);
        resolve(message);
        return;
      }
      if (message.type === 'response' && pending.has(message.requestId)) {
        const request = pending.get(message.requestId);
        pending.delete(message.requestId);
        clearTimeout(request.timer);
        if (message.ok) request.resolve(message.result);
        else request.reject(new Error(message.error?.message ?? 'bridge request failed'));
        return;
      }
      if (message.type === 'event') {
        for (const listener of [...listeners]) listener(message.name, message.payload);
      }
    };
    port.start?.();
    targetWindow.postMessage(connectMessage(connectId), targetOrigin, [channel.port2]);
  });

  const listeners = new Set();
  const metadata = await connected;
  return Object.freeze({
    appId: metadata.appId,
    capabilities: Object.freeze([...(metadata.capabilities ?? [])]),
    request(action, payload = {}) {
      if (closed) return Promise.reject(new Error('bridge client is closed'));
      const requestId = randomId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`bridge action ${action} timed out`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        port.postMessage(requestMessage(requestId, action, payload));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('bridge client closed'));
      }
      pending.clear();
      listeners.clear();
      port.close?.();
    },
  });
}
