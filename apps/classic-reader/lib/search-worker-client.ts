/** One search worker per mounted catalogue. A transient script-load failure gets
 * one retry, with only the current init and latest search/cancel replayed. */
type Request = { type: string; [key: string]: unknown };
type Transport = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
export type SearchWorkerClient = { postMessage: (message: Request) => void; terminate: () => void };

export function createSearchWorkerClient<T>(options: {
  onmessage: (event: MessageEvent<T>) => void;
  onerror: () => void;
  createWorker?: () => Transport;
  retryDelay?: number;
}): SearchWorkerClient {
  let worker: Transport | null = null;
  let init: Request | undefined, latest: Request | undefined;
  let stopped = false, retried = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const detach = () => {
    if (!worker) return;
    worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = null;
  };
  const fail = () => {
    detach();
    if (stopped) return;
    if (!retried) {
      retried = true;
      timer = setTimeout(start, options.retryDelay ?? 250);
    } else options.onerror();
  };
  const start = () => {
    timer = undefined;
    if (stopped) return;
    try {
      const current = (options.createWorker ?? (() => new Worker('/search-worker.js?v=3')))();
      worker = current;
      current.onmessage = event => { if (!stopped && worker === current) options.onmessage(event); };
      current.onerror = event => {
        if (stopped || worker !== current) return;
        event.preventDefault();
        fail();
      };
      if (init) current.postMessage(init);
      if (latest) current.postMessage(latest);
    } catch { fail(); }
  };
  // Defer construction so callers can install their ownership reference first.
  queueMicrotask(start);
  return {
    postMessage(message) {
      if (stopped) return;
      if (message.type === 'init') init = message;
      else latest = message;
      worker?.postMessage(message);
    },
    terminate() {
      stopped = true; clearTimeout(timer); detach(); init = undefined; latest = undefined;
    },
  };
}
