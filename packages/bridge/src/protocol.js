export const BRIDGE_CHANNEL = 'adv-app-bridge';
export const BRIDGE_VERSION = 1;
export const BRIDGE_ACTIONS = Object.freeze([
  'story.open',
  'story.getLocation',
  'voice.play',
  'lifecycle.suspend',
  'lifecycle.resume',
  'lifecycle.dispose',
]);

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isRequestId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;

export const baseEnvelope = (type) => ({
  channel: BRIDGE_CHANNEL,
  version: BRIDGE_VERSION,
  type,
});

export function isConnectMessage(value) {
  return isRecord(value)
    && value.channel === BRIDGE_CHANNEL
    && value.version === BRIDGE_VERSION
    && value.type === 'connect'
    && isRequestId(value.requestId);
}

export function isRequestMessage(value) {
  return isRecord(value)
    && value.channel === BRIDGE_CHANNEL
    && value.version === BRIDGE_VERSION
    && value.type === 'request'
    && isRequestId(value.requestId)
    && BRIDGE_ACTIONS.includes(value.action)
    && (value.payload === undefined || isRecord(value.payload));
}

export function connectMessage(requestId) {
  return { ...baseEnvelope('connect'), requestId };
}

export function connectedMessage(requestId, appId, capabilities) {
  return {
    ...baseEnvelope('connected'),
    requestId,
    appId,
    capabilities: [...capabilities],
  };
}

export function requestMessage(requestId, action, payload = {}) {
  if (!BRIDGE_ACTIONS.includes(action)) throw new TypeError(`unsupported bridge action ${action}`);
  return { ...baseEnvelope('request'), requestId, action, payload };
}

export function responseMessage(requestId, result) {
  return { ...baseEnvelope('response'), requestId, ok: true, result };
}

export function errorMessage(requestId, code, message) {
  return {
    ...baseEnvelope('response'),
    requestId,
    ok: false,
    error: { code, message },
  };
}

export function eventMessage(name, payload) {
  return { ...baseEnvelope('event'), name, payload };
}
