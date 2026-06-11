#pragma once

#include "../TrackModel.h"

#include <optional>

namespace beat
{
    struct RecordingSessionSpec
    {
        Id trackId;
        Beats requestedStartBeat { 0.0 };
        Beats countInBeats { 0.0 };
        double bpm { 120.0 };
        double sampleRate { 44100.0 };
        double maxDurationSeconds { 0.0 };
        int inputChannels { 2 };
        bool requireRecordArm { true };
    };

    struct RecordingSessionPlan
    {
        Id trackId;
        Beats transportStartBeat { 0.0 };
        Beats captureStartBeat { 0.0 };
        Beats countInBeats { 0.0 };
        double captureDelaySeconds { 0.0 };
        double maxDurationSeconds { 0.0 };
        int inputChannels { 2 };
    };

    std::optional<RecordingSessionPlan> planRecordingSession(const Project& project,
                                                             const RecordingSessionSpec& spec,
                                                             juce::String* error = nullptr);
}
