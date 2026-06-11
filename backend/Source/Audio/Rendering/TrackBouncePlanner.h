#pragma once

#include "../TrackModel.h"

#include <optional>

namespace beat
{
    struct TrackBounceSpec
    {
        Id sourceTrackId;
        Id bouncedTrackId;
        Id audioFileId;
        Id segmentId;
        juce::String audioFileName;
        juce::String audioFilePath;
        double durationSeconds { 0.0 };
        double sampleRate { 0.0 };
        Beats startBeat { 0.0 };
        bool muteSourceTrack { true };
        bool clearSourceSolo { true };
        bool preserveParentRouting { false };
    };

    struct TrackBounceResult
    {
        Id sourceTrackId;
        Id bouncedTrackId;
        Id audioFileId;
        Id segmentId;
        Beats lengthBeats { 0.0 };
    };

    std::optional<TrackBounceResult> applyTrackBounce(Project& project,
                                                      const TrackBounceSpec& spec,
                                                      juce::String* error = nullptr);
}
