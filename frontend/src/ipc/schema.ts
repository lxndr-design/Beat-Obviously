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

// ===== Outbound (JS → C++) =================================================

export type OutboundRequest =
  // Transport ---------------------------------------------------------------
  | { kind: "transport.play" }
  | { kind: "transport.pause" }
  | { kind: "transport.stop" }
  | { kind: "transport.seek"; positionBeat: Beats }
  | { kind: "transport.setSpeed"; speed: number }
  | { kind: "transport.setLoop"; range: { startBeat: Beats; endBeat: Beats } | null }
  // Project / persistence ---------------------------------------------------
  | { kind: "project.save"; project: Project }
  | { kind: "project.load"; id: Id }
  | { kind: "project.list" }
  | { kind: "project.exportWav"; pathHint?: string }
  // Tracks / segments — the audio engine reflects these into its model -----
  | { kind: "engine.applyProject"; project: Project }
  | { kind: "engine.updateSegment"; segmentId: Id; patch: Partial<{ startBeat: Beats; lengthBeats: Beats; repeats: number; muted: boolean }> }
  // Instruments ------------------------------------------------------------
  | { kind: "instrument.save"; instrument: Instrument }
  | { kind: "instrument.delete"; id: Id }
  | { kind: "instrument.list" }
  // Audio files -----------------------------------------------------------
  | { kind: "audio.import"; pathHint?: string } // opens file picker
  | { kind: "audio.list" }
  // EQ -------------------------------------------------------------------
  | { kind: "eq.setAutomation"; points: EqAutomationPoint[] }
  // Misc -----------------------------------------------------------------
  | { kind: "ping" };

export type ResponseFor<R extends OutboundRequest> =
  R extends { kind: "project.list" }   ? { projects: Array<Pick<Project, "id" | "name" | "savedAt">> } :
  R extends { kind: "project.load" }   ? { project: Project | null } :
  R extends { kind: "project.exportWav" } ? { path: string } :
  R extends { kind: "instrument.list" }? { instruments: Instrument[] } :
  R extends { kind: "audio.import" }   ? { file: AudioFile | null } :
  R extends { kind: "audio.list" }     ? { files: AudioFile[] } :
  R extends { kind: "ping" }           ? { pong: true; backendVersion: string } :
  { ok: true };

// ===== Inbound events (C++ → JS) ==========================================

export type InboundEvent =
  | { kind: "transport.positionChanged"; positionBeat: Beats }
  | { kind: "transport.playbackEnded" }
  | { kind: "engine.segmentTrigger"; segmentId: Id; repetition: number }
  | { kind: "engine.levelMeters"; tracks: Array<{ id: Id; rms: number; peak: number }> }
  | { kind: "audio.deviceChanged"; deviceName: string; sampleRate: number }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string };

export type InboundListener = (event: InboundEvent) => void;
