#pragma once

#include <juce_core/juce_core.h>
#include <array>
#include <optional>
#include <vector>

#include "Nodemap/NodemapGraph.h"

namespace beat
{
    using Id = juce::String;
    using Beats = double;

    enum class SegmentPayloadKind { Audio, Midi, Drum, Mixed, Drumpad };
    enum class TrackKind          { Audio, Midi, Mixed, Group };
    enum class TrackEffectKind    { Bitcrush, Lowpass, Highpass, Saturator, Reverb, Delay, Compressor, Plugin, Unknown, Chorus, Phaser, Flanger, Distortion };
    enum class AutomationCurve    { Hold, Linear, Quadratic, Cubic, EaseIn, EaseOut, Smoothstep };

    struct MidiAutomationPoint
    {
        Beats beat { 0.0 };
        float value { 0.0f };
        AutomationCurve curve { AutomationCurve::Linear };
    };

    struct MidiAutomationLane
    {
        juce::String target;
        std::vector<MidiAutomationPoint> points;
    };

    struct MidiPitchCurvePoint
    {
        Beats beat { 0.0 };
        double pitch { 60.0 };
    };

    struct ProjectAutomationLane
    {
        Id trackId;
        Id instrumentId;
        juce::String target;
        std::vector<MidiAutomationPoint> points;
    };

    struct MidiNote
    {
        Id    instrumentId;
        int   pitch;       // 0..127
        int   velocity;    // 0..127
        Beats startBeat;   // relative to segment
        Beats lengthBeats;
        int   connectToIndex { -1 };
        std::vector<MidiPitchCurvePoint> curve;
        std::vector<MidiAutomationLane> automation;
    };

    struct TrackEffectParam
    {
        juce::String key;
        float value { 0.0f };
    };

    struct TrackEffect
    {
        Id id;
        TrackEffectKind kind { TrackEffectKind::Unknown };
        int schemaVersion { 1 };
        bool bypassed { false };
        Id pluginId;
        juce::String pluginName;
        juce::String pluginFormat;
        int latencySamples { 0 };
        std::vector<TrackEffectParam> params;
        std::vector<MidiAutomationLane> automation;
    };

    struct TrackSend
    {
        Id busId;
        float gainDb { -96.0f };
        float pan { 0.0f };
        bool enabled { true };
    };

    struct ReturnBus
    {
        Id id;
        juce::String name;
        float gainDb { 0.0f };
        float pan { 0.0f };
        bool mute { false };
        std::vector<TrackEffect> effects;
    };

    struct Segment
    {
        Id     id;
        Id     trackId;
        Beats  startBeat   { 0.0 };
        Beats  lengthBeats { 4.0 };
        Beats  sourceStartBeat { 0.0 };
        Beats  fadeInBeats { 0.0 };
        Beats  fadeOutBeats { 0.0 };
        int    repeats     { 0 };
        int    layer       { 0 };
        bool   muted       { false };
        SegmentPayloadKind kind { SegmentPayloadKind::Midi };
        Id     instrumentId;

        // Payload — only the relevant field is populated based on `kind`.
        Id    audioFileId;
        float audioGainDb { 0.0f };
        std::vector<MidiNote> notes;
        std::vector<MidiAutomationLane> automation;
    };

    struct InstrumentDefinition
    {
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
            struct ManagedSfz
            {
                int schemaVersion { 1 };
                Id assetId;
                juce::String displayName;
                juce::String manifestPath;
                juce::String sourcePath;
                std::vector<juce::String> samplePaths;
            };

            struct Zone
            {
                Id audioFileId;
                int rootNote { 60 };
                int loNote { 0 };
                int hiNote { 127 };
                int loVelocity { 0 };
                int hiVelocity { 127 };
                float level { 0.8f };
                float pan { 0.0f };
                float startRatio { 0.0f };
                float endRatio { 1.0f };
                bool loopEnabled { false };
                float loopStartRatio { 0.0f };
                float loopEndRatio { 1.0f };
            };

            int schemaVersion { 5 };
            bool enabled { false };
            Id audioFileId;
            int rootNote { 60 };
            float level { 0.8f };
            float pan { 0.0f };
            int routing { 0 };
            float startRatio { 0.0f };
            float endRatio { 1.0f };
            bool loopEnabled { false };
            float loopStartRatio { 0.0f };
            float loopEndRatio { 1.0f };
            std::vector<Zone> zones;
            ManagedSfz managedSfz;
            std::array<float, 2> fxSends {};
        };

        struct AetherGranularSlot
        {
            struct ManagedAsset
            {
                int schemaVersion { 1 };
                Id assetId;
                juce::String displayName;
                juce::String manifestPath;
                juce::String audioPath;
            };

            int schemaVersion { 1 };
            bool enabled { false };
            juce::String builtinSource;
            int rootNote { 60 };
            float level { 0.7f };
            int routing { 0 };
            float position { 0.5f };
            float positionSpread { 0.1f };
            float grainMilliseconds { 80.0f };
            float densityHz { 12.0f };
            float pitchSemitones { 0.0f };
            float stereoSpread { 0.5f };
            uint32_t randomSeed { 1 };
            ManagedAsset managedAsset;
            std::array<float, 2> fxSends {};
        };

        struct AetherSpectralSlot
        {
            struct ManagedAsset
            {
                int schemaVersion { 1 };
                Id assetId;
                juce::String displayName;
                juce::String manifestPath;
                juce::String sourcePath;
                juce::String artifactPath;
            };

            int schemaVersion { 1 };
            bool enabled { false };
            juce::String builtinSource;
            int rootNote { 60 };
            float level { 0.7f };
            float pan { 0.0f };
            float stereoWidth { 1.0f };
            float position { 0.0f };
            float pitchSemitones { 0.0f };
            bool freeze { false };
            int routing { 0 };
            ManagedAsset managedAsset;
            std::array<float, 2> fxSends {};
        };

        struct AetherConfig
        {
            struct MemberExpressionZone
            {
                int schemaVersion { 1 };
                bool enabled { false };
                int masterChannel { 1 };
                int firstMemberChannel { 2 };
                int lastMemberChannel { 16 };
            };

            AetherOscillator oscA;
            AetherOscillator oscB;
            AetherSub sub;
            AetherNoise noise;
            AetherSampleSlot sampleSlot1;
            AetherGranularSlot granularSlot2;
            AetherSpectralSlot spectralSlot3;
            std::array<Id, 2> fxBusIds {};
            float runtimeWarp { 0.0f };
            int runtimeWarpMode { 0 };
            float runtimeWarp2 { 0.0f };
            int runtimeWarp2Mode { 0 };
            int interactionMode { 0 }; // 0 off, 1 amplitude modulation, 2 ring modulation
            float interactionAmount { 0.0f };
            MemberExpressionZone memberExpressionZone;
        };

        struct DynamicModTarget
        {
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
            DynamicModTarget oscAUnisonDetune;
            DynamicModTarget oscAUnisonSpread;
            DynamicModTarget oscBUnisonDetune;
            DynamicModTarget oscBUnisonSpread;
            DynamicModTarget filterCutoff;
            DynamicModTarget filterResonance;
            DynamicModTarget filterDrive;
            DynamicModTarget ampLevel;
            DynamicModTarget ampPan;
            DynamicModTarget unisonDetune;
            DynamicModTarget unisonSpread;
        };

        struct SampleZone
        {
            juce::String path;
            int rootNote { 60 };
            int loNote { 0 };
            int hiNote { 127 };
            int loVel { 0 };
            int hiVel { 127 };
            float volumeDb { 0.0f };
            float pan { 0.0f };
            float tuningCents { 0.0f };
            int seqPosition { 0 };
            bool loopEnabled { false };
            int loopStart { 0 };
            int loopEnd { 0 };
            bool oneShot { false };
            double durationSeconds { 0.0 };
            double loLengthSeconds { 0.0 };
            double hiLengthSeconds { 0.0 };
            int chokeGroup { 0 };
            int startSample { 0 };
            int endSample { 0 };
        };

        Id id;
        juce::String kind;
        int waveform { 1 };
        float cutoff01 { 0.6f };
        float filterKeytrack { 0.0f };
        float resonance01 { 0.2f };
        float drive01 { 0.1f };
        float color01 { 0.5f };
        int filterType { 0 };
        bool filter2Enabled { false };
        int filter2Type { 0 };
        float filter2Cutoff01 { 1.0f };
        float filter2Resonance01 { 0.0f };
        float filter2Drive01 { 0.0f };
        int filterRouting { 0 };
        float attackMs { 5.0f };
        int attackCurve { 0 };
        float decayMs { 100.0f };
        int decayCurve { 0 };
        float sustain { 0.7f };
        float releaseMs { 200.0f };
        int releaseCurve { 0 };
        bool env1Loop { false };
        float env2AttackMs { 10.0f };
        int env2AttackCurve { 0 };
        float env2DecayMs { 300.0f };
        int env2DecayCurve { 0 };
        float env2Sustain { 0.0f };
        float env2ReleaseMs { 200.0f };
        int env2ReleaseCurve { 0 };
        bool env2Loop { false };
        float env3AttackMs { 10.0f };
        int env3AttackCurve { 0 };
        float env3DecayMs { 300.0f };
        int env3DecayCurve { 0 };
        float env3Sustain { 0.0f };
        float env3ReleaseMs { 200.0f };
        int env3ReleaseCurve { 0 };
        bool env3Loop { false };
        float env4AttackMs { 10.0f };
        int env4AttackCurve { 0 };
        float env4DecayMs { 300.0f };
        int env4DecayCurve { 0 };
        float env4Sustain { 0.0f };
        float env4ReleaseMs { 200.0f };
        int env4ReleaseCurve { 0 };
        bool env4Loop { false };
        float ampLevel { 1.0f };
        float ampPan { 0.0f };
        float glideMs { 0.0f };
        int maxVoices { 16 };
        bool mono { false };
        bool legato { false };
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
        bool lfoSync { false };
        juce::String lfoSyncedRate { "1/4" };
        float lfoSmoothing { 0.0f };
        float lfoRandomPhase { 0.0f };
        float lfoPhaseOffset { 0.0f };
        bool lfoRetrigger { true };
        bool lfoOneShot { false };
        bool lfo2Enabled { false };
        int lfo2Waveform { 1 };
        float lfo2RateHz { 0.5f };
        bool lfo2Sync { false };
        juce::String lfo2SyncedRate { "1/2" };
        float lfo2Smoothing { 0.0f };
        float lfo2RandomPhase { 0.0f };
        float lfo2PhaseOffset { 0.0f };
        bool lfo2Retrigger { true };
        bool lfo2OneShot { false };
        struct ExtraLfo
        {
            bool enabled { false };
            int waveform { 0 };
            float rateHz { 1.0f };
            bool sync { false };
            juce::String syncedRate { "1/4" };
            float smoothing { 0.0f };
            float randomPhase { 0.0f };
            float phaseOffset { 0.0f };
            bool retrigger { true };
            bool oneShot { false };
        };
        std::array<ExtraLfo, 8> extraLfos {};
        bool lfoPositionBipolar { true };
        bool lfoPitchBipolar { true };
        bool lfoFilterBipolar { true };
        float lfoToPitch { 0.0f };
        float lfoToFilter { 0.0f };
        float envToFilter { 0.0f };
        std::array<float, 8> macroValues {};
        DynamicModulation dynamicModulation;
        bool hasAether { false };
        AetherConfig aether;
        std::optional<Nodemap::Graph> nodeGraph;
        juce::var taxonomy;
        std::vector<TrackEffect> effects;
        juce::StringArray sampleUrls;
        std::vector<SampleZone> sampleZones;
    };

    struct Track
    {
        Id     id;
        juce::String name;
        TrackKind kind { TrackKind::Audio };
        Id     instrumentId;
        Id     audioFileId;
        Id     parentTrackId;
        float  gainDb { 0.0f };
        float  pan    { 0.0f };
        bool   mute   { false };
        bool   solo   { false };
        bool   recordArmed { false };
        bool   inputMonitoring { false };
        juce::String inputDeviceId;
        int    inputChannelStart { 0 };
        int    inputChannelCount { 1 };
        float  recordGainDb { 0.0f };
        std::vector<TrackSend> sends;
        std::vector<TrackEffect> effects;
        std::vector<Segment> segments;
    };

    struct PluginCapability
    {
        Id id;
        juce::String kind;
        juce::String label;
        bool realtime { false };
        bool offline { false };
        int latencySamples { 0 };
        juce::String fallbackMode;
    };

    struct PluginAdapterDefinition
    {
        Id id;
        juce::String name;
        juce::String vendor;
        juce::String version;
        juce::String kind;
        juce::String format;
        juce::String status;
        juce::String instrumentMode;
        juce::String description;
        juce::String sourceFileName;
        juce::String sourcePath;
        juce::String uiImagePath;
        juce::String uiImageDataUrl;
        Id associatedInstrumentId;
        int uiWidth { 0 };
        int uiHeight { 0 };
        juce::var uiControlDetails;
        int sampleCount { 0 };
        int uiControlCount { 0 };
        bool factory { false };
        double installedAt { 0.0 };
        std::vector<PluginCapability> capabilities;
    };

    struct AudioFileAsset
    {
        Id id;
        juce::String name;
        juce::String path;
        double durationSeconds { 0.0 };
        double sampleRate { 0.0 };
    };

    struct EqAutomationPoint
    {
        Beats atBeat { 0.0 };
        float lowDb  { 0.0f };
        float midDb  { 0.0f };
        float highDb { 0.0f };
        float airDb  { 0.0f };
    };

    struct RecordingInputProfile
    {
        juce::String inputDeviceId;
        juce::String inputDeviceName;
        int inputChannelStart { 0 };
        int inputChannelCount { 2 };
        double calibrationSampleRate { 0.0 };
        int measuredRoundTripSamples { 0 };
        int reportedInputLatencySamples { 0 };
        int reportedOutputLatencySamples { 0 };
        int userLatencyAdjustmentSamples { 0 };
    };

    struct MasterChainSettings
    {
        float inputGainDb { 0.0f };
        bool compressorEnabled { false };
        float compressorThresholdDb { -18.0f };
        float compressorRatio { 2.0f };
        float compressorAttackMs { 20.0f };
        float compressorReleaseMs { 160.0f };
        float compressorMakeupDb { 0.0f };
        float compressorMix { 100.0f };
        float outputGainDb { 0.0f };
    };

    struct Project
    {
        Id     id;
        juce::String name { "Untitled" };
        double bpm { 120.0 };
        int    timeSignatureNum   { 4 };
        int    timeSignatureDenom { 4 };
        Beats  lengthBeats { 64.0 };
        std::vector<AudioFileAsset> audioFiles;
        std::vector<InstrumentDefinition> instruments;
        std::vector<PluginAdapterDefinition> plugins;
        std::vector<Track> tracks;
        std::vector<ReturnBus> returnBuses;
        std::vector<EqAutomationPoint> eqAutomation;
        std::vector<ProjectAutomationLane> automation;
        RecordingInputProfile recordingInput;
        MasterChainSettings masterChain;
    };
}
