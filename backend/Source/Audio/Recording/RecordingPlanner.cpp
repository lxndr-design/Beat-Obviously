#include "RecordingPlanner.h"

#include <algorithm>
#include <cmath>

namespace beat
{
    namespace
    {
        Id makeId(const char* prefix)
        {
            return juce::String(prefix) + "-" + juce::Uuid().toString();
        }

        juce::String defaultNameForPath(const juce::String& path)
        {
            const juce::File file(path);
            const auto name = file.getFileNameWithoutExtension();
            return name.isNotEmpty() ? name : juce::String("Recorded Take");
        }

        bool containsAudioFileId(const Project& project, const Id& id)
        {
            return std::any_of(project.audioFiles.begin(),
                               project.audioFiles.end(),
                               [&id](const AudioFileAsset& audioFile) { return audioFile.id == id; });
        }

        bool containsSegmentId(const Project& project, const Id& id)
        {
            for (const auto& track : project.tracks)
                for (const auto& segment : track.segments)
                    if (segment.id == id)
                        return true;
            return false;
        }

        Track* findTrack(Project& project, const Id& id)
        {
            if (id.isEmpty())
                return nullptr;

            for (auto& track : project.tracks)
                if (track.id == id)
                    return &track;
            return nullptr;
        }

        Track& findOrCreateAudioTrack(Project& project, const RecordedTakeSpec& spec)
        {
            if (auto* track = findTrack(project, spec.trackId))
            {
                track->kind = TrackKind::Audio;
                return *track;
            }

            Track track;
            track.id = spec.trackId.isNotEmpty() ? spec.trackId : makeId("track-recording");
            track.name = spec.trackName.isNotEmpty() ? spec.trackName : juce::String("Recorded Audio");
            track.kind = TrackKind::Audio;
            project.tracks.push_back(std::move(track));
            return project.tracks.back();
        }

        struct RecordedTakeTiming
        {
            Beats startBeat { 0.0 };
            Beats sourceStartBeat { 0.0 };
            Beats lengthBeats { 0.0 };
        };

        std::optional<RecordedTakeTiming> calculateTiming(const RecordedTakeSpec& spec,
                                                          juce::String* error)
        {
            const auto fail = [error](const juce::String& message) -> std::optional<RecordedTakeTiming>
            {
                if (error != nullptr)
                    *error = message;
                return std::nullopt;
            };

            const Beats rawLengthBeats = spec.durationSeconds * spec.bpm / 60.0;
            if (!std::isfinite(rawLengthBeats) || rawLengthBeats <= 0.0)
                return fail("Recorded take length is invalid.");

            const int totalLatencySamples = spec.compensateLatency
                ? juce::jmax(0, spec.inputLatencySamples)
                    + juce::jmax(0, spec.outputLatencySamples)
                    + spec.manualLatencySamples
                : 0;
            const Beats latencyBeats = (double) totalLatencySamples / spec.sampleRate * spec.bpm / 60.0;

            Beats startBeat = spec.startBeat - latencyBeats;
            Beats sourceStartBeat = 0.0;
            Beats lengthBeats = rawLengthBeats;
            if (startBeat < 0.0)
            {
                sourceStartBeat = -startBeat;
                lengthBeats -= sourceStartBeat;
                startBeat = 0.0;
            }

            if (!std::isfinite(startBeat)
                || !std::isfinite(sourceStartBeat)
                || !std::isfinite(lengthBeats)
                || lengthBeats <= 0.0)
            {
                return fail("Recorded take latency compensation leaves no playable audio.");
            }

            return RecordedTakeTiming {
                startBeat,
                sourceStartBeat,
                lengthBeats,
            };
        }
    }

    std::optional<RecordedTakeResult> appendRecordedTake(Project& project,
                                                         const RecordedTakeSpec& spec,
                                                         juce::String* error)
    {
        const auto fail = [error](const juce::String& message) -> std::optional<RecordedTakeResult>
        {
            if (error != nullptr)
                *error = message;
            return std::nullopt;
        };

        if (spec.path.trim().isEmpty())
            return fail("Recorded take path is empty.");
        if (!std::isfinite(spec.startBeat) || spec.startBeat < 0.0)
            return fail("Recorded take start beat is invalid.");
        if (!std::isfinite(spec.durationSeconds) || spec.durationSeconds <= 0.0)
            return fail("Recorded take duration is invalid.");
        if (!std::isfinite(spec.bpm) || spec.bpm <= 0.0)
            return fail("Recorded take tempo is invalid.");
        if (!std::isfinite(spec.sampleRate) || spec.sampleRate <= 0.0)
            return fail("Recorded take sample rate is invalid.");

        const Id audioFileId = spec.audioFileId.isNotEmpty() ? spec.audioFileId : makeId("audio-recording");
        const Id segmentId = spec.segmentId.isNotEmpty() ? spec.segmentId : makeId("segment-recording");

        if (containsAudioFileId(project, audioFileId))
            return fail("Recorded take audio id already exists.");
        if (containsSegmentId(project, segmentId))
            return fail("Recorded take segment id already exists.");

        Track& track = findOrCreateAudioTrack(project, spec);
        track.audioFileId = audioFileId;

        const auto timing = calculateTiming(spec, error);
        if (!timing.has_value())
            return std::nullopt;

        AudioFileAsset audioFile;
        audioFile.id = audioFileId;
        audioFile.name = spec.name.isNotEmpty() ? spec.name : defaultNameForPath(spec.path);
        audioFile.path = spec.path;
        audioFile.durationSeconds = spec.durationSeconds;
        audioFile.sampleRate = spec.sampleRate;
        project.audioFiles.push_back(std::move(audioFile));

        Segment segment;
        segment.id = segmentId;
        segment.trackId = track.id;
        segment.kind = SegmentPayloadKind::Audio;
        segment.audioFileId = audioFileId;
        segment.startBeat = timing->startBeat;
        segment.lengthBeats = timing->lengthBeats;
        segment.sourceStartBeat = timing->sourceStartBeat;
        segment.audioGainDb = spec.gainDb;
        track.segments.push_back(std::move(segment));

        project.lengthBeats = juce::jmax(project.lengthBeats, timing->startBeat + timing->lengthBeats);

        return RecordedTakeResult {
            track.id,
            audioFileId,
            segmentId,
            timing->lengthBeats,
        };
    }

    std::optional<RecordedTakeResult> commitRecordedCapture(Project& project,
                                                            const RecordingCapture& capture,
                                                            const juce::File& outputFile,
                                                            RecordedTakeSpec spec,
                                                            juce::String* error,
                                                            int bitDepth)
    {
        const auto fail = [error](const juce::String& message) -> std::optional<RecordedTakeResult>
        {
            if (error != nullptr)
                *error = message;
            return std::nullopt;
        };

        const auto stats = capture.stats();
        if (stats.active)
            return fail("Recording is still active.");
        if (stats.overflowed)
            return fail("Recording overflowed before commit.");
        if (stats.recordedSamples <= 0 || stats.sampleRate <= 0.0)
            return fail("Recording is empty.");
        if (outputFile.getFullPathName().isEmpty())
            return fail("Recording output path is empty.");

        spec.path = outputFile.getFullPathName();
        spec.durationSeconds = (double) stats.recordedSamples / stats.sampleRate;
        spec.sampleRate = stats.sampleRate;

        auto stagedProject = project;
        auto stagedResult = appendRecordedTake(stagedProject, spec, error);
        if (!stagedResult.has_value())
            return std::nullopt;

        if (!capture.writeToWav(outputFile, error, bitDepth))
            return std::nullopt;

        project = std::move(stagedProject);
        return stagedResult;
    }
}
