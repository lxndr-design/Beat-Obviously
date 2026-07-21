#pragma once

#include "Envelope/EnvelopeShaper.h"
#include "Filter/DriveStage.h"
#include "Filter/FilterStage.h"
#include "Modulation/DynamicModulation.h"
#include "Oscillator/VoiceAetherCache.h"
#include "Oscillator/VoiceStats.h"
#include "Realtime/RealtimeParameterQueue.h"
#include "Realtime/RealtimeRamp.h"
#include "Realtime/VoiceRealtimeRampState.h"
#include "Realtime/VoiceRealtimeParams.h"
#include "Realtime/VoiceNoteAutomation.h"
#include "Realtime/VoiceNoteAutomationState.h"
#include "Wavetable/WavetableFactory.h"
#include "Wavetable/WavetableOscillator.h"
#include "Wavetable/WavetableUnisonPlan.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <cstdint>
#include <memory>
#include <string_view>

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
     * Sample playback is handled by AudioEngine's sample-zone renderer. This
     * voice remains the built-in oscillator/wavetable synth path.
     */
    class InstrumentVoice : public juce::SynthesiserVoice
    {
    public:
        InstrumentVoice() = default;

        bool canPlaySound(juce::SynthesiserSound*) override { return true; }
        void startNote(int midiNoteNumber, float velocity,
                       juce::SynthesiserSound*, int currentPitchWheel) override;
        void stopNote(float velocity, bool allowTailOff) override;
        void pitchWheelMoved(int newPitchWheelValue) override;
        void controllerMoved(int controllerNumber, int controllerValue) override;
        void renderNextBlock(juce::AudioBuffer<float>& outputBuffer,
                             int startSample, int numSamples) override;

        struct Params {
            struct WavetableConfig
            {
                struct CustomFrame
                {
                    float brightness { 0.5f };
                    float even { 0.2f };
                    float fold { 0.1f };
                    float formant { 0.12f };
                    float notch { 0.08f };
                    float skew { 0.0f };
                    float tilt { 0.0f };
                    float focus { 0.35f };
                    float phase { 0.0f };
                    std::array<float, 16> partials {};
                };

                int bank { 0 };
                bool custom { false };
                float position { 0.35f };
                float warp { 0.2f };
                int warpMode { 0 };
                bool smoothInterpolation { false };
                float morph { 0.0f };
                int unison { 1 };
                float detuneCents { 12.0f };
                float blend { 0.5f };
                std::array<CustomFrame, 4> customFrames {{
                    { 0.22f, 0.08f, 0.05f, 0.08f, 0.04f, -0.18f, -0.16f, 0.18f, 0.0f },
                    { 0.46f, 0.28f, 0.16f, 0.18f, 0.1f, -0.04f, -0.04f, 0.32f, 0.12f },
                    { 0.72f, 0.48f, 0.34f, 0.32f, 0.16f, 0.08f, 0.08f, 0.52f, -0.08f },
                    { 0.94f, 0.72f, 0.56f, 0.46f, 0.24f, 0.22f, 0.2f, 0.7f, 0.2f },
                }};
            };

            struct AetherOscillator
            {
                bool enabled { false };
                float level { 0.0f };
                float pan { 0.0f };
                int waveform { 5 };
                int octave { 0 };
                int semitone { 0 };
                float fineCents { 0.0f };
                float phase { 0.0f };
                float randomPhase { 0.0f };
                WavetableConfig wavetable;
            };

            struct AetherSub
            {
                bool enabled { false };
                float level { 0.0f };
                int octave { -1 };
                int waveform { 0 };
            };

            struct AetherNoise
            {
                bool enabled { false };
                float level { 0.0f };
                float color { 0.5f };
            };

            struct AurumOperator
            {
                bool enabled { false };
                int waveform { 0 };
                float ratio { 1.0f };
                int coarse { 0 };
                float fineCents { 0.0f };
                float level { 0.0f };
                float phase { 0.0f };
                float attackMs { 5.0f };
                float decayMs { 500.0f };
                float sustain { 0.7f };
                float releaseMs { 300.0f };
            };

            struct DynamicModTarget
            {
                float lfo { 0.0f };
                bool lfoBipolar { true };
                float lfo2 { 0.0f };
                bool lfo2Bipolar { true };
                float env { 0.0f };
                bool envBipolar { false };
                float env2 { 0.0f };
                bool env2Bipolar { false };
                float velocity { 0.0f };
                bool velocityBipolar { false };
                float keytrack { 0.0f };
                bool keytrackBipolar { false };
                float modWheel { 0.0f };
                bool modWheelBipolar { false };
                float macro1 { 0.0f };
                float macro2 { 0.0f };
                float macro3 { 0.0f };
                float macro4 { 0.0f };
            };

            struct DynamicModulation
            {
                bool active { false };
                DynamicModTarget oscAPosition;
                DynamicModTarget oscAFine;
                DynamicModTarget oscALevel;
                DynamicModTarget oscAPan;
                DynamicModTarget oscBPosition;
                DynamicModTarget oscBFine;
                DynamicModTarget oscBLevel;
                DynamicModTarget oscBPan;
                DynamicModTarget filterCutoff;
                DynamicModTarget filterResonance;
                DynamicModTarget filterDrive;
                DynamicModTarget ampLevel;
                DynamicModTarget ampPan;
                DynamicModTarget unisonDetune;
                DynamicModTarget unisonSpread;
            };

            float cutoff01    { 0.6f };
            float filterKeytrack { 0.0f };
            float resonance01 { 0.2f };
            float drive01     { 0.1f };
            float color01     { 0.5f };
            int filterType    { 0 };
            // ADSR in ms / 0..1
            float attackMs  { 5.f };
            int attackCurve { 0 };
            float decayMs   { 100.f };
            int decayCurve { 0 };
            float sustain   { 0.7f };
            float releaseMs { 200.f };
            int releaseCurve { 0 };
            bool env1Loop { false };
            float env2AttackMs { 10.f };
            int env2AttackCurve { 0 };
            float env2DecayMs { 300.f };
            int env2DecayCurve { 0 };
            float env2Sustain { 0.0f };
            float env2ReleaseMs { 200.f };
            int env2ReleaseCurve { 0 };
            bool env2Loop { false };
            float ampLevel  { 1.0f };
            float ampPan    { 0.0f };
            float modWheel  { 0.0f };
            float pitchBendRangeSemitones { 2.0f };
            // Waveform: 0=sine, 1=saw, 2=square, 3=triangle, 4=noise, 5=wavetable
            int waveform { 1 };
            int wavetableBank { 0 };
            float wavetablePosition { 0.35f };
            float wavetableWarp { 0.2f };
            int wavetableWarpMode { 0 };
            int wavetableUnison { 1 };
            float wavetableDetuneCents { 12.0f };
            float wavetableBlend { 0.5f };
            int lfoWaveform { 0 };
            float lfoRateHz { 4.0f };
            float lfoDepth { 0.0f };
            float lfoSmoothing { 0.0f };
            float lfoRandomPhase { 0.0f };
            float lfoPhaseOffset { 0.0f };
            bool lfoRetrigger { true };
            bool lfoOneShot { false };
            bool lfo2Enabled { false };
            int lfo2Waveform { 1 };
            float lfo2RateHz { 0.5f };
            float lfo2Smoothing { 0.0f };
            float lfo2RandomPhase { 0.0f };
            float lfo2PhaseOffset { 0.0f };
            bool lfo2Retrigger { true };
            bool lfo2OneShot { false };
            bool lfoPositionBipolar { true };
            bool lfoPitchBipolar { true };
            bool lfoFilterBipolar { true };
            float lfoToPitch { 0.0f };
            float lfoToFilter { 0.0f };
            float envToFilter { 0.0f };
            DynamicModulation dynamicModulation;
            std::array<float, 4> macroValues {};
            WavetableConfig wavetable;
            float glideMs { 0.0f };
            int maxVoices { 16 };
            bool mono { false };
            bool legato { false };
            bool hasAether { false };
            AetherOscillator aetherOscA;
            AetherOscillator aetherOscB;
            AetherSub aetherSub;
            AetherNoise aetherNoise;
            float aetherRuntimeWarp { 0.0f };
            int aetherRuntimeWarpMode { 0 };
            bool hasAurum { false };
            std::array<AurumOperator, 6> aurumOperators {};
            std::array<std::array<float, 7>, 6> aurumMatrix {};
            std::array<std::array<float, 6>, 6> aurumRmMatrix {};
            int aurumUnison { 1 };
            float aurumDetuneCents { 8.0f };
            float aurumStereoSpread { 0.35f };
        };

        void setParams(const Params& p);
        bool applyRealtimeParameter(std::string_view parameterId, float value, int rampSamples = 0) noexcept;
        void prepare(double sampleRate, int blockSize);

        using WavetableCacheStats = VoiceStats::WavetableCache;
        using RenderWorkStats = VoiceStats::RenderWork;

        static VoiceStats::WavetableCache getWavetableCacheStats() noexcept;
        static VoiceStats::RenderWork consumeRenderWorkStats() noexcept;

    private:
        using StereoSample = DriveStage::StereoFrame;

        using WavetableUnisonPlan = WavetableUnison::Plan;

        using RealtimeParam = VoiceRealtimeParams::Id;

        void configureWavetableOscillators(double frequencyHz) noexcept;
        bool legacyWavetableNeedsSetup() const noexcept;
        bool aetherOscillatorNeedsWavetable(const Params::AetherOscillator& osc) const noexcept;
        void setRealtimeRamp(RealtimeParam param, float value, int rampSamples) noexcept;
        bool setRealtimeParameterValue(std::string_view parameterId, float value, int rampSamples, bool updateBaseline) noexcept;
        void applyRealtimeValue(RealtimeParam param, float value) noexcept;
        void advanceRealtimeRamps() noexcept;
        void loadPendingNoteAutomation(int midiNoteNumber) noexcept;
        void advanceVoiceAutomation() noexcept;
        float renderWavetableStack(double frequencyHz, float positionMod, float detuneCentsMod, float spreadMod) noexcept;
        void refreshCachedPanGains() noexcept;
        void refreshCachedPitchRates() noexcept;
        void refreshCachedDynamicModulationFlags() noexcept;
        float shapedEnvelope(float rawEnvelope) noexcept;
        float env1LoopValue() noexcept;
        float env2LoopValue() noexcept;
        bool aurumReleaseTailActive() const noexcept;

        Params  baseParams;
        Params  params;
        double  sampleRate { 44100.0 };
        double  phase { 0.0 };
        double  phaseDelta { 0.0 };
        double  baseFrequencyHz { 440.0 };
        double  lfoPhase { 0.0 };
        double  lfo2Phase { 0.0 };
        double  aetherOscAPhaseOffset { 0.0 };
        double  aetherOscBPhaseOffset { 0.0 };
        std::array<double, 48> aurumPhases {};
        std::array<float, 48> aurumOutputs {};
        std::array<float, 6> aurumReleaseLevels {};
        int64_t aurumAgeSamples { 0 };
        int64_t aurumReleaseAgeSamples { -1 };
        float   level { 0.0f };
        float   noteKeytrack { 0.0f };
        float   modWheel { 0.0f };
        float   pitchWheelSemitones { 0.0f };
        std::shared_ptr<const Wavetable> wavetableTable;
        std::shared_ptr<const Wavetable> aetherTableA;
        std::shared_ptr<const Wavetable> aetherTableB;
        std::array<WavetableOscillator, 8> wavetableOscillators;
        std::array<WavetableOscillator, 8> aetherOscillatorsA;
        std::array<WavetableOscillator, 8> aetherOscillatorsB;
        WavetableUnisonPlan wavetableUnisonPlan;
        WavetableUnisonPlan aetherUnisonPlanA;
        WavetableUnisonPlan aetherUnisonPlanB;
        VoiceAetherCache::PanGains cachedPanGains;
        VoiceAetherCache::PitchRates cachedPitchRates;
        DynamicModulation::TargetActivityFlags cachedDynamicTargets;
        VoiceRealtimeRampState realtimeRampState;
        VoiceNoteAutomationState noteAutomationState;
        RealtimeRamp pitchFrequencyRamp;
        int activeWavetableUnison { 1 };
        VoiceStats::RenderWorkBlock currentBlockWork;
        DriveStage::State aetherRuntimeWarpState;
        DriveStage::State driveState;
        FilterStage::State filterState;
        float previousRawEnvelope { 0.0f };
        float previousRawEnv2Envelope { 0.0f };
        EnvelopeShaper::LoopState env1LoopState;
        EnvelopeShaper::LoopState env2LoopState;
        juce::uint32 noiseState { 1 };
        juce::ADSR adsr;
        juce::ADSR::Parameters adsrParams;
        juce::ADSR env2Adsr;
        juce::ADSR::Parameters env2AdsrParams;
    };
}
