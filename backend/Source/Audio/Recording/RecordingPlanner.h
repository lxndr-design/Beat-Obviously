#pragma once

#include "RecordingCapture.h"
#include "../TrackModel.h"

#include <optional>

namespace beat
{
    struct RecordedTakeSpec
    {
        Id trackId;
        juce::String trackName { "Recorded Audio" };
        Id audioFileId;
        Id segmentId;
        juce::String name;
        juce::String path;
        Beats startBeat { 0.0 };
        double durationSeconds { 0.0 };
        double bpm { 120.0 };
        double sampleRate { 0.0 };
        float gainDb { 0.0f };
        bool compensateLatency { true };
        int inputLatencySamples { 0 };
        int outputLatencySamples { 0 };
        int manualLatencySamples { 0 };
    };

    struct RecordedTakeResult
    {
        Id trackId;
        Id audioFileId;
        Id segmentId;
        Beats lengthBeats { 0.0 };
    };

    std::optional<RecordedTakeResult> appendRecordedTake(Project& project,
                                                         const RecordedTakeSpec& spec,
                                                         juce::String* error = nullptr);

    std::optional<RecordedTakeResult> commitRecordedCapture(Project& project,
                                                            const RecordingCapture& capture,
                                                            const juce::File& outputFile,
                                                            RecordedTakeSpec spec,
                                                            juce::String* error = nullptr,
                                                            int bitDepth = 24);
}
