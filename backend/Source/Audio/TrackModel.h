#pragma once

#include <juce_core/juce_core.h>
#include <array>
#include <vector>

namespace beat
{
    using Id = juce::String;
    using Beats = double;

    enum class SegmentPayloadKind { Audio, Midi, Drum, Mixed };
    enum class TrackKind          { Audio, Midi, Mixed };

    struct MidiAutomationPoint
    {
        Beats beat { 0.0 };
        float value { 0.0f };
    };

    struct MidiAutomationLane
    {
        juce::String target;
        std::vector<MidiAutomationPoint> points;
    };

    struct MidiPitchCurvePoint
    {
        Beats beat { 0.0 };
        int pitch { 60 };
    };

    struct ProjectAutomationLane
    {
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
        std::vector<MidiPitchCurvePoint> curve;
        std::vector<MidiAutomationLane> automation;
    };

    struct Segment
    {
        Id     id;
        Id     trackId;
        Beats  startBeat   { 0.0 };
        Beats  lengthBeats { 4.0 };
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
                float phase { 0.0f };
            };

            int bank { 0 };
            bool custom { false };
            float position { 0.35f };
            float warp { 0.2f };
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

        struct AetherConfig
        {
            AetherOscillator oscA;
            AetherOscillator oscB;
            AetherSub sub;
            AetherNoise noise;
        };

        struct DynamicModTarget
        {
            float lfo { 0.0f };
            bool lfoBipolar { true };
            float env { 0.0f };
            bool envBipolar { false };
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
        };

        Id id;
        juce::String kind;
        int waveform { 1 };
        float cutoff01 { 0.6f };
        float resonance01 { 0.2f };
        float drive01 { 0.1f };
        float color01 { 0.5f };
        int filterType { 0 };
        float attackMs { 5.0f };
        float decayMs { 100.0f };
        float sustain { 0.7f };
        float releaseMs { 200.0f };
        float ampLevel { 1.0f };
        float ampPan { 0.0f };
        int wavetableBank { 0 };
        float wavetablePosition { 0.35f };
        float wavetableWarp { 0.2f };
        int wavetableUnison { 1 };
        float wavetableDetuneCents { 12.0f };
        float wavetableBlend { 0.5f };
        int lfoWaveform { 0 };
        float lfoRateHz { 4.0f };
        float lfoDepth { 0.0f };
        bool lfoRetrigger { true };
        bool lfoPositionBipolar { true };
        bool lfoPitchBipolar { true };
        bool lfoFilterBipolar { true };
        float lfoToPitch { 0.0f };
        float lfoToFilter { 0.0f };
        float envToFilter { 0.0f };
        DynamicModulation dynamicModulation;
        bool hasAether { false };
        AetherConfig aether;
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
        float  gainDb { 0.0f };
        float  pan    { 0.0f };
        bool   mute   { false };
        bool   solo   { false };
        std::vector<Segment> segments;
    };

    struct EqAutomationPoint
    {
        Beats atBeat { 0.0 };
        float lowDb  { 0.0f };
        float midDb  { 0.0f };
        float highDb { 0.0f };
        float airDb  { 0.0f };
    };

    struct Project
    {
        Id     id;
        juce::String name { "Untitled" };
        double bpm { 120.0 };
        int    timeSignatureNum   { 4 };
        int    timeSignatureDenom { 4 };
        Beats  lengthBeats { 64.0 };
        std::vector<InstrumentDefinition> instruments;
        std::vector<Track> tracks;
        std::vector<EqAutomationPoint> eqAutomation;
        std::vector<ProjectAutomationLane> automation;
    };
}
