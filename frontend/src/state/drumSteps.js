export const DEFAULT_DRUM_VELOCITY = 110;
export const DEFAULT_DRUM_MIDI_PITCH = 60;
export function normalizeDrumCell(step) {
    if (typeof step === "object" && step) {
        return {
            on: Boolean(step.on),
            pitchHz: sanitizeFrequency(step.pitchHz),
            velocity: sanitizeVelocity(step.velocity),
        };
    }
    return { on: Boolean(step), velocity: DEFAULT_DRUM_VELOCITY };
}
export function normalizeDrumSteps(steps, count) {
    return Array.from({ length: count }, (_, i) => normalizeDrumCell(steps[i]));
}
export function drumStepOn(step) {
    return normalizeDrumCell(step).on;
}
export function sanitizeFrequency(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
    return Math.max(20, Math.min(20000, value));
}
export function sanitizeVelocity(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return DEFAULT_DRUM_VELOCITY;
    return Math.max(1, Math.min(127, Math.round(value)));
}
export function parsePitchInput(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric))
        return sanitizeFrequency(numeric) ?? null;
    const match = trimmed.match(/^([a-g])([#b]?)(-?\d+)$/i);
    if (!match)
        return null;
    const [, noteName, accidental, octaveRaw] = match;
    const semitone = NOTE_OFFSETS[noteName.toUpperCase()];
    const offset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
    const octave = Number(octaveRaw);
    if (!Number.isFinite(octave))
        return null;
    const midi = (octave + 1) * 12 + semitone + offset;
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    return sanitizeFrequency(hz) ?? null;
}
export function formatFrequency(value) {
    if (!value)
        return "";
    return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}
export function frequencyToNoteName(value) {
    if (!value || !Number.isFinite(value))
        return "";
    const midi = Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(value / 440))));
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_NAMES[midi % 12]}${octave}`;
}
const NOTE_OFFSETS = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
};
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
