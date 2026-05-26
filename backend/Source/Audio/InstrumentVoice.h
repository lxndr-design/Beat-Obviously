#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

namespace beat
{
    /**
     * InstrumentVoice — a single polyphonic voice for the built-in synth.
     *
     * Minimal subtractive synth: oscillator + ADSR + state-variable filter.
     * The four named macro knobs (cutoff, resonance, drive, color) map to:
     *   cutoff    → filter cutoff frequency
     *   resonance → filter Q
     *   drive     → pre-filter saturation amount
     *   color     → oscillator detune / sub-osc blend (wildcard parameter)
     *
     * Real sample playback (sampler / hybrid kinds) is a TODO that drops in
     * by replacing the oscillator section.
     */
    class InstrumentVoice : public juce::SynthesiserVoice
    {
    public:
        InstrumentVoice() = default;

        bool canPlaySound(juce::SynthesiserSound*) override { return true; }
        void startNote(int midiNoteNumber, float velocity,
                       juce::SynthesiserSound*, int /*currentPitchWheel*/) override;
        void stopNote(float velocity, bool allowTailOff) override;
        void pitchWheelMoved(int) override {}
        void controllerMoved(int, int) override {}
        void renderNextBlock(juce::AudioBuffer<float>& outputBuffer,
                             int startSample, int numSamples) override;

        struct Params {
            float cutoff01    { 0.6f };
            float resonance01 { 0.2f };
            float drive01     { 0.1f };
            float color01     { 0.5f };
            // ADSR in ms / 0..1
            float attackMs  { 5.f };
            float decayMs   { 100.f };
            float sustain   { 0.7f };
            float releaseMs { 200.f };
            // Waveform: 0=sine, 1=saw, 2=square, 3=triangle, 4=noise
            int waveform { 1 };
        };

        void setParams(const Params& p);
        void prepare(double sampleRate, int blockSize);

    private:
        Params  params;
        double  sampleRate { 44100.0 };
        double  phase { 0.0 };
        double  phaseDelta { 0.0 };
        float   level { 0.0f };
        juce::ADSR adsr;
        juce::ADSR::Parameters adsrParams;
        juce::dsp::StateVariableTPTFilter<float> filter;
    };
}
