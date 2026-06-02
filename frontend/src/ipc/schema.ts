/**
 * IPC schema — JS ↔ C++ message contract.
 *
 * IMPORTANT: keep this in sync with `backend/Source/Ipc/Schema.h`. The two
 * sides exchange JSON-encoded payloads keyed by the request `kind`. If you
 * add/change a kind here, mirror it there.
 */

import type {
  AudioFile,
  Beats,
  EqAutomationPoint,
  Id,
  Instrument,
  Project,
} from "../state/types";

export interface DecentSamplerImportSample {
  path: string;
  name: string;
  rootNote: number;
  loNote: number;
  hiNote: number;
  loVel: number;
  hiVel: number;
  volumeDb: number;
  pan: number;
  tuning: number;
  seqPosition: number;
}

export interface DecentSamplerImport {
  name: string;
  path: string;
  sampleUrls: string[];
  samples: DecentSamplerImportSample[];
  audioFiles: AudioFile[];
}

// ===== Outbound (JS → C++) =================================================

export type OutboundRequest =
  // Transport ---------------------------------------------------------------
  | { kind: "transport.play" }
  | { kind: "transport.pause" }
  | { kind: "transport.stop" }
  | { kind: "transport.restart" }
  | { kind: "transport.seek"; positionBeat: Beats }
  | { kind: "transport.setSpeed"; speed: number }
  | { kind: "transport.setLoop"; range: { startBeat: Beats; endBeat: Beats } | null }
  // Project / persistence ---------------------------------------------------
  | { kind: "project.save"; project: Project }
  | { kind: "project.load"; id: Id }
  | { kind: "project.list" }
  | { kind: "project.exportWav"; pathHint?: string }
  // Tracks / segments — the audio engine reflects these into its model -----
  | { kind: "engine.applyProject"; project: Project; instruments?: Instrument[] }
  | { kind: "engine.updateSegment"; segmentId: Id; patch: Partial<{ startBeat: Beats; lengthBeats: Beats; repeats: number; muted: boolean }> }
  | { kind: "engine.setParameter"; instrumentId: Id; parameterId: string; value: number; sampleOffset?: number; rampSamples?: number }
  // Instruments ------------------------------------------------------------
  | { kind: "instrument.save"; instrument: Instrument }
  | { kind: "instrument.delete"; id: Id }
  | { kind: "instrument.list" }
  | { kind: "instrument.importDecent"; pathHint?: string }
  // Audio files -----------------------------------------------------------
  | { kind: "audio.import"; pathHint?: string } // opens file picker
  | { kind: "audio.importMany"; pathHint?: string } // opens multi-file picker
  | { kind: "audio.list" }
  // EQ -------------------------------------------------------------------
  | { kind: "eq.setAutomation"; points: EqAutomationPoint[] }
  // Local AI training ------------------------------------------------------
  | { kind: "training.run"; task: "drums" | "instruments" | "midi"; jsonl: string; signalCount: number }
  // Misc -----------------------------------------------------------------
  | { kind: "ping" };

export type ResponseFor<R extends OutboundRequest> =
  R extends { kind: "project.list" }   ? { projects: Array<Pick<Project, "id" | "name" | "savedAt">> } :
  R extends { kind: "project.load" }   ? { project: Project | null } :
  R extends { kind: "project.exportWav" } ? { path: string } :
  R extends { kind: "instrument.list" }? { instruments: Instrument[] } :
  R extends { kind: "instrument.importDecent" } ? { preset: DecentSamplerImport | null } :
  R extends { kind: "audio.import" }   ? { file: AudioFile | null } :
  R extends { kind: "audio.importMany" } ? { files: AudioFile[] } :
  R extends { kind: "audio.list" }     ? { files: AudioFile[] } :
  R extends { kind: "training.run" }    ? { started: boolean; reason?: string } :
  R extends { kind: "ping" }           ? { pong: true; backendVersion: string } :
  { ok: true };

// ===== Inbound events (C++ → JS) ==========================================

export type InboundEvent =
  | { kind: "transport.positionChanged"; positionBeat: Beats }
  | { kind: "transport.playbackEnded" }
  | { kind: "engine.segmentTrigger"; segmentId: Id; repetition: number }
  | { kind: "engine.levelMeters"; tracks: Array<{ id: Id; rms: number; peak: number }> }
  | { kind: "analyzer.spectrum"; sequence: number; rms: number; peak: number; bands: number[] }
  | {
      kind: "engine.renderTiming";
      sequence: number;
      blockSamples: number;
      sampleRate: number;
      scheduleMs: number;
      synthMs: number;
      samplesMs: number;
      fxMs: number;
      analyzerMs: number;
      copyMs: number;
      totalMs: number;
      loadPercent: number;
    }
  | { kind: "audio.deviceChanged"; deviceName: string; sampleRate: number }
  | { kind: "training.status"; task: "drums" | "instruments" | "midi"; status: "started" | "finished" | "failed"; signalCount: number; message?: string; exitCode?: number }
  | { kind: "native.menuCommand"; command: "newProject" | "openProject" | "saveProject" | "importAudio" | "exportWav" | "preferences" }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string };

export type InboundListener = (event: InboundEvent) => void;
