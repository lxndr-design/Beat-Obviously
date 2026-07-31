import { createStore as create } from "zustand/vanilla";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type { DrumRow, DrumSpeed, DrumStep, Id, Instrument, MidiNote, TimeSignature } from "./types";

/**
 * MidiComponent — a reusable MIDI pattern saved from a segment.
 *
 * Components live in the sidebar's "Components" section and can be dragged
 * onto track lanes to spawn a new MIDI segment with the same notes and
 * expression. MIDI components are portable performance data and never own an
 * instrument selection.
 */
export interface MidiComponent {
  id: Id;
  kind?: "midi";
  name: string;
  notes: MidiNote[];
  lengthBeats: number;
  /** Legacy field accepted during hydration; normalized patterns discard it. */
  instrumentId?: Id;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  factory?: boolean;
  folderId?: Id;
}

export interface DrumComponent {
  id: Id;
  kind: "drum";
  name: string;
  rows: DrumRow[];
  stepCount: number;
  speed: DrumSpeed;
  lengthBeats: number;
  defaultPitchHz?: number;
  swingPercent?: number;
  timeSignature?: TimeSignature;
  createdAt: number;
  factory?: boolean;
  folderId?: Id;
}

export type BeatComponent = MidiComponent | DrumComponent;
export interface ComponentFolder {
  id: Id;
  name: string;
  factory?: boolean;
}

export const FACTORY_COMPONENT_FOLDER_ID = "factory-components";
export const USER_COMPONENT_FOLDER_ID = "user-components";

function defaultComponentFolders(): ComponentFolder[] {
  return [
    { id: FACTORY_COMPONENT_FOLDER_ID, name: "Factory", factory: true },
    { id: USER_COMPONENT_FOLDER_ID, name: "User" },
  ];
}
type ComponentInput =
  | Omit<MidiComponent, "id" | "createdAt">
  | Omit<DrumComponent, "id" | "createdAt">;

interface ComponentSlice {
  components: BeatComponent[];
  componentFolders: ComponentFolder[];
  add: (c: ComponentInput) => Id;
  hydrate: (components: BeatComponent[], folders?: ComponentFolder[]) => void;
  seedDefaultDrumLoops: (instruments: Instrument[]) => void;
  update: (id: Id, patch: Partial<Omit<MidiComponent, "id" | "createdAt">> | Partial<Omit<DrumComponent, "id" | "createdAt">>) => void;
  remove: (id: Id) => void;
  rename: (id: Id, name: string) => void;
  addFolder: (name?: string) => Id;
  renameFolder: (id: Id, name: string) => void;
  ungroupFolder: (id: Id) => void;
  moveToFolder: (id: Id, folderId: Id, beforeComponentId?: Id | null) => void;
}

export const useComponentStore = create<ComponentSlice>()(
  immer((set) => ({
    components: [],
    componentFolders: defaultComponentFolders(),
    add: (c) => {
      const id = nanoid();
      set((s) => {
        if (c.kind === "drum") {
          s.components.unshift({
            id,
            createdAt: Date.now(),
            folderId: USER_COMPONENT_FOLDER_ID,
            ...c,
            rows: structuredClone(c.rows),
          });
          return;
        }
        const midi = { ...(c as Omit<MidiComponent, "id" | "createdAt">) };
        delete midi.instrumentId;
        s.components.unshift({
          id,
          createdAt: Date.now(),
          folderId: USER_COMPONENT_FOLDER_ID,
          ...midi,
          kind: "midi",
          notes: normalizeMidiPatternNotes(midi.notes),
        });
      });
      return id;
    },
    hydrate: (components, folders) =>
      set((s) => {
        const factory = s.components.filter((component) => component.factory);
        const user = components
          .filter((component) => !component.factory)
          .map((component) => normalizeComponentFolder(component));
        s.components = [...user, ...factory];
        const defaults = defaultComponentFolders();
        const custom = (folders ?? []).filter((folder) => !defaults.some((item) => item.id === folder.id));
        s.componentFolders = [...defaults, ...custom];
      }),
    seedDefaultDrumLoops: (instruments) =>
      set((s) => {
        s.components = [
          ...s.components.filter((component) => !(component.factory && component.kind === "drum")),
          ...makeFactoryDrumLoops(instruments),
        ];
      }),
    update: (id, patch) =>
      set((s) => {
        const index = s.components.findIndex((component) => component.id === id);
        if (index < 0) return;
        const current = s.components[index];
        if ((current.kind ?? "midi") === "drum") {
          const next = {
            ...(current as DrumComponent),
            ...(patch as Partial<DrumComponent>),
            rows: structuredClone((patch as Partial<DrumComponent>).rows ?? (current as DrumComponent).rows),
          };
          s.components[index] = next;
          return;
        }
        const next = {
          ...(current as MidiComponent),
          ...(patch as Partial<MidiComponent>),
          notes: normalizeMidiPatternNotes((patch as Partial<MidiComponent>).notes ?? (current as MidiComponent).notes),
        };
        delete next.instrumentId;
        s.components[index] = next;
      }),
    remove: (id) =>
      set((s) => {
        s.components = s.components.filter((c) => c.id !== id);
      }),
    rename: (id, name) =>
      set((s) => {
        const c = s.components.find((x) => x.id === id);
        if (c) c.name = name;
      }),
    addFolder: (name) => {
      const id = nanoid();
      set((s) => {
        const count = s.componentFolders.filter((folder) => !folder.factory && folder.id !== USER_COMPONENT_FOLDER_ID).length + 1;
        s.componentFolders.push({ id, name: name?.trim() || `Folder ${count}` });
      });
      return id;
    },
    renameFolder: (id, name) =>
      set((s) => {
        const folder = s.componentFolders.find((candidate) => candidate.id === id);
        const next = name.trim();
        if (!folder || folder.factory || id === USER_COMPONENT_FOLDER_ID || !next) return;
        folder.name = next.slice(0, 48);
      }),
    ungroupFolder: (id) =>
      set((s) => {
        const folder = s.componentFolders.find((candidate) => candidate.id === id);
        if (!folder || folder.factory || id === USER_COMPONENT_FOLDER_ID) return;
        for (const component of s.components) {
          if (component.folderId === id) component.folderId = USER_COMPONENT_FOLDER_ID;
        }
        s.componentFolders = s.componentFolders.filter((candidate) => candidate.id !== id);
      }),
    moveToFolder: (id, folderId, beforeComponentId) =>
      set((s) => {
        const moving = s.components.find((component) => component.id === id);
        if (!moving || !s.componentFolders.some((folder) => folder.id === folderId)) return;
        moving.folderId = folderId;
        s.components = s.components.filter((component) => component.id !== id);
        const targetIndex = beforeComponentId
          ? s.components.findIndex((component) => component.id === beforeComponentId)
          : -1;
        if (targetIndex >= 0) s.components.splice(targetIndex, 0, moving);
        else s.components.push(moving);
      }),
  })),
);

function normalizeComponentFolder(component: BeatComponent): BeatComponent {
  if (component.kind === "drum") {
    return { ...component, folderId: component.folderId ?? USER_COMPONENT_FOLDER_ID };
  }
  const normalized = { ...component, kind: "midi" as const, folderId: component.folderId ?? USER_COMPONENT_FOLDER_ID };
  delete normalized.instrumentId;
  normalized.notes = normalizeMidiPatternNotes(component.notes);
  return normalized;
}

export function normalizeMidiPatternNotes(notes: MidiNote[]): MidiNote[] {
  return notes.map((note) => {
    const portable = structuredClone(note);
    delete portable.frequencyHz;
    delete portable.sampleZoneId;
    delete portable.samplePath;
    delete portable.sampleLabel;
    return portable;
  });
}

function makeFactoryDrumLoops(instruments: Instrument[]): DrumComponent[] {
  const pick = (...names: string[]) =>
    names
      .map((name) => instruments.find((instrument) => instrument.name.toLowerCase() === name.toLowerCase()))
      .find(Boolean) ?? instruments[0];
  const pearlKick = pick("Pearl Kick", "Basic Kick", "LM-2 Kick", "Sub Kick (Synth)");
  const pearlSnare = pick("Pearl Snare", "Snap Snare", "LM-2 Snare");
  const pearlHat = pick("Pearl Closed Hat", "Closed Hat", "LM-2 Closed Hat");
  const pearlOpenHat = pick("Pearl Open Hat", "Open Hat", "LM-2 Open Hat");
  const pearlRide = pick("Pearl Ride", "LM-2 Ride", "TR-505 Ride");
  const pearlCrash = pick("Pearl Crash", "LM-2 Crash", "TR-505 Crash");
  const lmKick = pick("LM-2 Kick", "Pearl Kick", "Sub Kick (Synth)");
  const lmSnare = pick("LM-2 Snare", "Pearl Snare", "Snap Snare");
  const lmHat = pick("LM-2 Closed Hat", "Pearl Closed Hat", "Closed Hat");
  const lmOpenHat = pick("LM-2 Open Hat", "Pearl Open Hat", "Open Hat");
  const lmClap = pick("LM-2 Clap", "TR-505 Clap", "Snap Snare");
  const subKick = pick("Sub Kick (Synth)", "LM-2 Kick", "Pearl Kick");
  const rim = pick("TR-505 Rim");
  const trClap = pick("TR-505 Clap", "LM-2 Clap", "Snap Snare");
  const trCowbellLow = pick("TR-505 Cowbell Low");
  const trCowbellHigh = pick("TR-505 Cowbell High");
  const trLowConga = pick("TR-505 Low Conga");
  const trHighConga = pick("TR-505 High Conga");
  const crTamb = pick("CR-78 Tambourine", "LM-2 Closed Hat", "Pearl Closed Hat");
  const bcKick = pick("Pearl Kick", "LM-2 Kick", "Sub Kick (Synth)");
  const bcSnare = pick("Pearl Snare", "LM-2 Snare", "Snap Snare");
  const bcGhostSnare = pick("LM-2 Snare", "Pearl Snare", "Snap Snare");
  const bcHat = pick("Pearl Closed Hat", "LM-2 Closed Hat", "Closed Hat");
  const bcCrashRide = pick("Pearl Crash 2", "Pearl Crash", "Pearl Ride 2", "Pearl Ride", "Pearl Splash", "Pearl Splash 2", "LM-2 Crash", "LM-2 Ride", "TR-505 Crash", "TR-505 Ride");
  const bcPitchedSnare = pick("LM-2 Snare", "Pearl Snare", "Snap Snare");
  const bcNoiseBurst = pick("CR-78 Cymbal", "TR-505 Crash", "Pearl Splash", "Pearl Splash 2");
  const bcRimClick = pick("TR-505 Rim", "TR-505 Cowbell Low");

  const loop = ({
    name,
    rows,
    speed = 4,
    lengthBeats = 16,
    stepCount = 16,
    swingPercent = 50,
    defaultPitchHz,
  }: {
    name: string;
    rows: DrumRow[];
    speed?: DrumSpeed;
    lengthBeats?: number;
    stepCount?: number;
    swingPercent?: number;
    defaultPitchHz?: number;
  }): DrumComponent => ({
    id: nanoid(),
    kind: "drum",
    name,
    lengthBeats,
    stepCount,
    speed,
    swingPercent,
    defaultPitchHz,
    createdAt: Date.now(),
    factory: true,
    folderId: FACTORY_COMPONENT_FOLDER_ID,
    rows,
  });

  return [
    loop({
      name: "Basic Hip-Hop / Boom Bap",
      swingPercent: 56,
      rows: [
        row(pearlKick, "Kick", [hit(1, 124, 0, 32.7), hit(4, 82, 8, 32.7), hit(7, 94, -4, 32.7), hit(9, 122, 0, 32.7), hit(14, 86, 6, 32.7)]),
        row(pearlSnare, "Snare", [hit(5, 124, 0, 73.4), hit(13, 126, 0, 73.4)]),
        row(pearlHat, "Closed Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 72, 58, 7)),
        row(pearlOpenHat, "Open Hat", [hit(8, 62, 9, 233.0), hit(16, 64, 10, 233.0)]),
        row(pearlSnare, "Ghost Snare", [hit(4, 46, 10, 73.4), hit(6, 42, -8, 73.4), hit(11, 48, 8, 73.4), hit(15, 44, 10, 73.4)]),
      ],
    }),
    loop({
      name: "Rock Backbeat",
      swingPercent: 51,
      rows: [
        row(pearlKick, "Kick", [hit(1, 124, 0, 32.7), hit(7, 96, -4, 32.7), hit(9, 122, 0, 32.7), hit(11, 82, 5, 32.7), hit(15, 92, 6, 32.7)]),
        row(pearlSnare, "Snare", [hit(5, 126, 0, 73.4), hit(13, 126, 0, 73.4)]),
        row(pearlHat, "Closed Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 78, 62, 4)),
        row(pearlCrash, "Crash", [hit(1, 108, 0, 277.0)]),
        row(pearlSnare, "Ghost Snare", [hit(8, 42, 8, 73.4), hit(12, 40, -8, 73.4), hit(16, 44, 8, 73.4)]),
      ],
    }),
    loop({
      name: "House / Four-on-the-Floor",
      swingPercent: 50,
      rows: [
        row(lmKick, "Kick", [hit(1, 124, 0, 32.7), hit(5, 122, 0, 32.7), hit(9, 124, 0, 32.7), hit(13, 122, 0, 32.7)]),
        row(lmClap ?? lmSnare, "Clap / Snare", [hit(5, 120, 0, 73.4), hit(13, 122, 0, 73.4)]),
        row(lmHat, "Closed Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 66, 54, 4)),
        row(lmOpenHat, "Open Hat", [hit(3, 96, 0, 233.0), hit(7, 94, 0, 233.0), hit(11, 96, 0, 233.0), hit(15, 94, 0, 233.0)]),
        row(rim ?? trCowbellLow, "Perc / Rim", [hit(2, 54, 4, 196.0), hit(8, 58, 6, 196.0), hit(10, 54, 4, 196.0), hit(16, 58, 6, 196.0)]),
      ],
    }),
    loop({
      name: "Reggaeton / Dembow",
      swingPercent: 54,
      rows: [
        row(lmKick, "Kick", [hit(1, 124, 0, 32.7), hit(4, 94, -5, 32.7), hit(7, 118, 0, 32.7), hit(11, 108, 6, 32.7), hit(14, 86, 8, 32.7)]),
        row(rim ?? trClap ?? lmSnare, "Rim / Snare", [hit(5, 120, 0, 73.4), hit(9, 84, -4, 73.4), hit(13, 122, 0, 73.4)]),
        row(trClap, "Clap", [hit(5, 82, 0, 73.4), hit(13, 84, 0, 73.4)]),
        row(lmHat, "Closed Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 62, 50, 7)),
        row(lmOpenHat, "Open Hat", [hit(8, 56, 8, 233.0), hit(16, 58, 8, 233.0)]),
      ],
    }),
    loop({
      name: "Drum & Bass",
      swingPercent: 52,
      rows: [
        row(pearlKick, "Kick", [hit(1, 124, 0, 32.7), hit(9, 122, 0, 32.7), hit(12, 90, 7, 32.7)]),
        row(pearlSnare, "Snare", [hit(5, 126, 0, 73.4), hit(13, 126, 0, 73.4)]),
        row(pearlHat, "Closed Hat", alternating([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 70, 54, 3)),
        row(pearlRide ?? pearlCrash, "Ride / Crash", [hit(1, 104, 0, 277.0), hit(7, 82, 0, 277.0), hit(9, 98, 0, 277.0), hit(15, 80, 0, 277.0)]),
        row(pearlSnare, "Ghost Snare", [hit(3, 46, 6, 73.4), hit(6, 42, -6, 73.4), hit(11, 48, 6, 73.4), hit(15, 44, 8, 73.4)]),
      ],
    }),
    loop({
      name: "Breakcore Amen Skeleton",
      swingPercent: 54,
      rows: [
        row(bcKick, "Pearl Kick", [hit(1, 126, 0, 32.7), hit(4, 88, 7, 32.7), hit(7, 116, 0, 32.7), hit(9, 124, 0, 32.7), hit(14, 92, 6, 32.7)]),
        row(bcSnare, "Pearl Snare", [hit(3, 82, 5, 73.4), hit(5, 126, 0, 73.4), hit(8, 44, 7, 73.4), hit(10, 92, -5, 73.4), hit(13, 124, 0, 73.4), hit(16, 84, 8, 73.4)]),
        row(bcGhostSnare, "LM-2 Snare", [hit(2, 38, 6, 73.4), hit(4, 42, 8, 73.4), hit(6, 40, -6, 73.4), hit(10, 42, 6, 73.4), hit(12, 40, 7, 73.4), hit(14, 42, 5, 73.4)]),
        row(bcHat, "Pearl Closed Hat", alternating([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 70, 52, 3)),
        row(bcCrashRide, "Pearl Crash 2", [hit(1, 104, 0, 277.0), hit(7, 82, 0, 277.0), hit(9, 96, 0, 277.0), hit(15, 80, 0, 277.0)]),
      ],
    }),
    loop({
      name: "Hyperactive Snare-Chop Breakcore",
      swingPercent: 51,
      rows: [
        row(bcKick, "Pearl Kick", [hit(1, 126, 0, 32.7), hit(3, 88, -5, 32.7), hit(7, 110, 0, 32.7), hit(9, 120, 0, 32.7), hit(10, 88, 5, 32.7), hit(15, 106, 0, 32.7)]),
        row(bcSnare, "Pearl Snare", [hit(2, 92, 5, 73.4), hit(4, 96, 7, 73.4), hit(5, 126, 0, 73.4), hit(7, 106, 0, 73.4), hit(8, 100, 7, 73.4), hit(10, 92, -5, 73.4), hit(13, 124, 0, 73.4), hit(14, 98, 5, 73.4), hit(16, 94, 8, 73.4)]),
        row(bcPitchedSnare, "LM-2 Snare", [hit(6, 78, -4, 87.3), hit(11, 84, 0, 87.3), hit(15, 54, -6, 87.3), hit(16, 50, 8, 87.3)]),
        row(bcGhostSnare, "LM-2 Snare", [hit(1, 36, 0, 73.4), hit(3, 38, 6, 73.4), hit(6, 40, -6, 73.4), hit(8, 40, 7, 73.4), hit(9, 38, 0, 73.4), hit(12, 42, 8, 73.4), hit(15, 42, 6, 73.4)]),
        row(bcHat, "Pearl Closed Hat", alternating([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 70, 52, 3)),
      ],
    }),
    loop({
      name: "Glitch Breakcore / IDM Break",
      swingPercent: 50,
      rows: [
        row(bcKick, "Pearl Kick", [hit(1, 124, 0, 32.7), hit(4, 58, 8, 32.7), hit(6, 96, -5, 32.7), hit(9, 122, 0, 32.7), hit(11, 92, 0, 32.7), hit(15, 56, -8, 32.7)]),
        row(bcSnare, "Pearl Snare", [hit(3, 76, 4, 73.4), hit(5, 126, 0, 73.4), hit(8, 56, 8, 73.4), hit(10, 88, -5, 73.4), hit(12, 82, 6, 73.4), hit(13, 124, 0, 73.4), hit(16, 56, 8, 73.4)]),
        row(bcRimClick, "TR-505 Rim", [hit(1, 58, 0, 196.0), hit(4, 62, 7, 196.0), hit(6, 56, -5, 196.0), hit(9, 58, 0, 196.0), hit(11, 62, 0, 196.0), hit(14, 56, 5, 196.0), hit(16, 62, 7, 196.0)]),
        row(bcHat, "Pearl Closed Hat", alternating([1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16], 70, 50, 4)),
        row(bcNoiseBurst, "CR-78 Cymbal", [hit(4, 54, 7, 261.6), hit(8, 58, 7, 261.6), hit(11, 62, 0, 261.6), hit(16, 58, 8, 261.6)]),
      ],
    }),
    loop({
      name: "Venetian Snares-Style 7/8 Breakcore",
      lengthBeats: 14,
      stepCount: 14,
      swingPercent: 50,
      rows: [
        row(bcKick, "Pearl Kick", [hit(1, 126, 0, 32.7), hit(3, 88, 0, 32.7), hit(7, 110, 0, 32.7), hit(9, 124, 0, 32.7), hit(12, 88, 6, 32.7)], 14),
        row(bcSnare, "Pearl Snare", [hit(4, 88, 7, 73.4), hit(5, 126, 0, 73.4), hit(8, 44, 7, 73.4), hit(10, 92, -5, 73.4), hit(13, 124, 0, 73.4)], 14),
        row(bcGhostSnare, "LM-2 Snare", [hit(2, 38, 5, 73.4), hit(6, 40, -5, 73.4), hit(9, 38, 0, 73.4), hit(11, 42, 0, 73.4), hit(14, 42, 7, 73.4)], 14),
        row(bcHat, "Pearl Closed Hat", alternating([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 70, 52, 3), 14),
        row(bcCrashRide, "Pearl Crash 2", [hit(1, 104, 0, 277.0), hit(7, 84, 0, 277.0), hit(9, 98, 0, 277.0), hit(14, 82, 6, 277.0)], 14),
      ],
    }),
    loop({
      name: "Blast Breakcore / Maximum Density",
      swingPercent: 50,
      rows: [
        row(bcKick, "Pearl Kick", [hit(1, 126, 0, 32.7), hit(2, 104, 0, 32.7), hit(4, 98, 6, 32.7), hit(5, 122, 0, 32.7), hit(6, 102, 0, 32.7), hit(8, 98, 6, 32.7), hit(9, 124, 0, 32.7), hit(10, 104, 0, 32.7), hit(12, 98, 6, 32.7), hit(13, 122, 0, 32.7), hit(14, 104, 0, 32.7), hit(15, 108, 0, 32.7)]),
        row(bcSnare, "Pearl Snare", [hit(2, 92, 0, 73.4), hit(3, 100, 0, 73.4), hit(4, 98, 6, 73.4), hit(6, 92, 0, 73.4), hit(7, 100, 0, 73.4), hit(8, 98, 6, 73.4), hit(10, 92, 0, 73.4), hit(11, 100, 0, 73.4), hit(12, 98, 6, 73.4), hit(14, 92, 0, 73.4), hit(15, 100, 0, 73.4), hit(16, 50, 8, 73.4)]),
        row(bcPitchedSnare, "LM-2 Snare", [hit(5, 78, 0, 87.3), hit(8, 76, 6, 87.3), hit(11, 80, 0, 87.3), hit(14, 76, 0, 87.3), hit(16, 50, 8, 87.3)]),
        row(bcHat, "Pearl Closed Hat", alternating([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 72, 54, 2)),
        row(bcNoiseBurst, "CR-78 Cymbal", [hit(1, 106, 0, 277.0), hit(4, 82, 6, 277.0), hit(7, 88, 0, 277.0), hit(9, 104, 0, 277.0), hit(12, 82, 6, 277.0), hit(15, 88, 0, 277.0)]),
      ],
    }),
    loop({
      name: "Trap Half-Time",
      swingPercent: 57,
      defaultPitchHz: 130.81,
      rows: [
        row(subKick, "Sub Kick", [hit(1, 124, 0, 32.7), hit(6, 78, -8, 36.71), hit(11, 116, 7, 43.65), hit(15, 88, 8, 32.7)]),
        row(lmSnare, "Snare", [hit(9, 126, 0, 73.4)]),
        row(lmHat, "Closed Hat", [hit(1, 62, 0, 185.0), hit(3, 48, 8, 185.0), hit(5, 54, 0, 185.0), hit(7, 46, 8, 185.0), hit(10, 52, -5, 185.0), hit(12, 46, 7, 185.0), hit(13, 62, 0, 185.0), hit(15, 44, -8, 246.94), hit(16, 38, 10, 261.63)]),
        row(trClap, "Clap", [hit(9, 72, 0, 73.4)]),
        row(lmSnare, "Ghost Snare", [hit(16, 42, 8, 73.4)]),
      ],
    }),
    loop({
      name: "Funk Shuffle",
      swingPercent: 62,
      rows: [
        row(pearlKick, "Kick", [hit(1, 122, 0, 32.7), hit(4, 72, -9, 32.7), hit(7, 104, 8, 32.7), hit(11, 92, -5, 32.7), hit(15, 110, 9, 32.7)]),
        row(pearlSnare, "Snare", [hit(5, 124, 0, 73.4), hit(13, 120, 0, 73.4)]),
        row(pearlHat, "Closed Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 76, 54, 12)),
        row(pearlOpenHat, "Open Hat", [hit(15, 64, 14, 233.0)]),
        row(pearlSnare, "Ghost Snare", [hit(8, 44, 10, 73.4), hit(12, 52, -8, 73.4), hit(16, 46, 10, 73.4)]),
      ],
    }),
    loop({
      name: "Latin Cumbia",
      swingPercent: 54,
      rows: [
        row(lmKick, "Kick", [hit(1, 118, 0, 32.7), hit(7, 96, 0, 32.7), hit(9, 114, 0, 32.7), hit(15, 92, 0, 32.7)]),
        row(trClap, "Clap", [hit(5, 110, 0, 73.4), hit(13, 112, 0, 73.4)]),
        row(trLowConga, "Low Conga", [hit(3, 78, 6, 196.0), hit(11, 76, 6, 196.0)]),
        row(trHighConga, "High Conga", [hit(4, 70, -8, 293.66), hit(8, 66, 8, 329.63), hit(12, 72, -8, 293.66), hit(16, 62, 8, 329.63)]),
        row(trCowbellHigh, "Cowbell", [hit(3, 64, 0, 783.99), hit(7, 68, 0, 783.99), hit(11, 62, 0, 783.99), hit(15, 70, 0, 783.99)]),
      ],
    }),
    loop({
      name: "Afrobeat / Afropop-Inspired",
      swingPercent: 55,
      rows: [
        row(lmKick, "Kick", [hit(1, 122, 0, 32.7), hit(6, 84, 4, 32.7), hit(9, 118, 0, 32.7), hit(15, 86, 6, 32.7)]),
        row(trClap ?? lmSnare, "Snare / Clap", [hit(5, 116, 0, 73.4), hit(13, 118, 0, 73.4)]),
        row(lmHat, "Closed Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 66, 52, 5)),
        row(crTamb, "Shaker", [hit(1, 60, 0, 277.0), hit(2, 54, 3, 277.0), hit(4, 58, 5, 277.0), hit(5, 62, 0, 277.0), hit(7, 56, 4, 277.0), hit(9, 62, 0, 277.0), hit(10, 54, 3, 277.0), hit(12, 58, 5, 277.0), hit(13, 62, 0, 277.0), hit(15, 56, 4, 277.0)]),
        row(trCowbellHigh, "High Perc", [hit(3, 66, 0, 220.0), hit(6, 60, -5, 220.0), hit(11, 66, 0, 220.0), hit(14, 60, -5, 220.0)]),
      ],
    }),
  ];
}

type Hit = {
  step: number;
  velocity?: number;
  leanPercent?: number;
  pitchHz?: number;
};

function hit(step: number, velocity?: number, leanPercent?: number, pitchHz?: number): Hit {
  return { step, velocity, leanPercent, pitchHz };
}

function row(instrument: Instrument | undefined, fallbackName: string, hits: Hit[], stepCount = 16): DrumRow {
  return {
    id: nanoid(),
    instrumentId: instrument?.id,
    name: instrument?.name ?? fallbackName,
    steps: steps(hits, stepCount),
  };
}

function steps(hits: Hit[], stepCount: number): DrumStep[] {
  const out: DrumStep[] = Array.from({ length: stepCount }, () => false);
  hits.forEach(({ step, velocity, leanPercent, pitchHz }) => {
    const index = step - 1;
    if (index < 0 || index >= stepCount) return;
    out[index] = {
      on: true,
      ...(velocity != null ? { velocity } : {}),
      ...(leanPercent != null ? { leanPercent } : {}),
      ...(pitchHz != null ? { pitchHz } : {}),
    };
  });
  return out;
}

function alternating(steps: number[], strongVelocity: number, weakVelocity: number, lean = 0): Hit[] {
  return steps.map((step, index) => hit(step, index % 2 === 0 ? strongVelocity : weakVelocity, index % 2 === 0 ? 0 : lean));
}
