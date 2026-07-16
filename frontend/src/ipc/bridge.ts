import type {
  InboundEvent,
  InboundListener,
  OutboundRequest,
  ResponseFor,
} from "./schema";

/**
 * IPC bridge to the JUCE C++ backend.
 *
 * In production, the Solid app runs inside a juce::WebBrowserComponent
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
    case "project.saveFile":
      return {
        path: "/tmp/mock.beat",
        cleanupReport: { deletedFiles: 0, failedFiles: 0, deletedPaths: [], failedPaths: [] },
        integrityReport: { ok: true, errorCount: 0, warningCount: 0, issues: [] },
      } as unknown as ResponseFor<R>;
    case "project.openFile":
      return { path: "", error: "Project files are only available in the native app." } as unknown as ResponseFor<R>;
    case "project.recentList":
      return { projects: [] } as unknown as ResponseFor<R>;
    case "project.recentRemove":
      return { ok: true } as unknown as ResponseFor<R>;
    case "project.revealFile":
      return { ok: false, missing: true, error: "View in Folder is only available in the native app." } as unknown as ResponseFor<R>;
    case "project.inspectDocument":
      return {
        path: "",
        missingAssets: [],
        integrityReport: { ok: true, errorCount: 0, warningCount: 0, issues: [] },
      } as unknown as ResponseFor<R>;
    case "project.repairDocument":
      return {
        changed: false,
        document: req.document,
        path: "",
        missingAssets: [],
        integrityReport: { ok: true, errorCount: 0, warningCount: 0, issues: [] },
      } as unknown as ResponseFor<R>;
    case "project.listBackups":
      return { backups: [] } as unknown as ResponseFor<R>;
    case "project.restoreBackup":
      return { path: "", error: "Project backup restore is only available in the native app." } as unknown as ResponseFor<R>;
    case "project.relinkAsset":
      return { path: "" } as unknown as ResponseFor<R>;
    case "project.cleanupAssets":
      return {
        report: { deletedFiles: 0, failedFiles: 0, deletedPaths: [], failedPaths: [] },
      } as unknown as ResponseFor<R>;
    case "project.exportWav":
      return { path: "/tmp/mock-export.wav" } as unknown as ResponseFor<R>;
    case "project.exportTrackWav":
      return { path: "/tmp/mock-track-export.wav" } as unknown as ResponseFor<R>;
    case "project.exportRangeWav":
      return { path: "/tmp/mock-range-export.wav" } as unknown as ResponseFor<R>;
    case "project.bounceTrackWav":
      return { path: "/tmp/mock-track-bounce.wav" } as unknown as ResponseFor<R>;
    case "project.exportWavAsync":
    case "project.exportTrackWavAsync":
    case "project.exportRangeWavAsync":
    case "project.exportAllTrackWavsAsync":
      return {
        started: true,
        job: {
          active: false,
          finished: true,
          ok: true,
          jobId: "mock-export",
          type: req.kind === "project.exportTrackWavAsync"
            ? "track"
            : req.kind === "project.exportRangeWavAsync"
              ? "range"
              : req.kind === "project.exportAllTrackWavsAsync"
                ? "stems"
                : "project",
          path: req.kind === "project.exportAllTrackWavsAsync" ? "/tmp/mock-stems" : "/tmp/mock-export.wav",
          progress: 1,
          samplesWritten: 1,
          totalSamples: 1,
        },
      } as unknown as ResponseFor<R>;
    case "project.exportCancel":
    case "project.exportStatus":
      return {
        active: false,
        finished: true,
        ok: false,
        path: "",
        progress: 0,
      } as unknown as ResponseFor<R>;
    case "instrument.list":
      return { instruments: [] } as unknown as ResponseFor<R>;
    case "instrument.importDecent":
      return { preset: null } as unknown as ResponseFor<R>;
    case "instrument.importSfz":
      return { error: "SFZ import is only available in the native app." } as unknown as ResponseFor<R>;
    case "instrument.renderPreview":
      return {
        waveform: {
          left: { upper: [], lower: [] },
          right: { upper: [], lower: [] },
          sampleRate: 0,
          durationSeconds: 0,
          lengthInSamples: 0,
          channelCount: 0,
          bucketCount: req.bucketCount ?? 256,
        },
        durationBeats: req.durationBeats ?? 2,
        note: req.note ?? 60,
        velocity: req.velocity ?? 100,
      } as unknown as ResponseFor<R>;
    case "instrument.resynthesizeWavemap":
      return { error: "Native wavemap resynthesis is only available in the packaged app." } as unknown as ResponseFor<R>;
    case "audio.import":
      return { file: null } as unknown as ResponseFor<R>;
    case "audio.importMany":
      return { files: [] } as unknown as ResponseFor<R>;
    case "audio.list":
      return { files: [] } as unknown as ResponseFor<R>;
    case "audio.delete":
      return { deletedIds: req.ids, failedIds: [], failedPaths: [] } as unknown as ResponseFor<R>;
    case "audio.reveal":
      return { ok: false, error: "View in Folder is only available in the native app." } as unknown as ResponseFor<R>;
    case "audio.waveform":
      return {
        waveform: {
          left: { upper: [], lower: [] },
          right: { upper: [], lower: [] },
          sampleRate: 0,
          durationSeconds: 0,
          lengthInSamples: 0,
          channelCount: 0,
          bucketCount: req.bucketCount ?? 256,
        },
      } as unknown as ResponseFor<R>;
    case "audio.listDevices":
      return {
        snapshot: {
          currentTypeName: "Mock",
          currentInputName: "",
          currentOutputName: "Mock Output",
          sampleRate: 48000,
          bufferSize: 512,
          inputLatencySamples: 0,
          outputLatencySamples: 0,
          inputChannelNames: [],
          outputChannelNames: ["L", "R"],
          devices: [
            {
              typeName: "Mock",
              name: "Mock Output",
              input: false,
              output: true,
              currentInput: false,
              currentOutput: true,
            },
          ],
        },
      } as unknown as ResponseFor<R>;
    case "audio.selectInputDevice":
      return {
        ok: false,
        error: "Input device selection is only available in the native app.",
        snapshot: {
          currentTypeName: "Mock",
          currentInputName: "",
          currentOutputName: "Mock Output",
          sampleRate: 48000,
          bufferSize: 512,
          inputLatencySamples: 0,
          outputLatencySamples: 0,
          inputChannelNames: [],
          outputChannelNames: ["L", "R"],
          devices: [],
        },
      } as unknown as ResponseFor<R>;
    case "audio.selectOutputDevice":
      return {
        ok: false,
        error: "Output device selection is only available in the native app.",
        snapshot: {
          currentTypeName: "Mock",
          currentInputName: "",
          currentOutputName: "Mock Output",
          sampleRate: 48000,
          bufferSize: 512,
          inputLatencySamples: 0,
          outputLatencySamples: 0,
          inputChannelNames: [],
          outputChannelNames: ["L", "R"],
          devices: [],
        },
      } as unknown as ResponseFor<R>;
    case "training.run":
      return {
        started: false,
        reason: "Training runner is only available in the native app.",
      } as unknown as ResponseFor<R>;
    default:
      return { ok: true } as unknown as ResponseFor<R>;
  }
}
