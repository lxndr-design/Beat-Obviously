#pragma once

#include "Realtime/RealtimeParameterQueue.h"
#include "Wavetable/WavetableFactory.h"
#include "Wavetable/WavetableOscillator.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <memory>
#include <string_view>
#include <utility>

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
                       juce::SynthesiserSound*, int /*currentPitchWheel*/) override;
        void stopNote(float velocity, bool allowTailOff) override;
        void pitchWheelMoved(int) override {}
        void controllerMoved(int, int) override {}
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
                    float phase { 0.0f };
                };

                int bank { 0 };
                bool custom { false };
                float position { 0.35f };
                float warp { 0.2f };
                int warpMode { 0 };
                int unison { 1 };
                float detuneCents { 12.0f };
                float blend { 0.5f };
                std::array<CustomFrame, 4> customFrames {{
                    { 0.22f, 0.08f, 0.05f, 0.0f },
                    { 0.46f, 0.28f, 0.16f, 0.12f },
                    { 0.72f, 0.48f, 0.34f, -0.08f },
                    { 0.94f, 0.72f, 0.56f, 0.2f },
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

            struct DynamicModTarget
            {
                float lfo { 0.0f };
                bool lfoBipolar { true };
                float lfo2 { 0.0f };
                bool lfo2Bipolar { true };
                float env { 0.0f };
                bool envBipolar { false };
                float velocity { 0.0f };
                bool velocityBipolar { false };
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
            float ampLevel  { 1.0f };
            float ampPan    { 0.0f };
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
            WavetableConfig wavetable;
            bool hasAether { false };
            AetherOscillator aetherOscA;
            AetherOscillator aetherOscB;
            AetherSub aetherSub;
            AetherNoise aetherNoise;
        };

        void setParams(const Params& p);
        bool applyRealtimeParameter(std::string_view parameterId, float value, int rampSamples = 0) noexcept;
        void prepare(double sampleRate, int blockSize);

        static constexpr size_t maxNoteAutomationEvents = 128;
        static constexpr size_t maxPendingNoteAutomationContexts = 64;

        struct NoteAutomationContext
        {
            struct PitchEvent
            {
                int sampleOffset { 0 };
                float frequencyHz { 440.0f };
                int rampSamples { 0 };
            };

            int midiNoteNumber { -1 };
            int eventCount { 0 };
            std::array<RealtimeParameterChange, maxNoteAutomationEvents> events {};
            int pitchEventCount { 0 };
            std::array<PitchEvent, maxNoteAutomationEvents> pitchEvents {};
        };

        static void setPendingNoteAutomationContexts(NoteAutomationContext* contexts, int count) noexcept;
        static void clearPendingNoteAutomationContexts() noexcept;

        struct WavetableCacheStats
        {
            int64_t hits { 0 };
            int64_t misses { 0 };
            int size { 0 };
        };

        struct RenderWorkStats
        {
            int64_t voiceBlocks { 0 };
            int64_t voiceSamples { 0 };
            int64_t oscillatorSamples { 0 };
            int64_t wavetableVoiceSamples { 0 };
            int64_t aetherOscASamples { 0 };
            int64_t aetherOscBSamples { 0 };
            int64_t aetherSubSamples { 0 };
            int64_t aetherNoiseSamples { 0 };
            int64_t filterSamples { 0 };
            int64_t filterDriveSamples { 0 };
            int64_t filterCoefficientUpdates { 0 };
            int64_t modulationSamples { 0 };
            int64_t realtimeRampSamples { 0 };
            int64_t oscillatorRateCalculations { 0 };
            int64_t wavetableFrequencyUpdates { 0 };
            int64_t wavetablePositionUpdates { 0 };
        };

        static WavetableCacheStats getWavetableCacheStats() noexcept;
        static RenderWorkStats consumeRenderWorkStats() noexcept;

    private:
        struct StereoSample
        {
            float left { 0.0f };
            float right { 0.0f };
        };

        struct WavetableUnisonPlan
        {
            int unison { 0 };
            float detuneCents { -1.0f };
            float spread { -1.0f };
            float weightSum { 1.0f };
            std::array<double, 8> rates {};
            std::array<double, 8> appliedFrequencyHz {};
            std::array<float, 8> centered {};
            std::array<float, 8> weights {};
            std::array<float, 8> phaseSpread {};
            std::array<float, 8> appliedPosition {};
        };

        enum class RealtimeParam : size_t
        {
            FilterCutoff,
            FilterResonance,
            FilterDrive,
            AmpLevel,
            AmpPan,
            OscAPosition,
            OscBPosition,
            OscAFine,
            OscBFine,
            OscALevel,
            OscBLevel,
            OscAPan,
            OscBPan,
            UnisonDetune,
            UnisonSpread,
            LfoRate,
            LfoDepth,
            Count,
        };

        struct RealtimeRamp
        {
            float current { 0.0f };
            float target { 0.0f };
            float step { 0.0f };
            int remaining { 0 };

            void reset(float value) noexcept;
            void setTarget(float value, int rampSamples) noexcept;
            float next() noexcept;
            bool active() const noexcept { return remaining > 0; }
        };

        void configureWavetableOscillators(double frequencyHz) noexcept;
        void clearWavetableOscillatorBank(
            std::array<WavetableOscillator, 8>& oscillators,
            WavetableUnisonPlan& plan) noexcept;
        bool legacyWavetableNeedsSetup() const noexcept;
        bool aetherOscillatorNeedsWavetable(const Params::AetherOscillator& osc) const noexcept;
        void resetRealtimeRampsFromParams() noexcept;
        void setRealtimeRamp(RealtimeParam param, float value, int rampSamples) noexcept;
        void activateRealtimeRamp(RealtimeParam param) noexcept;
        void deactivateRealtimeRamp(RealtimeParam param) noexcept;
        bool setRealtimeParameterValue(std::string_view parameterId, float value, int rampSamples, bool updateBaseline) noexcept;
        void applyParamToParams(Params& target, RealtimeParam param, float value) noexcept;
        void applyRealtimeValue(RealtimeParam param, float value) noexcept;
        void advanceRealtimeRamps() noexcept;
        void loadPendingNoteAutomation(int midiNoteNumber) noexcept;
        void advanceVoiceAutomation() noexcept;
        float renderWavetableStack(double frequencyHz, float positionMod, float detuneCentsMod, float spreadMod) noexcept;
        void configureWavetableOscillatorBank(
            std::array<WavetableOscillator, 8>& oscillators,
            const Wavetable* table,
            const Params::WavetableConfig& config,
            double frequencyHz) noexcept;
        float renderWavetableOscillatorBank(
            std::array<WavetableOscillator, 8>& oscillators,
            WavetableUnisonPlan& plan,
            const Params::WavetableConfig& config,
            double frequencyHz,
            float positionMod,
            float detuneCentsMod,
            float spreadMod) noexcept;
        WavetableUnisonPlan& updateWavetableUnisonPlan(
            WavetableUnisonPlan& plan,
            const Params::WavetableConfig& config,
            float detuneCentsMod,
            float spreadMod) noexcept;
        void invalidateWavetableBankCache(WavetableUnisonPlan& plan) noexcept;
        void refreshCachedPanGains() noexcept;
        void refreshCachedPitchRates() noexcept;
        void refreshCachedDynamicModulationFlags() noexcept;
        StereoSample renderAetherTableStack(double frequencyHz, float rawLfo, float rawLfo2, float env, float velocity) noexcept;
        StereoSample processDriveOversampled(StereoSample sample, float driveGain) noexcept;
        float shapedEnvelope(float rawEnvelope) noexcept;
        float keytrackedCutoffHz(float normalizedCutoff) const noexcept;

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
        float   level { 0.0f };
        float   cachedFilterHz { -1.0f };
        float   cachedFilterResonance { -1.0f };
        std::shared_ptr<const Wavetable> wavetableTable;
        std::shared_ptr<const Wavetable> aetherTableA;
        std::shared_ptr<const Wavetable> aetherTableB;
        std::array<WavetableOscillator, 8> wavetableOscillators;
        std::array<WavetableOscillator, 8> aetherOscillatorsA;
        std::array<WavetableOscillator, 8> aetherOscillatorsB;
        WavetableUnisonPlan wavetableUnisonPlan;
        WavetableUnisonPlan aetherUnisonPlanA;
        WavetableUnisonPlan aetherUnisonPlanB;
        std::pair<float, float> cachedAmpPanGains { 1.0f, 1.0f };
        std::pair<float, float> cachedAetherOscAPanGains { 1.0f, 1.0f };
        std::pair<float, float> cachedAetherOscBPanGains { 1.0f, 1.0f };
        double cachedAetherOscARate { 1.0 };
        double cachedAetherOscBRate { 1.0 };
        double cachedAetherSubRate { 0.5 };
        bool cachedAmpPanDynamic { false };
        bool cachedAetherOscAPanDynamic { false };
        bool cachedAetherOscBPanDynamic { false };
        bool cachedAetherOscAFineDynamic { false };
        bool cachedAetherOscBFineDynamic { false };
        bool cachedAetherOscAPositionDynamic { false };
        bool cachedAetherOscBPositionDynamic { false };
        bool cachedAetherOscALevelDynamic { false };
        bool cachedAetherOscBLevelDynamic { false };
        bool cachedFilterCutoffDynamic { false };
        bool cachedFilterResonanceDynamic { false };
        bool cachedFilterDriveDynamic { false };
        bool cachedAmpLevelDynamic { false };
        bool cachedUnisonDetuneDynamic { false };
        bool cachedUnisonSpreadDynamic { false };
        bool cachedAnyDynamicModulationTarget { false };
        std::array<RealtimeRamp, (size_t) RealtimeParam::Count> realtimeRamps;
        std::array<size_t, (size_t) RealtimeParam::Count> activeRealtimeRampIndices {};
        int activeRealtimeRampCount { 0 };
        std::array<RealtimeParameterChange, maxNoteAutomationEvents> voiceAutomationEvents;
        std::array<NoteAutomationContext::PitchEvent, maxNoteAutomationEvents> voicePitchEvents;
        int voiceAutomationEventCount { 0 };
        int voicePitchEventCount { 0 };
        int nextVoiceAutomationEvent { 0 };
        int nextVoicePitchEvent { 0 };
        int voiceSamplePosition { 0 };
        RealtimeRamp pitchFrequencyRamp;
        int activeWavetableUnison { 1 };
        int64_t currentBlockOscillatorSamples { 0 };
        int64_t currentBlockWavetableVoiceSamples { 0 };
        int64_t currentBlockAetherOscASamples { 0 };
        int64_t currentBlockAetherOscBSamples { 0 };
        int64_t currentBlockAetherSubSamples { 0 };
        int64_t currentBlockAetherNoiseSamples { 0 };
        int64_t currentBlockOscillatorRateCalculations { 0 };
        int64_t currentBlockFilterDriveSamples { 0 };
        int64_t currentBlockFilterCoefficientUpdates { 0 };
        int64_t currentBlockWavetableFrequencyUpdates { 0 };
        int64_t currentBlockWavetablePositionUpdates { 0 };
        StereoSample previousDriveInput;
        StereoSample driveDownsampleState;
        float previousRawEnvelope { 0.0f };
        juce::uint32 noiseState { 1 };
        juce::ADSR adsr;
        juce::ADSR::Parameters adsrParams;
        juce::dsp::StateVariableTPTFilter<float> filterLeft;
        juce::dsp::StateVariableTPTFilter<float> filterRight;
    };
}
