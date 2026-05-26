const listeners = new Set();
function dispatchInbound(eventJson) {
    try {
        const event = JSON.parse(eventJson);
        for (const l of listeners)
            l(event);
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.error("[Beat IPC] Bad inbound event", e, eventJson);
    }
}
// Wire up native subscription as soon as it's available.
let unsubscribe = null;
function ensureSubscribed() {
    if (unsubscribe)
        return;
    const native = window.__BEAT_NATIVE__;
    if (!native)
        return;
    unsubscribe = native.subscribe(dispatchInbound);
}
export async function send(request) {
    ensureSubscribed();
    const native = window.__BEAT_NATIVE__;
    if (native) {
        const { kind, ...payload } = request;
        return (await native.request(kind, payload));
    }
    return mockResponse(request);
}
export function onEvent(listener) {
    ensureSubscribed();
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function isNative() {
    return Boolean(window.__BEAT_NATIVE__);
}
// ----- Mock bridge (dev mode without backend) ---------------------------
async function mockResponse(req) {
    // eslint-disable-next-line no-console
    console.debug("[Beat IPC mock]", req.kind, req);
    switch (req.kind) {
        case "ping":
            return { pong: true, backendVersion: "mock" };
        case "project.list":
            return { projects: [] };
        case "project.load":
            return { project: null };
        case "project.exportWav":
            return { path: "/tmp/mock-export.wav" };
        case "instrument.list":
            return { instruments: [] };
        case "audio.import":
            return { file: null };
        case "audio.list":
            return { files: [] };
        default:
            return { ok: true };
    }
}
