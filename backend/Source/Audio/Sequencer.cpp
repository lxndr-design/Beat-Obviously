#include "Sequencer.h"

#include <algorithm>

namespace beat
{
    void Sequencer::setProject(Project p)
    {
        std::atomic_store(&projectSnapshot,
                          std::static_pointer_cast<const Project>(
                              std::make_shared<Project>(std::move(p))));
    }

    void Sequencer::render(int numSamples,
                           TriggerHandler onTrigger,
                           ParameterAutomationHandler onAutomation)
    {
        if (!playing.load()) return;

        const double sr      = sampleRate.load();
        const double tempo   = bpm.load();
        const double speed   = playbackSpeed.load();
        const double beatsPerBlock = (numSamples / sr) * (tempo / 60.0) * speed;

        const double blockStart = positionBeat.load();
        const double blockEnd   = blockStart + beatsPerBlock;

        // Iterate tracks/segments from an immutable snapshot so the audio
        // thread does not block on UI-thread project updates.
        const auto snapshot = std::atomic_load(&projectSnapshot);
        if (snapshot != nullptr)
        {
            if (onAutomation && !snapshot->automation.empty())
            {
                const double samplesPerBeat = sr * 60.0 / tempo / speed;
                const auto emitProjectAutomation = [&](const ProjectAutomationLane& lane,
                                                       Beats beat,
                                                       float value,
                                                       Beats nextBeat)
                {
                    if (beat < blockStart || beat >= blockEnd)
                        return;

                    const int offsetSamples = (int) std::round((beat - blockStart) * samplesPerBeat);
                    const int rampSamples = nextBeat > beat
                        ? juce::jmax(0, (int) std::round((nextBeat - beat) * samplesPerBeat))
                        : 0;

                    onAutomation({
                        {},
                        {},
                        lane.instrumentId,
                        lane.target,
                        value,
                        juce::jlimit(0, numSamples - 1, offsetSamples),
                        rampSamples,
                        0,
                    });
                };

                for (const auto& lane : snapshot->automation)
                {
                    if (lane.target.isEmpty() || lane.target == "pitch" || lane.points.empty())
                        continue;

                    int currentIndex = -1;
                    int nextIndex = -1;
                    for (int i = 0; i < (int) lane.points.size(); ++i)
                    {
                        const auto& point = lane.points[(size_t) i];
                        if (point.beat <= blockStart)
                            currentIndex = i;
                        else
                        {
                            nextIndex = i;
                            break;
                        }
                    }

                    if (currentIndex >= 0)
                    {
                        const auto& current = lane.points[(size_t) currentIndex];
                        if (nextIndex >= 0)
                        {
                            const auto& nextPoint = lane.points[(size_t) nextIndex];
                            const double width = juce::jmax(0.000001, nextPoint.beat - current.beat);
                            const float t = (float) juce::jlimit(0.0, 1.0, (blockStart - current.beat) / width);
                            const float value = current.value + (nextPoint.value - current.value) * t;
                            emitProjectAutomation(lane, blockStart, value, nextPoint.beat);
                        }
                        else
                        {
                            emitProjectAutomation(lane, blockStart, current.value, blockStart);
                        }
                    }

                    const int firstFutureIndex = nextIndex >= 0
                        ? nextIndex
                        : currentIndex >= 0
                            ? currentIndex + 1
                            : 0;
                    for (int i = firstFutureIndex; i < (int) lane.points.size(); ++i)
                    {
                        const auto& point = lane.points[(size_t) i];
                        if (point.beat < blockStart || point.beat >= blockEnd)
                            continue;
                        const Beats nextBeat = i + 1 < (int) lane.points.size()
                            ? lane.points[(size_t) (i + 1)].beat
                            : point.beat;
                        emitProjectAutomation(lane, point.beat, point.value, nextBeat);
                    }
                }
            }

            const bool anySolo = std::any_of(
                snapshot->tracks.begin(),
                snapshot->tracks.end(),
                [](const Track& track) { return track.solo; });

            for (const auto& track : snapshot->tracks)
            {
                if (track.mute) continue;
                if (anySolo && !track.solo) continue;

                for (const auto& seg : track.segments)
                {
                    if (seg.muted) continue;
                    // Compute every occurrence of this segment (including
                    // repeats up to the next segment's start, mimicking the
                    // frontend's expandTrackSegments).
                    Beats segStart = seg.startBeat;
                    Beats segLen   = seg.lengthBeats;
                    int   maxReps  = seg.repeats > 0 ? seg.repeats + 1 : 1;

                    for (int rep = 0; rep < maxReps; ++rep)
                    {
                        const Beats occStart = segStart + segLen * (double) rep;
                        const Beats occEnd   = occStart + segLen;

                        if (occEnd < blockStart || occStart > blockEnd) continue;

                        if (onAutomation && !seg.automation.empty())
                        {
                            const auto targetInstrumentId = seg.instrumentId.isNotEmpty()
                                ? seg.instrumentId
                                : track.instrumentId;
                            const Beats localStart = juce::jlimit(0.0, segLen, blockStart - occStart);
                            const Beats localEnd = juce::jlimit(0.0, segLen, blockEnd - occStart);
                            const double samplesPerBeat = sr * 60.0 / tempo / speed;

                            const auto emitAutomation = [&](const MidiAutomationLane& lane,
                                                            Beats localBeat,
                                                            float value,
                                                            Beats nextBeat)
                            {
                                const Beats absoluteBeat = occStart + localBeat;
                                if (absoluteBeat < blockStart || absoluteBeat >= blockEnd)
                                    return;

                                const int offsetSamples = (int) std::round((absoluteBeat - blockStart) * samplesPerBeat);
                                const int rampSamples = nextBeat > localBeat
                                    ? juce::jmax(0, (int) std::round((nextBeat - localBeat) * samplesPerBeat))
                                    : 0;

                                onAutomation({
                                    track.id,
                                    seg.id,
                                    targetInstrumentId,
                                    lane.target,
                                    value,
                                    juce::jlimit(0, numSamples - 1, offsetSamples),
                                    rampSamples,
                                    rep,
                                });
                            };

                            for (const auto& lane : seg.automation)
                            {
                                if (lane.target.isEmpty() || lane.target == "pitch" || lane.points.empty())
                                    continue;

                                int currentIndex = -1;
                                int nextIndex = -1;
                                for (int i = 0; i < (int) lane.points.size(); ++i)
                                {
                                    const auto& point = lane.points[(size_t) i];
                                    if (point.beat <= localStart)
                                        currentIndex = i;
                                    else
                                    {
                                        nextIndex = i;
                                        break;
                                    }
                                }

                                if (currentIndex >= 0)
                                {
                                    const auto& current = lane.points[(size_t) currentIndex];
                                    if (nextIndex >= 0)
                                    {
                                        const auto& nextPoint = lane.points[(size_t) nextIndex];
                                        const double width = juce::jmax(0.000001, nextPoint.beat - current.beat);
                                        const float t = (float) juce::jlimit(0.0, 1.0, (localStart - current.beat) / width);
                                        const float value = current.value + (nextPoint.value - current.value) * t;
                                        emitAutomation(lane, localStart, value, nextPoint.beat);
                                    }
                                    else
                                    {
                                        emitAutomation(lane, localStart, current.value, localStart);
                                    }
                                }

                                const int firstFutureIndex = nextIndex >= 0
                                    ? nextIndex
                                    : currentIndex >= 0
                                        ? currentIndex + 1
                                        : 0;
                                for (int i = firstFutureIndex; i < (int) lane.points.size(); ++i)
                                {
                                    const auto& point = lane.points[(size_t) i];
                                    if (point.beat < localStart || point.beat >= localEnd)
                                        continue;
                                    const Beats nextBeat = i + 1 < (int) lane.points.size()
                                        ? lane.points[(size_t) (i + 1)].beat
                                        : point.beat;
                                    emitAutomation(lane, point.beat, point.value, nextBeat);
                                }
                            }
                        }

                        if (seg.kind == SegmentPayloadKind::Midi
                            || seg.kind == SegmentPayloadKind::Mixed
                            || seg.kind == SegmentPayloadKind::Drum)
                        {
                            for (const auto& note : seg.notes)
                            {
                                const Beats noteAbs = occStart + note.startBeat;
                                if (noteAbs >= blockStart && noteAbs < blockEnd)
                                {
                                    const double offsetBeats = noteAbs - blockStart;
                                    const int    offsetSamples =
                                        (int) std::round(offsetBeats * 60.0 / tempo * sr / speed);
                                    const int lengthSamples =
                                        juce::jmax(1, (int) std::round(note.lengthBeats * 60.0 / tempo * sr / speed));

                                    onTrigger({
                                        track.id,
                                        seg.id,
                                        note.instrumentId.isNotEmpty()
                                            ? note.instrumentId
                                            : seg.instrumentId.isNotEmpty()
                                                ? seg.instrumentId
                                                : track.instrumentId,
                                        note.pitch,
                                        note.velocity,
                                        note.lengthBeats,
                                        lengthSamples,
                                        juce::jlimit(0, numSamples - 1, offsetSamples),
                                        rep,
                                        occStart,
                                        track.gainDb,
                                        track.pan,
                                        seg.audioGainDb,
                                        &note,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Advance time, honoring loop.
        double next = blockEnd;
        if (loopEnabled.load() && next >= loopEnd.load())
        {
            const double range = loopEnd.load() - loopStart.load();
            if (range > 0)
                next = loopStart.load() + std::fmod(next - loopStart.load(), range);
        }
        positionBeat.store(next);
    }
}
