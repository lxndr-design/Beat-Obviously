#include "RecordingSessionPlanner.h"

#include <algorithm>
#include <cmath>

namespace beat
{
    namespace
    {
        const Track* findTrack(const Project& project, const Id& id)
        {
            if (id.isEmpty())
                return nullptr;

            for (const auto& track : project.tracks)
                if (track.id == id)
                    return &track;
            return nullptr;
        }

        const Track* findFirstArmedTrack(const Project& project)
        {
            for (const auto& track : project.tracks)
                if (track.recordArmed)
                    return &track;
            return nullptr;
        }
    }

    std::optional<RecordingSessionPlan> planRecordingSession(const Project& project,
                                                             const RecordingSessionSpec& spec,
                                                             juce::String* error)
    {
        const auto fail = [error](const juce::String& message) -> std::optional<RecordingSessionPlan>
        {
            if (error != nullptr)
                *error = message;
            return std::nullopt;
        };

        if (!std::isfinite(spec.requestedStartBeat) || spec.requestedStartBeat < 0.0)
            return fail("Recording start beat is invalid.");
        if (!std::isfinite(spec.countInBeats) || spec.countInBeats < 0.0)
            return fail("Recording count-in is invalid.");
        if (!std::isfinite(spec.bpm) || spec.bpm <= 0.0)
            return fail("Recording tempo is invalid.");
        if (!std::isfinite(spec.sampleRate) || spec.sampleRate <= 0.0)
            return fail("Recording sample rate is invalid.");
        if (!std::isfinite(spec.maxDurationSeconds) || spec.maxDurationSeconds <= 0.0)
            return fail("Recording max duration is invalid.");

        const Track* track = spec.trackId.isNotEmpty()
            ? findTrack(project, spec.trackId)
            : findFirstArmedTrack(project);

        if (track == nullptr)
            return spec.trackId.isNotEmpty()
                ? fail("Recording target track was not found.")
                : fail("No record-armed track is available.");

        if (spec.requireRecordArm && !track->recordArmed)
            return fail("Recording target track is not record-armed.");

        const Beats transportStartBeat = std::max(0.0, spec.requestedStartBeat - spec.countInBeats);
        const Beats actualCountInBeats = spec.requestedStartBeat - transportStartBeat;
        const double captureDelaySeconds = actualCountInBeats * 60.0 / spec.bpm;
        const int inputChannels = juce::jlimit(1, 32, spec.inputChannels);

        if (!std::isfinite(captureDelaySeconds))
            return fail("Recording capture delay is invalid.");

        return RecordingSessionPlan {
            track->id,
            transportStartBeat,
            spec.requestedStartBeat,
            actualCountInBeats,
            captureDelaySeconds,
            spec.maxDurationSeconds,
            inputChannels,
        };
    }
}
