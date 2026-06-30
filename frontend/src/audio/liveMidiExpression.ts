export interface LiveMidiExpressionSnapshot {
  activeNotes: number;
  pitchBendSemitones: number;
  velocity: number;
  keytrack: number;
  modWheel: number;
}

export type LiveMidiExpressionMessage =
  | { kind: "noteOn"; channel: number; note: number; velocity: number }
  | { kind: "noteOff"; channel: number; note: number }
  | { kind: "pitchBend"; channel: number; semitones: number }
  | { kind: "modWheel"; channel: number; value: number };

const DEFAULT_PITCH_BEND_RANGE_SEMITONES = 2;

export function parseLiveMidiExpressionMessage(
  data: ArrayLike<number>,
  pitchBendRangeSemitones = DEFAULT_PITCH_BEND_RANGE_SEMITONES,
): LiveMidiExpressionMessage | null {
  if (data.length < 1) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const first = clampMidiByte(data[1] ?? 0);
  const second = clampMidiByte(data[2] ?? 0);

  if (status === 0x90) {
    if (second === 0) return { kind: "noteOff", channel, note: first };
    return { kind: "noteOn", channel, note: first, velocity: second / 127 };
  }
  if (status === 0x80) {
    return { kind: "noteOff", channel, note: first };
  }
  if (status === 0xb0 && first === 1) {
    return { kind: "modWheel", channel, value: second / 127 };
  }
  if (status === 0xe0) {
    const raw = first + second * 128;
    const normalized = Math.max(-1, Math.min(1, (raw - 8192) / 8192));
    return { kind: "pitchBend", channel, semitones: normalized * pitchBendRangeSemitones };
  }
  return null;
}

export function createLiveMidiExpressionTracker(pitchBendRangeSemitones = DEFAULT_PITCH_BEND_RANGE_SEMITONES) {
  const activeNotes = new Map<string, { velocity: number; keytrack: number }>();
  let pitchBendSemitones = 0;
  let modWheel = 0;

  function applyMessage(message: LiveMidiExpressionMessage): LiveMidiExpressionSnapshot | null {
    if (message.kind === "noteOn") {
      activeNotes.set(noteKey(message.channel, message.note), {
        velocity: clamp01(message.velocity),
        keytrack: clamp01(message.note / 127),
      });
    } else if (message.kind === "noteOff") {
      activeNotes.delete(noteKey(message.channel, message.note));
    } else if (message.kind === "pitchBend") {
      pitchBendSemitones = Number.isFinite(message.semitones) ? message.semitones : 0;
    } else {
      modWheel = clamp01(message.value);
    }
    return snapshot();
  }

  function applyData(data: ArrayLike<number>): LiveMidiExpressionSnapshot | null {
    const message = parseLiveMidiExpressionMessage(data, pitchBendRangeSemitones);
    return message ? applyMessage(message) : snapshot();
  }

  function snapshot(): LiveMidiExpressionSnapshot | null {
    let velocity = 0;
    let keytrack = 0;
    for (const note of activeNotes.values()) {
      velocity += note.velocity;
      keytrack += note.keytrack;
    }
    const activeCount = activeNotes.size;
    if (activeCount > 0) {
      velocity /= activeCount;
      keytrack /= activeCount;
    }
    const active = activeCount > 0 || Math.abs(pitchBendSemitones) > 0.001 || modWheel > 0.001;
    if (!active) return null;
    return {
      activeNotes: activeCount,
      pitchBendSemitones,
      velocity,
      keytrack,
      modWheel,
    };
  }

  function reset() {
    activeNotes.clear();
    pitchBendSemitones = 0;
    modWheel = 0;
  }

  return {
    applyMessage,
    applyData,
    snapshot,
    reset,
  };
}

function noteKey(channel: number, note: number): string {
  return `${channel}:${note}`;
}

function clampMidiByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(127, Math.round(value)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
