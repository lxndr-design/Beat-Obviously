import type {
  InboundEvent,
  InboundListener,
  OutboundRequest,
  ResponseFor,
} from "./schema";

/**
 * IPC bridge to the JUCE C++ backend.
 *
 * In production, the React app runs inside a juce::WebBrowserComponent
 * with native integration enabled. JUCE 8 exposes:
 *   - window.__BEAT_NATIVE__.request(kind, payload) → Promise<response>
 *   - window.__BEAT_NATIVE__.subscribe(listener)    → unsubscribe
 *
 * In dev (frontend running in plain Vite), we fall back to a mock bridge
 * that returns canned responses so the UI is fully exercisable without
 * the backend running.
 */

interface NativeBridge {
  request: (kind: string, payload: unknown) => Promise<unknown>;
  subscribe: (listener: (eventJson: string) => void) => () => void;
}

declare global {
  interface Window {
    __BEAT_NATIVE__?: NativeBridge;
  }
}

const listeners = new Set<InboundListener>();

function dispatchInbound(eventJson: string) {
  try {
    const event = JSON.parse(eventJson) as InboundEvent;
    for (const l of listeners) l(event);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[Beat IPC] Bad inbound event", e, eventJson);
  }
}

// Wire up native subscription as soon as it's available.
let unsubscribe: (() => void) | null = null;
function ensureSubscribed() {
  if (unsubscribe) return;
  const native = window.__BEAT_NATIVE__;
  if (!native) return;
  unsubscribe = native.subscribe(dispatchInbound);
}

export async function send<R extends OutboundRequest>(
  request: R,
): Promise<ResponseFor<R>> {
  ensureSubscribed();
  const native = window.__BEAT_NATIVE__;
  if (native) {
    const { kind, ...payload } = request;
    return (await native.request(kind, payload)) as ResponseFor<R>;
  }
  return mockResponse(request);
}

export function onEvent(listener: InboundListener): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isNative(): boolean {
  return Boolean(window.__BEAT_NATIVE__);
}

// ----- Mock bridge (dev mode without backend) ---------------------------

async function mockResponse<R extends OutboundRequest>(
  req: R,
): Promise<ResponseFor<R>> {
  // eslint-disable-next-line no-console
  console.debug("[Beat IPC mock]", req.kind, req);
  switch (req.kind) {
    case "ping":
      return { pong: true, backendVersion: "mock" } as ResponseFor<R>;
    case "project.list":
      return { projects: [] } as unknown as ResponseFor<R>;
    case "project.load":
      return { project: null } as unknown as ResponseFor<R>;
    case "project.exportWav":
      return { path: "/tmp/mock-export.wav" } as unknown as ResponseFor<R>;
    case "instrument.list":
      return { instruments: [] } as unknown as ResponseFor<R>;
    case "audio.import":
      return { file: null } as unknown as ResponseFor<R>;
    case "audio.list":
      return { files: [] } as unknown as ResponseFor<R>;
    default:
      return { ok: true } as unknown as ResponseFor<R>;
  }
}
