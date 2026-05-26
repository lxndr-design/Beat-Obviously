#pragma once

#include <juce_core/juce_core.h>
#include <vector>

namespace beat
{
    using Id = juce::String;
    using Beats = double;

    enum class SegmentPayloadKind { Audio, Midi, Mixed };
    enum class TrackKind          { Audio, Midi, Mixed };

    struct MidiNote
    {
        int   pitch;       // 0..127
        int   velocity;    // 0..127
        Beats startBeat;   // relative to segment
        Beats lengthBeats;
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

        // Payload — only the relevant field is populated based on `kind`.
        Id    audioFileId;
        float audioGainDb { 0.0f };
        std::vector<MidiNote> notes;
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
        std::vector<Track> tracks;
        std::vector<EqAutomationPoint> eqAutomation;
    };
}
