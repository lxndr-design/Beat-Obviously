#include "TrackBouncePlanner.h"

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

        Track* findTrack(Project& project, const Id& id)
        {
            for (auto& track : project.tracks)
                if (track.id == id)
                    return &track;
            return nullptr;
        }

        bool containsAudioFileId(const Project& project, const Id& id)
        {
            return std::any_of(project.audioFiles.begin(),
                               project.audioFiles.end(),
                               [&id](const AudioFileAsset& audioFile) { return audioFile.id == id; });
        }

        bool containsTrackId(const Project& project, const Id& id)
        {
            return std::any_of(project.tracks.begin(),
                               project.tracks.end(),
                               [&id](const Track& track) { return track.id == id; });
        }

        bool containsSegmentId(const Project& project, const Id& id)
        {
            for (const auto& track : project.tracks)
                for (const auto& segment : track.segments)
                    if (segment.id == id)
                        return true;
            return false;
        }

        juce::String fallbackAudioName(const juce::String& path, const juce::String& sourceName)
        {
            const juce::File file(path);
            if (file.getFileNameWithoutExtension().isNotEmpty())
                return file.getFileNameWithoutExtension();

            return sourceName.isNotEmpty() ? sourceName + " Bounce" : juce::String("Track Bounce");
        }

        std::optional<TrackBounceResult> fail(juce::String* error, const juce::String& message)
        {
            if (error != nullptr)
                *error = message;
            return std::nullopt;
        }
    }

    std::optional<TrackBounceResult> applyTrackBounce(Project& project,
                                                      const TrackBounceSpec& spec,
                                                      juce::String* error)
    {
        if (spec.sourceTrackId.isEmpty())
            return fail(error, "No source track selected for bounce.");
        if (spec.audioFilePath.trim().isEmpty())
            return fail(error, "Bounced audio path is empty.");
        if (!std::isfinite(spec.durationSeconds) || spec.durationSeconds <= 0.0)
            return fail(error, "Bounced audio duration is invalid.");
        if (!std::isfinite(project.bpm) || project.bpm <= 0.0)
            return fail(error, "Project tempo is invalid.");
        if (!std::isfinite(spec.sampleRate) || spec.sampleRate <= 0.0)
            return fail(error, "Bounced audio sample rate is invalid.");
        if (!std::isfinite(spec.startBeat) || spec.startBeat < 0.0)
            return fail(error, "Bounced audio start beat is invalid.");

        auto* sourceTrack = findTrack(project, spec.sourceTrackId);
        if (sourceTrack == nullptr)
            return fail(error, "Source track was not found for bounce.");
        if (sourceTrack->kind == TrackKind::Group)
            return fail(error, "Group track bounce is not supported yet.");

        const Id audioFileId = spec.audioFileId.isNotEmpty() ? spec.audioFileId : makeId("audio-bounce");
        const Id bouncedTrackId = spec.bouncedTrackId.isNotEmpty() ? spec.bouncedTrackId : makeId("track-bounce");
        const Id segmentId = spec.segmentId.isNotEmpty() ? spec.segmentId : makeId("segment-bounce");

        if (containsAudioFileId(project, audioFileId))
            return fail(error, "Bounced audio id already exists.");
        if (containsTrackId(project, bouncedTrackId))
            return fail(error, "Bounced track id already exists.");
        if (containsSegmentId(project, segmentId))
            return fail(error, "Bounced segment id already exists.");

        const Beats lengthBeats = spec.durationSeconds * project.bpm / 60.0;
        if (!std::isfinite(lengthBeats) || lengthBeats <= 0.0)
            return fail(error, "Bounced audio length is invalid.");

        AudioFileAsset audioFile;
        audioFile.id = audioFileId;
        audioFile.name = spec.audioFileName.isNotEmpty()
            ? spec.audioFileName
            : fallbackAudioName(spec.audioFilePath, sourceTrack->name);
        audioFile.path = spec.audioFilePath;
        audioFile.durationSeconds = spec.durationSeconds;
        audioFile.sampleRate = spec.sampleRate;

        Track bouncedTrack;
        bouncedTrack.id = bouncedTrackId;
        bouncedTrack.name = sourceTrack->name.isNotEmpty()
            ? sourceTrack->name + " Bounce"
            : juce::String("Track Bounce");
        bouncedTrack.kind = TrackKind::Audio;
        bouncedTrack.audioFileId = audioFileId;
        bouncedTrack.parentTrackId = spec.preserveParentRouting ? sourceTrack->parentTrackId : Id();

        Segment segment;
        segment.id = segmentId;
        segment.trackId = bouncedTrack.id;
        segment.kind = SegmentPayloadKind::Audio;
        segment.audioFileId = audioFileId;
        segment.startBeat = spec.startBeat;
        segment.lengthBeats = lengthBeats;
        segment.sourceStartBeat = 0.0;
        segment.audioGainDb = 0.0f;
        bouncedTrack.segments.push_back(std::move(segment));

        if (spec.muteSourceTrack)
            sourceTrack->mute = true;
        if (spec.clearSourceSolo)
            sourceTrack->solo = false;

        project.audioFiles.push_back(std::move(audioFile));
        project.tracks.push_back(std::move(bouncedTrack));
        project.lengthBeats = juce::jmax(project.lengthBeats, spec.startBeat + lengthBeats);

        return TrackBounceResult {
            spec.sourceTrackId,
            bouncedTrackId,
            audioFileId,
            segmentId,
            lengthBeats,
        };
    }
}
