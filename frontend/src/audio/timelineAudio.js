import { createInstrumentBufferSource, noteFrequency } from "./synthPreview";
let ctx = null;
const activeSources = new Set();
const activeGains = new Set();
export function getTimelineAudioContext() {
    if (!ctx) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctor = (window.AudioContext || window.webkitAudioContext);
        ctx = new Ctor();
    }
    return ctx;
}
export function primeTimelineAudio() {
    const audio = getTimelineAudioContext();
    if (audio.state === "suspended")
        void audio.resume();
}
export function stopTimelineAudio() {
    for (const source of activeSources) {
        try {
            source.stop();
        }
        catch {
            // Already stopped.
        }
        source.disconnect();
    }
    for (const gain of activeGains)
        gain.disconnect();
    activeSources.clear();
    activeGains.clear();
}
export function scheduleTimelineMidiNote(note, instrument, atTimeS, durationS) {
    const audio = getTimelineAudioContext();
    if (audio.state === "suspended")
        void audio.resume();
    const source = createInstrumentBufferSource(audio, instrument, durationS + 0.05, note.frequencyHz ?? noteFrequency(note.pitch, instrument));
    const playbackDuration = source.buffer
        ? Math.max(durationS, Math.min(1.5, source.buffer.duration / source.playbackRate.value))
        : durationS;
    const gain = audio.createGain();
    const peak = (note.velocity / 127) * 0.28;
    const release = Math.min(0.16, playbackDuration * 0.5);
    gain.gain.setValueAtTime(0, atTimeS);
    gain.gain.linearRampToValueAtTime(peak, atTimeS + 0.005);
    gain.gain.setValueAtTime(peak, atTimeS + Math.max(0, playbackDuration - release));
    gain.gain.linearRampToValueAtTime(0, atTimeS + playbackDuration);
    gain.connect(audio.destination);
    source.connect(gain);
    source.onended = () => {
        activeSources.delete(source);
        activeGains.delete(gain);
        source.disconnect();
        gain.disconnect();
    };
    activeSources.add(source);
    activeGains.add(gain);
    source.start(atTimeS);
    source.stop(atTimeS + playbackDuration + 0.05);
}
