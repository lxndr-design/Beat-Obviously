/**
 * Mock AI service — deterministic outputs for development.
 * Replace with AnthropicAiService when wiring up real API calls.
 */
export const MockAiService = {
    async suggestInstrument(prompt) {
        // Hash prompt → deterministic knob positions.
        const seed = simpleHash(prompt);
        const knob = (n) => ((seed >> n) & 0xff) / 255;
        return {
            name: prompt.slice(0, 24).trim() || "AI Instrument",
            kind: "synth",
            waveform: ["sine", "saw", "square", "triangle"][seed % 4],
            knobs: { cutoff: knob(0), resonance: knob(8), drive: knob(16), color: knob(24) },
            envelope: {
                attackMs: 2 + (seed & 0x3f),
                decayMs: 50 + (seed & 0xff),
                sustain: 0.4 + ((seed >> 4) & 0x3f) / 255,
                releaseMs: 100 + (seed & 0x1ff),
            },
        };
    },
    async generatePattern({ lengthBeats }) {
        const notes = [];
        // Simple 4-on-the-floor kick pattern as placeholder.
        for (let beat = 0; beat < lengthBeats; beat++) {
            notes.push({ pitch: 36, velocity: 100, startBeat: beat, lengthBeats: 0.25 });
        }
        return notes;
    },
    async suggestProjectName(summary) {
        return `Untitled · ${summary.slice(0, 32)}`;
    },
    isLive() {
        return false;
    },
};
function simpleHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
// Global singleton — swap implementation here when wiring real model calls.
export const ai = MockAiService;
