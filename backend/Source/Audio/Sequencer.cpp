#include "Sequencer.h"

namespace beat
{
    void Sequencer::setProject(Project p)
    {
        const juce::ScopedLock lock(projectLock);
        project = std::move(p);
    }

    void Sequencer::render(int numSamples, TriggerHandler onTrigger)
    {
        if (!playing.load()) return;

        const double sr      = sampleRate.load();
        const double tempo   = bpm.load();
        const double speed   = playbackSpeed.load();
        const double beatsPerBlock = (numSamples / sr) * (tempo / 60.0) * speed;

        const double blockStart = positionBeat.load();
        const double blockEnd   = blockStart + beatsPerBlock;

        // Iterate tracks/segments. Note: this runs on the audio thread so
        // we hold the lock briefly while scanning. The data is small (a few
        // dozen tracks at most); for larger projects we'd snapshot to a
        // lock-free structure outside the audio thread.
        {
            const juce::ScopedLock lock(projectLock);

            for (const auto& track : project.tracks)
            {
                if (track.mute) continue;
                // (solo handling omitted — would skip non-soloed tracks if any solo flagged)

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

                        if (seg.kind == SegmentPayloadKind::Midi
                            || seg.kind == SegmentPayloadKind::Mixed)
                        {
                            for (const auto& note : seg.notes)
                            {
                                const Beats noteAbs = occStart + note.startBeat;
                                if (noteAbs >= blockStart && noteAbs < blockEnd)
                                {
                                    const double offsetBeats = noteAbs - blockStart;
                                    const int    offsetSamples =
                                        (int) std::round(offsetBeats * 60.0 / tempo * sr / speed);

                                    onTrigger({
                                        track.id, seg.id, note.pitch, note.velocity,
                                        note.lengthBeats,
                                        juce::jlimit(0, numSamples - 1, offsetSamples),
                                        rep,
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
