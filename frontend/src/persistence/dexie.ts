import Dexie, { type Table } from "dexie";
import type { GeneratedInstrument, GenerateInstrumentOptions } from "../ai/aiService";
import type { DrumGenre, GeneratedDrumBeat, GenerateDrumBeatOptions } from "../ai/drumBeatGenerator";
import type { BeatComponent } from "../state/components";
import { normalizeAetherEffectPresetRecord, type AetherEffectPresetRecord } from "../state/effectPresets";
import { normalizeSynthPresetRecord, type SynthPresetRecord } from "../state/synthPresets";
import type { AudioFile, Instrument, InstrumentSet, MidiNote, Project, Segment } from "../state/types";

export interface DrumBeatFeedback {
  id: string;
  genre: DrumGenre;
  rating?: "up" | "down";
  modelBeat: GeneratedDrumBeat;
  finalBeat?: GeneratedDrumBeat;
  prompt?: string;
  model?: string;
  source?: GeneratedDrumBeat["source"];
  userFeedback?: string;
  savedAsComponent?: boolean;
  acceptedEdit?: boolean;
  context: Omit<GenerateDrumBeatOptions, "instruments" | "feedbackExamples"> & {
    instrumentIds: string[];
  };
  createdAt: number;
  updatedAt?: number;
}

export interface InstrumentGenerationFeedback {
  id: string;
  prompt: string;
  rating?: "up" | "down";
  generated: GeneratedInstrument;
  finalInstrument?: Instrument;
  context: Pick<GenerateInstrumentOptions, "prompt"> & {
    currentInstrumentId: string;
    instrumentIds: string[];
    audioFileIds: string[];
    targetKind?: Instrument["kind"];
    variationSeed?: number;
  };
  createdAt: number;
  updatedAt?: number;
}

export interface MidiSongFeedback {
  id: string;
  prompt: string;
  rating?: "up" | "down";
  modelOutput: MidiSongTrainingOutput;
  finalOutput?: MidiSongTrainingOutput;
  userFeedback?: string;
  context: MidiSongTrainingContext;
  createdAt: number;
  updatedAt?: number;
}

export interface MidiSongTrainingContext {
  style?: string;
  bpm: number;
  timeSignature: Project["timeSignature"];
  lengthBeats: number;
  instruments: Array<{
    id?: string;
    name: string;
    kind?: Instrument["kind"];
    descriptors?: string[];
  }>;
}

export interface MidiSongTrainingOutput {
  sections: Array<{
    role: "melody" | "bass" | "chords" | "countermelody" | "arp" | "fx";
    instrumentId?: string;
    instrumentName?: string;
    startBeat: number;
    lengthBeats: number;
    notes: MidiNote[];
  }>;
}

export interface TrainingSignalStats {
  drums: number;
  instruments: number;
  midi: number;
}

/**
 * Dexie/IndexedDB schema.
 *
 * Local cache mirror of project data. The authoritative source is SQLite
 * on the backend (via the JUCE IPC bridge). Dexie holds:
 *  - recent projects for offline / instant-load
 *  - the user-built instrument library
 *  - cached audio file metadata
 *
 * The backend can push deltas via IPC; the frontend writes through here
 * and the bridge replicates to SQLite. See ipc/bridge.ts for the channel.
 */
export class BeatDB extends Dexie {
  projects!: Table<Project, string>;
  instruments!: Table<Instrument, string>;
  instrumentSets!: Table<InstrumentSet, string>;
  audioFiles!: Table<AudioFile, string>;
  components!: Table<BeatComponent, string>;
  drumBeatFeedback!: Table<DrumBeatFeedback, string>;
  instrumentGenerationFeedback!: Table<InstrumentGenerationFeedback, string>;
  midiSongFeedback!: Table<MidiSongFeedback, string>;
  synthPresets!: Table<SynthPresetRecord, string>;
  effectPresets!: Table<AetherEffectPresetRecord, string>;

  constructor() {
    super("beat");
    this.version(1).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated",
      audioFiles: "id, name, path",
    });
    this.version(2).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
    });
    this.version(3).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated, setId",
      instrumentSets: "id, name, factory",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
    });
    this.version(4).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated, setId",
      instrumentSets: "id, name, factory",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
      drumBeatFeedback: "id, genre, rating, createdAt",
    });
    this.version(5).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated, setId",
      instrumentSets: "id, name, factory",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
      drumBeatFeedback: "id, genre, rating, createdAt",
      instrumentGenerationFeedback: "id, rating, createdAt",
    });
    this.version(6).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated, setId",
      instrumentSets: "id, name, factory",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
      drumBeatFeedback: "id, genre, rating, createdAt",
      instrumentGenerationFeedback: "id, rating, createdAt",
      midiSongFeedback: "id, rating, createdAt",
    });
    this.version(7).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated, setId",
      instrumentSets: "id, name, factory",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
      drumBeatFeedback: "id, genre, rating, createdAt",
      instrumentGenerationFeedback: "id, rating, createdAt",
      midiSongFeedback: "id, rating, createdAt",
      synthPresets: "id, name, updatedAt",
    });
    this.version(8).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated, setId",
      instrumentSets: "id, name, factory",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
      drumBeatFeedback: "id, genre, rating, createdAt",
      instrumentGenerationFeedback: "id, rating, createdAt",
      midiSongFeedback: "id, rating, createdAt",
      synthPresets: "id, kind, name, updatedAt",
    });
    this.version(9).stores({
      projects: "id, name, savedAt",
      instruments: "id, name, userCreated, setId",
      instrumentSets: "id, name, factory",
      audioFiles: "id, name, path",
      components: "id, name, kind, factory, createdAt",
      drumBeatFeedback: "id, genre, rating, createdAt",
      instrumentGenerationFeedback: "id, rating, createdAt",
      midiSongFeedback: "id, rating, createdAt",
      synthPresets: "id, kind, name, updatedAt",
      effectPresets: "id, kind, name, updatedAt",
    });
  }
}

export const db = new BeatDB();

export async function saveProject(project: Project) {
  await db.projects.put({ ...project, savedAt: Date.now() });
}

export async function pruneBlankUntitledProjects(): Promise<number> {
  return db.projects
    .filter((project) => isBlankUntitledProject(project))
    .delete();
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

export async function listProjects(): Promise<Project[]> {
  return db.projects.orderBy("savedAt").reverse().toArray();
}

function isBlankUntitledProject(project: Project): boolean {
  if ((project.name || "Untitled").trim() !== "Untitled") return false;
  if (project.masterEqAutomation?.length) return false;
  if (!Array.isArray(project.tracks) || project.tracks.length !== 1) return false;
  const track = project.tracks[0];
  if ((track.name || "Track").trim() !== "Track") return false;
  if (track.segments.length > 0) return false;
  if (track.effects.filters.length > 0) return false;
  return track.gainDb === 0
    && track.pan === 0
    && !track.mute
    && !track.solo;
}

export async function saveInstruments(instruments: Instrument[], sets: InstrumentSet[]) {
  await db.transaction("rw", db.instruments, db.instrumentSets, async () => {
    await db.instruments.clear();
    await db.instrumentSets.clear();
    if (instruments.length > 0) await db.instruments.bulkPut(instruments);
    if (sets.length > 0) await db.instrumentSets.bulkPut(sets);
  });
}

export async function listInstruments(): Promise<{ instruments: Instrument[]; sets: InstrumentSet[] }> {
  const [instruments, sets] = await Promise.all([
    db.instruments.toArray(),
    db.instrumentSets.toArray(),
  ]);
  return { instruments, sets };
}

export async function saveSynthPreset(record: SynthPresetRecord) {
  const normalized = normalizeSynthPresetRecord(record);
  if (!normalized) throw new Error("Synth preset is missing a patch.");
  await db.synthPresets.put(normalized);
}

export async function listSynthPresets(): Promise<SynthPresetRecord[]> {
  const records = await db.synthPresets.orderBy("updatedAt").reverse().toArray();
  return records
    .map(normalizeSynthPresetRecord)
    .filter((record): record is SynthPresetRecord => record !== null);
}

export async function deleteSynthPreset(id: string) {
  await db.synthPresets.delete(id);
}

export async function saveAetherEffectPreset(record: AetherEffectPresetRecord) {
  const normalized = normalizeAetherEffectPresetRecord(record);
  if (!normalized) throw new Error("Aether effect preset is missing an effect chain.");
  await db.effectPresets.put(normalized);
}

export async function listAetherEffectPresets(): Promise<AetherEffectPresetRecord[]> {
  const records = await db.effectPresets.orderBy("updatedAt").reverse().toArray();
  return records
    .map(normalizeAetherEffectPresetRecord)
    .filter((record): record is AetherEffectPresetRecord => record !== null);
}

export async function deleteAetherEffectPreset(id: string) {
  await db.effectPresets.delete(id);
}

export async function saveAudioFiles(files: AudioFile[]) {
  await db.audioFiles.clear();
  if (files.length > 0) await db.audioFiles.bulkPut(files);
}

export async function listAudioFiles(): Promise<AudioFile[]> {
  return db.audioFiles.orderBy("name").toArray();
}

export async function saveComponents(components: BeatComponent[]) {
  await db.components.clear();
  if (components.length > 0) await db.components.bulkPut(components);
}

export async function listComponents(): Promise<BeatComponent[]> {
  return db.components.orderBy("createdAt").reverse().toArray();
}

export async function saveDrumBeatFeedback(feedback: DrumBeatFeedback) {
  await db.drumBeatFeedback.put(feedback);
}

export async function updateDrumBeatFeedback(id: string, patch: Partial<DrumBeatFeedback>) {
  await db.drumBeatFeedback.update(id, { ...patch, updatedAt: Date.now() });
}

export async function listDrumBeatFeedback(limit = 20): Promise<DrumBeatFeedback[]> {
  return db.drumBeatFeedback.orderBy("createdAt").reverse().limit(limit).toArray();
}

export async function exportDrumBeatFineTuneJsonl(): Promise<string> {
  const rows = await db.drumBeatFeedback
    .orderBy("createdAt")
    .toArray();
  return rows
    .filter((entry) => entry.finalBeat || entry.rating)
    .map((entry) => JSON.stringify({
      instruction: "Generate an editable drum beat for Beat using the provided JSON schema and instrument context.",
      input: JSON.stringify({
        genre: entry.genre,
        context: entry.context,
        prompt: entry.prompt,
        sourceModel: entry.model,
        source: entry.source,
        rating: entry.rating,
        savedAsComponent: Boolean(entry.savedAsComponent),
        acceptedEdit: Boolean(entry.acceptedEdit),
        modelOutput: entry.modelBeat,
      }),
      output: JSON.stringify(entry.finalBeat ?? entry.modelBeat),
    }))
    .join("\n");
}

export async function saveInstrumentGenerationFeedback(feedback: InstrumentGenerationFeedback) {
  await db.instrumentGenerationFeedback.put(feedback);
}

export async function updateInstrumentGenerationFeedback(id: string, patch: Partial<InstrumentGenerationFeedback>) {
  await db.instrumentGenerationFeedback.update(id, { ...patch, updatedAt: Date.now() });
}

export async function listInstrumentGenerationFeedback(limit = 20): Promise<InstrumentGenerationFeedback[]> {
  return db.instrumentGenerationFeedback.orderBy("createdAt").reverse().limit(limit).toArray();
}

export async function exportInstrumentFineTuneJsonl(): Promise<string> {
  const rows = await db.instrumentGenerationFeedback.orderBy("createdAt").toArray();
  return rows
    .filter((entry) => entry.finalInstrument || entry.rating)
    .map((entry) => JSON.stringify({
      instruction: "Generate an editable Beat instrument patch using the provided schema, ranges, and available sample sources.",
      input: JSON.stringify({
        prompt: entry.prompt,
        context: entry.context,
        rating: entry.rating,
        generatedPatch: entry.generated,
      }),
      output: JSON.stringify(entry.finalInstrument ?? entry.generated.patch),
    }))
    .join("\n");
}

export async function saveMidiSongFeedback(feedback: MidiSongFeedback) {
  await db.midiSongFeedback.put(feedback);
}

export async function updateMidiSongFeedback(id: string, patch: Partial<MidiSongFeedback>) {
  await db.midiSongFeedback.update(id, { ...patch, updatedAt: Date.now() });
}

export async function listMidiSongFeedback(limit = 20): Promise<MidiSongFeedback[]> {
  return db.midiSongFeedback.orderBy("createdAt").reverse().limit(limit).toArray();
}

export async function exportMidiSongFineTuneJsonl(): Promise<string> {
  const [projects, components, instruments, feedback] = await Promise.all([
    db.projects.toArray(),
    db.components.toArray(),
    db.instruments.toArray(),
    db.midiSongFeedback.orderBy("createdAt").toArray(),
  ]);
  const instrumentMap = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const rows: string[] = [];

  for (const component of components) {
    if ((component.kind ?? "midi") !== "midi" || !("notes" in component) || component.notes.length === 0) continue;
    const instrument = component.instrumentId ? instrumentMap.get(component.instrumentId) : undefined;
    rows.push(JSON.stringify({
      instruction: "Generate editable MIDI song parts for Beat. Split the answer into contextual parts such as melody, bass, chords, countermelody, arp, or fx.",
      input: JSON.stringify({
        source: "component",
        componentName: component.name,
        context: {
          style: component.name,
          bpm: 120,
          timeSignature: { num: 4, denom: 4, boldBeats: [1] },
          lengthBeats: component.lengthBeats,
          instruments: [summarizeInstrumentForMidi(instrument, component.instrumentId)],
        } satisfies MidiSongTrainingContext,
      }),
      output: JSON.stringify({
        sections: [{
          role: inferMidiRole(component.name, instrument, component.notes),
          instrumentId: component.instrumentId,
          instrumentName: instrument?.name,
          startBeat: 0,
          lengthBeats: component.lengthBeats,
          notes: normalizeMidiNotes(component.notes),
        }],
      } satisfies MidiSongTrainingOutput),
    }));
  }

  for (const project of projects) {
    const sections = collectProjectMidiSections(project, instrumentMap);
    if (sections.length === 0) continue;
    rows.push(JSON.stringify({
      instruction: "Generate editable MIDI song parts for Beat. Split the answer into contextual parts such as melody, bass, chords, countermelody, arp, or fx.",
      input: JSON.stringify({
        source: "project",
        projectName: project.name,
        context: {
          style: project.name,
          bpm: project.bpm,
          timeSignature: project.timeSignature,
          lengthBeats: project.lengthBeats,
          instruments: uniqueInstrumentsForSections(sections, instrumentMap),
        } satisfies MidiSongTrainingContext,
      }),
      output: JSON.stringify({ sections } satisfies MidiSongTrainingOutput),
    }));
  }

  for (const entry of feedback) {
    if (!entry.finalOutput && !entry.rating) continue;
    rows.push(JSON.stringify({
      instruction: "Generate editable MIDI song parts for Beat using the provided JSON schema and musical context.",
      input: JSON.stringify({
        prompt: entry.prompt,
        context: entry.context,
        rating: entry.rating,
        userFeedback: entry.userFeedback,
        modelOutput: entry.modelOutput,
      }),
      output: JSON.stringify(entry.finalOutput ?? entry.modelOutput),
    }));
  }

  return rows.join("\n");
}

export async function getTrainingSignalStats(): Promise<TrainingSignalStats> {
  const [drums, instruments, midi] = await Promise.all([
    db.drumBeatFeedback.toArray(),
    db.instrumentGenerationFeedback.toArray(),
    db.midiSongFeedback.toArray(),
  ]);
  return {
    drums: drums.filter((entry) => entry.rating || entry.finalBeat || entry.savedAsComponent || entry.acceptedEdit).length,
    instruments: instruments.filter((entry) => entry.rating || entry.finalInstrument).length,
    midi: midi.filter((entry) => entry.rating || entry.finalOutput).length,
  };
}

function collectProjectMidiSections(
  project: Project,
  instrumentMap: Map<string, Instrument>,
): MidiSongTrainingOutput["sections"] {
  const sections: MidiSongTrainingOutput["sections"] = [];
  for (const track of project.tracks) {
    for (const segment of track.segments) {
      const notes = notesForSegment(segment);
      if (notes.length === 0) continue;
      const instrument = segment.instrumentId ? instrumentMap.get(segment.instrumentId) : track.instrumentId ? instrumentMap.get(track.instrumentId) : undefined;
      sections.push({
        role: inferMidiRole(`${track.name} ${segment.name ?? ""}`, instrument, notes),
        instrumentId: segment.instrumentId ?? track.instrumentId,
        instrumentName: instrument?.name,
        startBeat: segment.startBeat,
        lengthBeats: segment.lengthBeats,
        notes: normalizeMidiNotes(notes),
      });
    }
  }
  return sections;
}

function notesForSegment(segment: Segment): MidiNote[] {
  if (segment.payload.kind === "midi" || segment.payload.kind === "mixed") return segment.payload.notes;
  return [];
}

function normalizeMidiNotes(notes: MidiNote[]): MidiNote[] {
  return notes
    .filter((note) => Number.isFinite(note.pitch) && Number.isFinite(note.startBeat) && Number.isFinite(note.lengthBeats))
    .map((note) => ({
      pitch: Math.max(0, Math.min(127, Math.round(note.pitch))),
      velocity: Math.max(0, Math.min(127, Math.round(note.velocity))),
      startBeat: roundBeat(note.startBeat),
      lengthBeats: roundBeat(Math.max(0.03125, note.lengthBeats)),
      ...(note.frequencyHz ? { frequencyHz: note.frequencyHz } : {}),
      ...(note.connectToIndex != null ? { connectToIndex: note.connectToIndex } : {}),
      ...(note.curve ? { curve: note.curve.map((point) => ({ beat: roundBeat(point.beat), pitch: roundPitch(point.pitch) })) } : {}),
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}

function inferMidiRole(label: string, instrument: Instrument | undefined, notes: MidiNote[]): MidiSongTrainingOutput["sections"][number]["role"] {
  const lower = `${label} ${instrument?.name ?? ""} ${instrument?.descriptors?.join(" ") ?? ""}`.toLowerCase();
  if (/\b(bass|sub|808|low)\b/.test(lower)) return "bass";
  if (/\b(chord|pad|keys|piano|organ)\b/.test(lower)) return "chords";
  if (/\b(arp|arpeggio|sequence)\b/.test(lower)) return "arp";
  if (/\b(fx|riser|noise|impact)\b/.test(lower)) return "fx";
  const avgPitch = notes.reduce((sum, note) => sum + note.pitch, 0) / Math.max(1, notes.length);
  const simultaneity = maxNotesAtSameStart(notes);
  if (avgPitch < 48) return "bass";
  if (simultaneity >= 3) return "chords";
  if (avgPitch > 72 && notes.length > 6) return "countermelody";
  return "melody";
}

function maxNotesAtSameStart(notes: MidiNote[]): number {
  const starts = new Map<number, number>();
  for (const note of notes) {
    const key = roundBeat(note.startBeat);
    starts.set(key, (starts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...starts.values());
}

function uniqueInstrumentsForSections(
  sections: MidiSongTrainingOutput["sections"],
  instrumentMap: Map<string, Instrument>,
): MidiSongTrainingContext["instruments"] {
  const ids = new Set(sections.map((section) => section.instrumentId).filter((id): id is string => Boolean(id)));
  return Array.from(ids).map((id) => summarizeInstrumentForMidi(instrumentMap.get(id), id));
}

function summarizeInstrumentForMidi(instrument: Instrument | undefined, fallbackId?: string): MidiSongTrainingContext["instruments"][number] {
  return {
    id: instrument?.id ?? fallbackId,
    name: instrument?.name ?? "Unassigned",
    kind: instrument?.kind,
    descriptors: instrument?.descriptors,
  };
}

function roundBeat(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundPitch(value: number): number {
  return Math.round(Math.max(0, Math.min(127, value)) * 100) / 100;
}
