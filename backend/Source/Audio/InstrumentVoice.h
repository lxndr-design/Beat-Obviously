#pragma once

#include "Envelope/EnvelopeShaper.h"
#include "Filter/DriveStage.h"
#include "Filter/FilterStage.h"
#include "Modulation/DynamicModulation.h"
#include "Oscillator/VoiceAetherCache.h"
#include "Oscillator/AetherTableStackRenderer.h"
#include "Oscillator/AetherSourceBusContext.h"
#include "Oscillator/VoiceStats.h"
#include "Realtime/RealtimeParameterQueue.h"
#include "Realtime/RealtimeRamp.h"
#include "Realtime/VoiceRealtimeRampState.h"
#include "Transitions/VoiceTransition.h"
#include "AudioQuality.h"
#include "Realtime/VoiceRealtimeParams.h"
#include "Realtime/VoiceNoteAutomation.h"
#include "Realtime/VoiceNoteAutomationState.h"
#include "Sources/MappedSampleSourceSlot.h"
#include "Sources/SfzSourceSlot.h"
#include "Sources/GranularSourceSlot.h"
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
        void aftertouchChanged(int newAftertouchValue) override;
        void channelPressureChanged(int newChannelPressureValue) override;
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
                int tuningMode { 0 };
                int harmonic { 1 };
                float ratioNumerator { 1.0f };
                float ratioDenominator { 1.0f };
                int tuningStep { 0 };
                int tuningDivisions { 12 };
                int phaseMode { 0 };
                int routing { 0 };
                float phase { 0.0f };
                float randomPhase { 0.0f };
                std::array<float, 2> fxSends {};
                WavetableConfig wavetable;
            };

            struct AetherSub
            {
                bool enabled { false };
                float level { 0.0f };
                int octave { -1 };
                int waveform { 0 };
                int routing { 0 };
                std::array<float, 2> fxSends {};
            };

            struct AetherNoise
            {
                bool enabled { false };
                float level { 0.0f };
                float color { 0.5f };
                int routing { 0 };
                std::array<float, 2> fxSends {};
            };

            struct AetherSampleSlot
            {
                bool enabled { false };
                std::shared_ptr<const ImmutableMappedSampleSource> source;
                std::shared_ptr<const SfzDecodedInstrument> sfzSource;
                int routing { 0 };
                std::array<float, 2> fxSends {};
                bool reverse { false };
                float playbackRate { 1.0f };
                bool pingPongLoop { false };
                float releaseTailMs { 4.0f };
                float sfzTrimStartRatio { 0.0f };
                float sfzTrimEndRatio { 1.0f };
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
                std::array<float, 16> harmonics {{ 1.0f }};
                float wavefold { 0.0f };
                float pitchAttackMs { 0.0f };
                float pitchDecayMs { 250.0f };
                float pitchSustain { 0.0f };
                float pitchReleaseMs { 120.0f };
                float pitchEnvelopeSemitones { 0.0f };
                float phaseAttackMs { 0.0f };
                float phaseDecayMs { 180.0f };
                float phaseSustain { 0.0f };
                float phaseReleaseMs { 100.0f };
                float phaseEnvelopeDegrees { 0.0f };
                std::array<float, 5> velocityCurve {{ 1.0f, 1.0f, 1.0f, 1.0f, 1.0f }};
                std::array<float, 5> keytrackCurve {{ 1.0f, 1.0f, 1.0f, 1.0f, 1.0f }};
                float pan { 0.0f };
            };

            struct AurumFilter
            {
                bool enabled { false };
                int type { 0 };
                float cutoff01 { 0.5f };
                float resonance01 { 0.0f };
                float drive01 { 0.0f };
            };

            struct DynamicModTarget
            {
                static constexpr size_t modulationSourceCount = 27;
                float lfo { 0.0f };
                bool lfoBipolar { true };
                float lfo2 { 0.0f };
                bool lfo2Bipolar { true };
                std::array<float, 8> extraLfo {};
                std::array<bool, 8> extraLfoBipolar {{ true, true, true, true, true, true, true, true }};
                float env { 0.0f };
                bool envBipolar { false };
                float env2 { 0.0f };
                bool env2Bipolar { false };
                float env3 { 0.0f };
                bool env3Bipolar { false };
                float env4 { 0.0f };
                bool env4Bipolar { false };
                float velocity { 0.0f };
                bool velocityBipolar { false };
                float keytrack { 0.0f };
                bool keytrackBipolar { false };
                float modWheel { 0.0f };
                bool modWheelBipolar { false };
                float pressure { 0.0f };
                bool pressureBipolar { false };
                float timbre { 0.0f };
                bool timbreBipolar { false };
                float macro1 { 0.0f };
                float macro2 { 0.0f };
                float macro3 { 0.0f };
                float macro4 { 0.0f };
                float macro5 { 0.0f };
                float macro6 { 0.0f };
                float macro7 { 0.0f };
                float macro8 { 0.0f };
                std::array<uint8_t, modulationSourceCount> curves {};
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
                DynamicModTarget oscCPosition;
                DynamicModTarget oscCFine;
                DynamicModTarget oscCLevel;
                DynamicModTarget oscCPan;
                DynamicModTarget oscAUnisonDetune;
                DynamicModTarget oscAUnisonSpread;
                DynamicModTarget oscBUnisonDetune;
                DynamicModTarget oscBUnisonSpread;
                DynamicModTarget oscCUnisonDetune;
                DynamicModTarget oscCUnisonSpread;
                DynamicModTarget filterCutoff;
                DynamicModTarget filterResonance;
                DynamicModTarget filterDrive;
                DynamicModTarget ampLevel;
                DynamicModTarget ampPan;
                DynamicModTarget unisonDetune;
                DynamicModTarget unisonSpread;
                std::array<DynamicModTarget, 6> aurumOperatorLevel;
                std::array<DynamicModTarget, 6> aurumOperatorPan;
                std::array<DynamicModTarget, 2> aurumFilterCutoff;
                std::array<DynamicModTarget, 2> aurumFilterResonance;
                std::array<DynamicModTarget, 2> aurumFilterDrive;
            };

            float cutoff01    { 0.6f };
            float filterKeytrack { 0.0f };
            float resonance01 { 0.2f };
            float drive01     { 0.1f };
            float color01     { 0.5f };
            int filterType    { 0 };
            bool filter2Enabled { false };
            int filter2Type { 0 };
            float filter2Cutoff01 { 1.0f };
            float filter2Resonance01 { 0.0f };
            float filter2Drive01 { 0.0f };
            int filterRouting { 0 };
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
            float env3AttackMs { 10.f }; int env3AttackCurve { 0 }; float env3DecayMs { 300.f }; int env3DecayCurve { 0 };
            float env3Sustain { 0.0f }; float env3ReleaseMs { 200.f }; int env3ReleaseCurve { 0 }; bool env3Loop { false };
            float env4AttackMs { 10.f }; int env4AttackCurve { 0 }; float env4DecayMs { 300.f }; int env4DecayCurve { 0 };
            float env4Sustain { 0.0f }; float env4ReleaseMs { 200.f }; int env4ReleaseCurve { 0 }; bool env4Loop { false };
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
            float lfoKeytrackRate { 0.0f };
            bool lfo2Enabled { false };
            int lfo2Waveform { 1 };
            float lfo2RateHz { 0.5f };
            float lfo2Smoothing { 0.0f };
            float lfo2RandomPhase { 0.0f };
            float lfo2PhaseOffset { 0.0f };
            bool lfo2Retrigger { true };
            bool lfo2OneShot { false };
            float lfo2KeytrackRate { 0.0f };
            struct ExtraLfo
            {
                bool enabled { false }; int waveform { 0 }; float rateHz { 1.0f }; float smoothing { 0.0f };
                float randomPhase { 0.0f }; float phaseOffset { 0.0f }; bool retrigger { true }; bool oneShot { false };
                float keytrackRate { 0.0f };
            };
            std::array<ExtraLfo, 8> extraLfos {};
            bool lfoPositionBipolar { true };
            bool lfoPitchBipolar { true };
            bool lfoFilterBipolar { true };
            float lfoToPitch { 0.0f };
            float lfoToFilter { 0.0f };
            float envToFilter { 0.0f };
            DynamicModulation dynamicModulation;
            std::array<float, 8> macroValues {};
            WavetableConfig wavetable;
            float glideMs { 0.0f };
            int maxVoices { 16 };
            bool mono { false };
            bool legato { false };
            bool hasAether { false };
            bool hasLumen { false };
            bool hasAetherSourceSends { false };
            AetherOscillator aetherOscA;
            AetherOscillator aetherOscB;
            AetherOscillator lumenOscC;
            AetherSub aetherSub;
            AetherNoise aetherNoise;
            AetherSampleSlot aetherSampleSlot1;
            std::array<AetherSampleSlot, 3> lumenSampleSlots;
            struct AetherGranularSlot
            {
                bool enabled { false };
                std::shared_ptr<const ImmutableGranularSource> source;
                float level { 0.7f };
                int routing { 0 };
                std::array<float, 2> fxSends {};
            } aetherGranularSlot2;
            std::array<AetherGranularSlot, 3> lumenGranularSlots;
            float aetherRuntimeWarp { 0.0f };
            int aetherRuntimeWarpMode { 0 };
            float aetherRuntimeWarp2 { 0.0f };
            int aetherRuntimeWarp2Mode { 0 };
            int aetherInteractionMode { 0 };
            float aetherInteractionAmount { 0.0f };
            bool hasAurum { false };
            std::array<AurumOperator, 6> aurumOperators {};
            std::array<std::array<float, 7>, 6> aurumMatrix {};
            std::array<std::array<float, 6>, 6> aurumRmMatrix {};
            std::array<std::array<float, 3>, 6> aurumOutputSends {{
                {{ 0.86f, 0.0f, 0.0f }},
            }};
            int aurumUnison { 1 };
            float aurumDetuneCents { 8.0f };
            float aurumStereoSpread { 0.35f };
            int aurumOversampling { 1 };
            std::array<AurumFilter, 2> aurumFilters {{
                { true, 0, 0.78f, 0.12f, 0.08f },
                { false, 2, 0.18f, 0.08f, 0.0f },
            }};
            int aurumFilterRouting { 0 };
        };

        void setParams(const Params& p);
        void setMemberExpression(float newPressure, float newTimbre) noexcept
        {
            pressure = juce::jlimit(0.0f, 1.0f, newPressure);
            timbre = juce::jlimit(0.0f, 1.0f, newTimbre);
        }
        void setMemberModWheel(float value) noexcept { modWheel = juce::jlimit(0.0f, 1.0f, value); }
        void setMemberPitchBendRange(float semitones) noexcept;
        void setMasterPitchWheel(int wheelValue, float semitones) noexcept;
        bool applyRealtimeParameter(std::string_view parameterId, float value, int rampSamples = 0) noexcept;
        void prepare(double sampleRate, int blockSize);
        void setProcessingQuality(AudioQuality quality) noexcept;

        using WavetableCacheStats = VoiceStats::WavetableCache;
        using RenderWorkStats = VoiceStats::RenderWork;

        static VoiceStats::WavetableCache getWavetableCacheStats() noexcept;
        static VoiceStats::RenderWork consumeRenderWorkStats() noexcept;

#if BEAT_REALTIME_SAFETY_TESTING
        double phaseMemoryBaseAForTest() const noexcept { return aetherOscABasePhase; }
        double phaseMemoryBaseBForTest() const noexcept { return aetherOscBBasePhase; }
        double wavetablePhaseAForTest() const noexcept { return aetherOscillatorsA.front().getPhase(); }
        float pressureForTest() const noexcept { return pressure; }
        float timbreForTest() const noexcept { return timbre; }
        float modWheelForTest() const noexcept { return modWheel; }
        float pitchWheelSemitonesForTest() const noexcept { return pitchWheelSemitones + masterPitchWheelSemitones; }
        float memberPitchWheelSemitonesForTest() const noexcept { return pitchWheelSemitones; }
        float masterPitchWheelSemitonesForTest() const noexcept { return masterPitchWheelSemitones; }
        float memberPitchBendRangeForTest() const noexcept { return memberPitchBendRangeSemitones; }
        int preparedRenderKernelForTest() const noexcept { return (int) preparedTopology.kernel; }
        int preparedRouteLaneMaskForTest() const noexcept { return (int) preparedTopology.routeLaneMask; }
        int preparedLumenSampleCountForTest() const noexcept { return preparedTopology.lumenSampleCount; }
        int preparedLumenGranularCountForTest() const noexcept { return preparedTopology.lumenGranularCount; }
#endif

        struct AllocationState
        {
            bool active { false };
            bool released { false };
            float currentLevel { 0.0f };
            int stableVoiceId { 0 };
        };

        void setStableVoiceId(int id) noexcept { stableVoiceId = id; }
        AllocationState allocationState() const noexcept;
        void prepareForSteal() noexcept { stealPrepared = true; }

    private:
        using StereoSample = DriveStage::StereoFrame;

        enum class RenderKernel : uint8_t
        {
            Legacy,
            Aether,
            Lumen,
            Aurum,
        };

        struct PreparedRenderTopology
        {
            RenderKernel kernel { RenderKernel::Legacy };
            uint8_t routeLaneMask { 1 };
            std::array<uint8_t, 3> lumenSampleIndices {};
            std::array<uint8_t, 3> lumenGranularIndices {};
            int lumenSampleCount { 0 };
            int lumenGranularCount { 0 };
            bool lumenOscC { false };
            bool aetherSample { false };
            bool aetherSampleUsesSfz { false };
            bool aetherGranular { false };
            bool sourceSends { false };
        };

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
        void refreshPreparedRenderTopology() noexcept;
        template <RenderKernel kernel>
        void renderPreparedBlock(juce::AudioBuffer<float>& outputBuffer,
                                 int startSample,
                                 int numSamples);
        float shapedEnvelope(float rawEnvelope) noexcept;
        float env1LoopValue() noexcept;
        float env2LoopValue() noexcept;
        float env3LoopValue() noexcept;
        float env4LoopValue() noexcept;
        bool aurumReleaseTailActive() const noexcept;

        Params  baseParams;
        Params  params;
        double  sampleRate { 44100.0 };
        double  phase { 0.0 };
        double  aetherOscABasePhase { 0.0 };
        double  aetherOscBBasePhase { 0.0 };
        double  phaseDelta { 0.0 };
        double  baseFrequencyHz { 440.0 };
        double  lfoPhase { 0.0 };
        double  lfo2Phase { 0.0 };
        std::array<double, 8> extraLfoPhases {};
        double  aetherOscAPhaseOffset { 0.0 };
        double  aetherOscBPhaseOffset { 0.0 };
        double  lumenOscCPhaseOffset { 0.0 };
        std::array<double, 48> aurumPhases {};
        std::array<float, 48> aurumOutputs {};
        std::array<float, 6> aurumReleaseLevels {};
        std::array<float, 6> aurumPitchReleaseLevels {};
        std::array<float, 6> aurumPhaseReleaseLevels {};
        int64_t aurumAgeSamples { 0 };
        int64_t aurumReleaseAgeSamples { -1 };
        bool aurumNoteActive { false };
        float   level { 0.0f };
        float   noteKeytrack { 0.0f };
        float   modWheel { 0.0f };
        float   pressure { 0.0f };
        float   timbre { 0.0f };
        float   pitchWheelSemitones { 0.0f };
        float   masterPitchWheelSemitones { 0.0f };
        float   memberPitchBendRangeSemitones { -1.0f };
        int     currentPitchWheelValue { 8192 };
        std::shared_ptr<const Wavetable> wavetableTable;
        std::shared_ptr<const Wavetable> aetherTableA;
        std::shared_ptr<const Wavetable> aetherTableB;
        std::shared_ptr<const Wavetable> lumenTableC;
        std::shared_ptr<const Wavetable> retiredWavetableTable;
        std::shared_ptr<const Wavetable> retiredAetherTableA;
        std::shared_ptr<const Wavetable> retiredAetherTableB;
        std::shared_ptr<const Wavetable> retiredLumenTableC;
        WavetableOscillatorBank::Bank wavetableOscillators;
        WavetableOscillatorBank::Bank aetherOscillatorsA;
        WavetableOscillatorBank::Bank aetherOscillatorsB;
        WavetableOscillatorBank::Bank lumenOscillatorsC;
        WavetableUnisonPlan wavetableUnisonPlan;
        WavetableUnisonPlan aetherUnisonPlanA;
        WavetableUnisonPlan aetherUnisonPlanB;
        WavetableUnisonPlan lumenUnisonPlanC;
        AetherTableStackRenderer::InteractionState aetherInteractionState;
        MappedSampleSourceSlot aetherSampleSlot1;
        SfzSourceSlot aetherSfzSlot1;
        std::array<MappedSampleSourceSlot, 3> lumenSampleSlots;
        std::array<SfzSourceSlot, 3> lumenSfzSlots;
        std::array<GranularSourceSlot, 3> lumenGranularSlots;
        GranularSourceSlot aetherGranularSlot2;
        VoiceAetherCache::PanGains cachedPanGains;
        VoiceAetherCache::PitchRates cachedPitchRates;
        DynamicModulation::TargetActivityFlags cachedDynamicTargets;
        DynamicModulation::PreparedState cachedPreparedDynamicModulation;
        VoiceRealtimeRampState realtimeRampState;
        VoiceNoteAutomationState noteAutomationState;
        RealtimeRamp pitchFrequencyRamp;
        int activeWavetableUnison { 1 };
        int aurumOutputBusMask { 0 };
        PreparedRenderTopology preparedTopology;
        VoiceStats::RenderWorkBlock currentBlockWork;
        DriveStage::State aetherRuntimeWarpState;
        DriveStage::State aetherDirectRuntimeWarpState;
        DriveStage::State aetherFilter1RuntimeWarpState;
        DriveStage::State aetherFilter2RuntimeWarpState;
        DriveStage::State aetherRuntimeWarp2State;
        DriveStage::State aetherDirectRuntimeWarp2State;
        DriveStage::State aetherFilter1RuntimeWarp2State;
        DriveStage::State aetherFilter2RuntimeWarp2State;
        DriveStage::State driveState;
        DriveStage::State filter2DriveState;
        DriveStage::State filter1RouteDriveState;
        DriveStage::State filter2RouteDriveState;
        DriveStage::State aurumFilterBDriveState;
        FilterStage::State filterState;
        FilterStage::State filter2State;
        FilterStage::State aurumFilterBState;
        FilterStage::State filter1RouteState;
        FilterStage::State filter2RouteState;
        float previousRawEnvelope { 0.0f };
        float previousRawEnv2Envelope { 0.0f };
        float previousRawEnv3Envelope { 0.0f };
        float previousRawEnv4Envelope { 0.0f };
        EnvelopeShaper::LoopState env1LoopState;
        EnvelopeShaper::LoopState env2LoopState;
        EnvelopeShaper::LoopState env3LoopState;
        EnvelopeShaper::LoopState env4LoopState;
        juce::uint32 noiseState { 1 };
        juce::ADSR adsr;
        juce::ADSR::Parameters adsrParams;
        juce::ADSR env2Adsr;
        juce::ADSR::Parameters env2AdsrParams;
        juce::ADSR env3Adsr;
        juce::ADSR::Parameters env3AdsrParams;
        juce::ADSR env4Adsr;
        juce::ADSR::Parameters env4AdsrParams;
        VoiceTransition stealTransition;
        VoiceTransition::Stereo lastOutput;
        std::array<VoiceTransition, AetherSourceBusContext::busCount> sourceSendTransitions;
        std::array<VoiceTransition::Stereo, AetherSourceBusContext::busCount> lastSourceSendOutputs {};
        int stableVoiceId { 0 };
        bool stealPrepared { false };
        AudioQuality processingQuality { AudioQuality::standardLive };
    };
}
