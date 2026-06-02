import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type { DrumRow, DrumSpeed, DrumStep, Id, Instrument, MidiNote, TimeSignature } from "./types";

/**
 * MidiComponent — a reusable MIDI pattern saved from a segment.
 *
 * Components live in the sidebar's "Components" section and can be dragged
 * onto track lanes to spawn a new MIDI segment with the same notes
 * (optionally pre-bound to an instrument).
 */
export interface MidiComponent {
  id: Id;
  kind?: "midi";
  name: string;
  notes: MidiNote[];
  lengthBeats: number;
  /** Optional bound instrument carried from the source segment. */
  instrumentId?: Id;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  factory?: boolean;
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
}

export type BeatComponent = MidiComponent | DrumComponent;
type ComponentInput =
  | Omit<MidiComponent, "id" | "createdAt">
  | Omit<DrumComponent, "id" | "createdAt">;

interface ComponentSlice {
  components: BeatComponent[];
  add: (c: ComponentInput) => Id;
  hydrate: (components: BeatComponent[]) => void;
  seedDefaultDrumLoops: (instruments: Instrument[]) => void;
  update: (id: Id, patch: Partial<Omit<MidiComponent, "id" | "createdAt">> | Partial<Omit<DrumComponent, "id" | "createdAt">>) => void;
  remove: (id: Id) => void;
  rename: (id: Id, name: string) => void;
}

export const useComponentStore = create<ComponentSlice>()(
  immer((set) => ({
    components: [],
    add: (c) => {
      const id = nanoid();
      set((s) => {
        s.components.unshift({
          id,
          createdAt: Date.now(),
          ...c,
          ...(c.kind === "drum"
            ? { rows: structuredClone(c.rows) }
            : { notes: structuredClone(c.notes) }),
        });
      });
      return id;
    },
    hydrate: (components) =>
      set((s) => {
        const factory = s.components.filter((component) => component.factory);
        const user = components
          .filter((component) => !component.factory)
          .map((component) => component.kind ? component : { ...component, kind: "midi" as const });
        s.components = [...user, ...factory];
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
          notes: structuredClone((patch as Partial<MidiComponent>).notes ?? (current as MidiComponent).notes),
        };
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
  })),
);

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
  const pearlHighTom = pick("Pearl High Tom", "TR-505 High Tom");
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
  const trTimbal = pick("TR-505 Timbal");
  const trLowTom = pick("TR-505 Low Tom", "Pearl Low Tom");
  const trMidTom = pick("TR-505 Mid Tom", "Pearl Mid Tom");
  const trHighTom = pick("TR-505 High Tom", "Pearl High Tom");
  const crTamb = pick("CR-78 Tambourine", "LM-2 Closed Hat", "Pearl Closed Hat");
  const crGuiro = pick("CR-78 Guiro", "TR-505 Rim");
  const triangle = pick("Triangle", "Triangle Perc", "TR-505 Cowbell High");

  const loop = ({
    name,
    rows,
    speed = 1,
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
    rows,
  });

  return [
    loop({
      name: "Rock Backbeat",
      rows: [
        row(pearlKick, "Kick", [hit(1, 122), hit(7, 78, -6), hit(9, 118), hit(15, 92, 8)]),
        row(pearlSnare, "Snare", [hit(5, 124), hit(8, 42, -12), hit(12, 38, 9), hit(13, 126)]),
        row(pearlHat, "Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 82, 64, 4)),
        row(pearlCrash, "Crash", [hit(1, 112)]),
      ],
    }),
    loop({
      name: "Four on the Floor",
      swingPercent: 52,
      rows: [
        row(lmKick, "Kick", [hit(1, 124), hit(5, 118), hit(9, 122), hit(13, 118)]),
        row(lmClap, "Clap", [hit(5, 116), hit(13, 118)]),
        row(lmOpenHat, "Open Hat", [hit(3, 92, 8), hit(7, 94, 8), hit(11, 92, 8), hit(15, 94, 8)]),
        row(lmHat, "Closed Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 58, 48, 5)),
      ],
    }),
    loop({
      name: "Reggae One Drop",
      swingPercent: 58,
      rows: [
        row(pearlKick, "Kick", [hit(9, 118, 6)]),
        row(rim ?? pearlSnare, "Rim", [hit(5, 82, 10), hit(9, 116, 8), hit(13, 82, 10)]),
        row(pearlHat, "Hat", [hit(3, 62, 12), hit(7, 72, 12), hit(11, 64, 12), hit(15, 74, 12)]),
        row(crTamb, "Tambourine", [hit(7, 48, 14), hit(15, 52, 14)]),
      ],
    }),
    loop({
      name: "Dembow",
      swingPercent: 54,
      rows: [
        row(lmKick, "Kick", [hit(1, 124), hit(4, 96, -8), hit(7, 116), hit(11, 108, 7), hit(14, 82, 10)]),
        row(rim ?? trClap ?? lmSnare, "Rim", [hit(5, 118), hit(9, 92, -5), hit(13, 122)]),
        row(trClap, "Clap", [hit(5, 92), hit(13, 94)]),
        row(lmHat, "Hat", alternating([3, 7, 11, 15], 68, 58, 8)),
      ],
    }),
    loop({
      name: "Amen-Style Break",
      swingPercent: 56,
      rows: [
        row(pearlKick, "Kick", [hit(1, 124), hit(4, 98, -8), hit(7, 112), hit(11, 104, 8)]),
        row(pearlSnare, "Snare", [hit(5, 126), hit(10, 94, -7), hit(13, 120), hit(16, 78, 9)]),
        row(pearlHat, "Hat", [
          hit(1, 74),
          hit(3, 58, 5),
          hit(4, 64, -6),
          hit(5, 78),
          hit(7, 56, 8),
          hit(9, 70),
          hit(11, 56, 8),
          hit(12, 62, -5),
          hit(13, 82),
          hit(15, 58, 6),
        ]),
        row(pearlRide, "Ride", [hit(1, 42), hit(9, 40)]),
      ],
    }),
    loop({
      name: "Breakcore Cut",
      speed: 2,
      stepCount: 32,
      lengthBeats: 16,
      swingPercent: 53,
      rows: [
        row(pearlKick, "Kick", [hit(1, 126), hit(4, 88, -10), hit(7, 112), hit(8, 76, 12), hit(11, 116), hit(15, 96), hit(19, 118), hit(23, 86, -8), hit(27, 122), hit(31, 92, 8)], 32),
        row(pearlSnare, "Snare", [hit(3, 84, 8, 246.94), hit(5, 124), hit(10, 98, -12, 220), hit(13, 118), hit(16, 78, 10), hit(21, 126), hit(26, 92, -8, 261.63), hit(29, 114), hit(32, 86, 8)], 32),
        row(pearlHat, "Hat", alternating([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 20, 21, 22, 23, 25, 26, 27, 29, 30, 31], 72, 52, 5), 32),
        row(pearlHighTom, "High Tom", [hit(8, 78, -6, 392), hit(24, 82, 6, 440)], 32),
      ],
    }),
    loop({
      name: "Trap Half-Time",
      speed: 2,
      stepCount: 32,
      lengthBeats: 16,
      swingPercent: 57,
      defaultPitchHz: 130.81,
      rows: [
        row(subKick, "Sub Kick", [hit(1, 124), hit(6, 84, -10, 123.47), hit(11, 114, 8, 146.83), hit(16, 72, 12, 110), hit(19, 120, -6), hit(25, 94, 8, 98), hit(29, 118)], 32),
        row(lmSnare, "Snare", [hit(9, 124), hit(25, 126), hit(31, 58, 12)], 32),
        row(lmHat, "Hat Roll", [
          hit(1, 62),
          hit(3, 48, 9),
          hit(5, 54),
          hit(7, 46, 8),
          hit(11, 52),
          hit(13, 48),
          hit(15, 42, -9, 493.88),
          hit(16, 36, -12, 523.25),
          hit(17, 68),
          hit(19, 48, 8),
          hit(21, 58),
          hit(23, 44, 8),
          hit(27, 52),
          hit(29, 46),
          hit(30, 40, -12, 587.33),
          hit(31, 38, -8, 659.25),
        ], 32),
        row(trClap, "Clap", [hit(9, 66), hit(25, 68)], 32),
      ],
    }),
    loop({
      name: "Funk Shuffle",
      swingPercent: 62,
      rows: [
        row(pearlKick, "Kick", [hit(1, 122), hit(4, 74, -9), hit(7, 102, 8), hit(11, 92, -5), hit(15, 108, 9)]),
        row(pearlSnare, "Snare", [hit(5, 122), hit(8, 44, 10), hit(12, 52, -8), hit(13, 118), hit(16, 46, 10)]),
        row(pearlHat, "Hat", alternating([1, 3, 5, 7, 9, 11, 13, 15], 76, 54, 12)),
        row(pearlOpenHat, "Open Hat", [hit(15, 64, 14)]),
      ],
    }),
    loop({
      name: "Latin Cumbia",
      swingPercent: 54,
      rows: [
        row(lmKick, "Kick", [hit(1, 116), hit(7, 96), hit(9, 112), hit(15, 92)]),
        row(trClap, "Clap", [hit(5, 108), hit(13, 110)]),
        row(trLowConga, "Low Conga", [hit(3, 78, 6, 196), hit(11, 76, 6, 196)]),
        row(trHighConga, "High Conga", [hit(4, 70, -8, 293.66), hit(8, 66, 8, 329.63), hit(12, 72, -8, 293.66), hit(16, 62, 8, 329.63)]),
        row(trCowbellHigh, "Cowbell", [hit(3, 64), hit(7, 68), hit(11, 62), hit(15, 70)]),
      ],
    }),
    loop({
      name: "Minimal Electro",
      swingPercent: 51,
      rows: [
        row(lmKick, "Kick", [hit(1, 116), hit(9, 108), hit(12, 66, -6)]),
        row(lmSnare, "Snare", [hit(5, 102), hit(13, 108)]),
        row(crTamb, "Tambourine", alternating([1, 3, 5, 7, 9, 11, 13, 15], 58, 44, 4)),
        row(crGuiro, "Guiro", [hit(4, 48, 10), hit(8, 52, 10), hit(12, 48, 10), hit(16, 52, 10)]),
        row(trCowbellLow, "Cowbell Low", [hit(7, 58, -8, 261.63), hit(15, 64, 8, 293.66)]),
      ],
    }),
    loop({
      name: "Percussion Fill",
      swingPercent: 55,
      rows: [
        row(trLowTom, "Low Tom", [hit(1, 90, 0, 174.61), hit(9, 86, 0, 196)]),
        row(trMidTom, "Mid Tom", [hit(5, 80, -8, 246.94), hit(13, 82, 8, 261.63)]),
        row(trHighTom, "High Tom", [hit(7, 76, -8, 329.63), hit(8, 68, 10, 349.23), hit(15, 78, -8, 392), hit(16, 70, 10, 440)]),
        row(trTimbal, "Timbal", [hit(4, 58, 10), hit(12, 62, 10)]),
        row(trCowbellHigh, "Cowbell High", [hit(3, 54), hit(11, 58)]),
        row(triangle, "Triangle", [hit(1, 42, 0, 880), hit(9, 44, 0, 987.77)]),
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
