import {
  connectedMessage,
  errorMessage,
  eventMessage,
  isConnectMessage,
  isRequestMessage,
  responseMessage,
} from './protocol.js';

const exactOriginAllowed = (origin, allowedOrigins, ownOrigin) => {
  if (origin === ownOrigin) return true;
  return allowedOrigins.includes(origin);
};

export function attachBridgeProvider({
  targetWindow = globalThis.window,
  appId,
  capabilities,
  allowedOrigins = [],
  actions,
}) {
  if (!targetWindow?.addEventListener) throw new TypeError('targetWindow is required');
  if (typeof appId !== 'string' || !appId) throw new TypeError('appId is required');
  const ports = new Set();
  const ownOrigin = targetWindow.location?.origin ?? '';
  let disposed = false;

  const emit = (name, payload) => {
    if (disposed) return;
    const message = eventMessage(name, payload);
    for (const port of [...ports]) port.postMessage(message);
  };

  const attachPort = (port, connect) => {
    ports.add(port);
    port.onmessage = async (event) => {
      const message = event.data;
      if (!isRequestMessage(message)) return;
      const handler = actions[message.action];
      if (typeof handler !== 'function') {
        port.postMessage(errorMessage(message.requestId, 'unsupported-action', message.action));
        return;
      }
      try {
        const result = await handler(message.payload ?? {});
        port.postMessage(responseMessage(message.requestId, result ?? null));
      } catch (error) {
        port.postMessage(errorMessage(
          message.requestId,
          'action-failed',
          error instanceof Error ? error.message : String(error),
        ));
      }
    };
    port.onmessageerror = () => {
      ports.delete(port);
      port.close?.();
    };
    port.start?.();
    port.postMessage(connectedMessage(connect.requestId, appId, capabilities));
  };

  const onWindowMessage = (event) => {
    if (disposed || !isConnectMessage(event.data)) return;
    if (!exactOriginAllowed(event.origin, allowedOrigins, ownOrigin)) return;
    const [port] = event.ports ?? [];
    if (!port) return;
    attachPort(port, event.data);
  };

  targetWindow.addEventListener('message', onWindowMessage);
  return Object.freeze({
    emit,
    dispose() {
      if (disposed) return;
      disposed = true;
      targetWindow.removeEventListener('message', onWindowMessage);
      for (const port of [...ports]) port.close?.();
      ports.clear();
    },
    get connectionCount() {
      return ports.size;
    },
  });
}
