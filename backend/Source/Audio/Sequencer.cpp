#include "Sequencer.h"

#include <algorithm>
#include <cmath>

namespace beat
{
    namespace
    {
        float automationCurveValue(AutomationCurve curve, float startValue, float endValue, double t) noexcept
        {
            const float clamped = (float) juce::jlimit(0.0, 1.0, t);
            switch (curve)
            {
                case AutomationCurve::Hold:
                    return startValue;
                case AutomationCurve::Quadratic:
                    return startValue + (endValue - startValue) * clamped * clamped;
                case AutomationCurve::Cubic:
                    return startValue + (endValue - startValue) * clamped * clamped * clamped;
                case AutomationCurve::EaseIn:
                    return startValue + (endValue - startValue) * clamped * clamped;
                case AutomationCurve::EaseOut:
                {
                    const float inv = 1.0f - clamped;
                    return endValue - (endValue - startValue) * inv * inv;
                }
                case AutomationCurve::Smoothstep:
                {
                    const float shaped = clamped * clamped * (3.0f - 2.0f * clamped);
                    return startValue + (endValue - startValue) * shaped;
                }
                case AutomationCurve::Linear:
                default:
                    return startValue + (endValue - startValue) * clamped;
            }
        }

        template <typename Emit>
        void emitAutomationCheckpoints(const MidiAutomationPoint& startPoint,
                                       const MidiAutomationPoint& endPoint,
                                       Beats rangeStart,
                                       Beats rangeEnd,
                                       double samplesPerBeat,
                                       Emit&& emit)
        {
            if (startPoint.curve == AutomationCurve::Hold || rangeEnd <= rangeStart)
                return;

            const Beats spanStart = juce::jmax(rangeStart, startPoint.beat);
            const Beats spanEnd = juce::jmin(rangeEnd, endPoint.beat);
            if (spanEnd <= spanStart)
                return;

            const double width = juce::jmax(0.000001, endPoint.beat - startPoint.beat);
            const double stepBeats = juce::jmax(0.000001, 128.0 / juce::jmax(1.0, samplesPerBeat));
            int emitted = 0;
            for (Beats beat = spanStart + stepBeats;
                 beat < spanEnd && emitted < 512;
                 beat += stepBeats, ++emitted)
            {
                const float value = automationCurveValue(startPoint.curve,
                                                         startPoint.value,
                                                         endPoint.value,
                                                         (beat - startPoint.beat) / width);
                emit(beat, value, juce::jmin(endPoint.beat, beat + stepBeats));
            }
        }
    }

    void Sequencer::setProject(Project p)
    {
        std::atomic_store(&projectSnapshot,
                          std::static_pointer_cast<const Project>(
                              std::make_shared<Project>(std::move(p))));
    }

    void Sequencer::render(int numSamples,
                           TriggerHandler onTrigger,
                           ParameterAutomationHandler onAutomation,
                           AudioClipHandler onAudioClip)
    {
        if (!playing.load()) return;

        const double sr = sampleRate.load() > 0.0 ? sampleRate.load() : 44100.0;
        const double tempo = juce::jmax(1.0, bpm.load());
        const double speed = juce::jmax(0.000001, playbackSpeed.load());
        const double samplesPerBeat = sr * 60.0 / tempo / speed;
        const double beatsPerSample = 1.0 / samplesPerBeat;
        const double beatsPerBlock = (double) numSamples * beatsPerSample;

        const double blockStart = positionBeat.load();
        const double blockEnd   = blockStart + beatsPerBlock;

        // Iterate tracks/segments from an immutable snapshot so the audio
        // thread does not block on UI-thread project updates.
        const auto snapshot = std::atomic_load(&projectSnapshot);
        const auto renderSpan = [&](double spanStart, double spanEnd, int sampleBaseOffset)
        {
            if (snapshot == nullptr || spanEnd <= spanStart)
                return;

            if (onAutomation && !snapshot->automation.empty())
            {
                const auto emitProjectAutomation = [&](const ProjectAutomationLane& lane,
                                                       Beats beat,
                                                       float value,
                                                       Beats nextBeat)
                {
                    if (beat < spanStart || beat >= spanEnd)
                        return;

                    const int offsetSamples = sampleBaseOffset + (int) std::round((beat - spanStart) * samplesPerBeat);
                    const int rampSamples = nextBeat > beat
                        ? juce::jmax(0, (int) std::round((nextBeat - beat) * samplesPerBeat))
                        : 0;

                    onAutomation({
                        lane.trackId,
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
                        if (point.beat <= spanStart)
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
                            const float value = automationCurveValue(current.curve, current.value, nextPoint.value, (spanStart - current.beat) / width);
                            emitProjectAutomation(lane, spanStart, value, current.curve == AutomationCurve::Hold ? spanStart : nextPoint.beat);
                            emitAutomationCheckpoints(current,
                                                      nextPoint,
                                                      spanStart,
                                                      spanEnd,
                                                      samplesPerBeat,
                                                      [&](Beats beat, float checkpointValue, Beats nextBeat) {
                                                          emitProjectAutomation(lane, beat, checkpointValue, nextBeat);
                                                      });
                        }
                        else
                        {
                            emitProjectAutomation(lane, spanStart, current.value, spanStart);
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
                        if (point.beat < spanStart || point.beat >= spanEnd)
                            continue;
                        const Beats nextBeat = i + 1 < (int) lane.points.size()
                            ? lane.points[(size_t) (i + 1)].beat
                            : point.beat;
                        emitProjectAutomation(lane, point.beat, point.value, point.curve == AutomationCurve::Hold ? point.beat : nextBeat);
                        if (i + 1 < (int) lane.points.size())
                        {
                            const auto& nextPoint = lane.points[(size_t) (i + 1)];
                            emitAutomationCheckpoints(point,
                                                      nextPoint,
                                                      spanStart,
                                                      spanEnd,
                                                      samplesPerBeat,
                                                      [&](Beats beat, float checkpointValue, Beats checkpointNextBeat) {
                                                          emitProjectAutomation(lane, beat, checkpointValue, checkpointNextBeat);
                                                      });
                        }
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

                if (onAutomation)
                {
                    for (const auto& effect : track.effects)
                    {
                        if (effect.id.isEmpty() || effect.automation.empty())
                            continue;

                        for (const auto& lane : effect.automation)
                        {
                            if (lane.target.isEmpty() || lane.points.empty())
                                continue;

                            ProjectAutomationLane routeLane;
                            routeLane.trackId = track.id;
                            routeLane.target = juce::String("effect.") + effect.id + "." + lane.target;
                            routeLane.points = lane.points;

                            const auto emitRouteEffectAutomation = [&](Beats beat, float value, Beats nextBeat)
                            {
                                if (beat < spanStart || beat >= spanEnd)
                                    return;

                                const int offsetSamples = sampleBaseOffset + (int) std::round((beat - spanStart) * samplesPerBeat);
                                const int rampSamples = nextBeat > beat
                                    ? juce::jmax(0, (int) std::round((nextBeat - beat) * samplesPerBeat))
                                    : 0;

                                onAutomation({
                                    routeLane.trackId,
                                    {},
                                    {},
                                    routeLane.target,
                                    value,
                                    juce::jlimit(0, numSamples - 1, offsetSamples),
                                    rampSamples,
                                    0,
                                });
                            };

                            int currentIndex = -1;
                            int nextIndex = -1;
                            for (int i = 0; i < (int) routeLane.points.size(); ++i)
                            {
                                const auto& point = routeLane.points[(size_t) i];
                                if (point.beat <= spanStart)
                                    currentIndex = i;
                                else
                                {
                                    nextIndex = i;
                                    break;
                                }
                            }

                            if (currentIndex >= 0)
                            {
                                const auto& current = routeLane.points[(size_t) currentIndex];
                                if (nextIndex >= 0)
                                {
                                    const auto& nextPoint = routeLane.points[(size_t) nextIndex];
                                    const double width = juce::jmax(0.000001, nextPoint.beat - current.beat);
                                    const float value = automationCurveValue(current.curve, current.value, nextPoint.value, (spanStart - current.beat) / width);
                                    emitRouteEffectAutomation(spanStart, value, current.curve == AutomationCurve::Hold ? spanStart : nextPoint.beat);
                                    emitAutomationCheckpoints(current,
                                                              nextPoint,
                                                              spanStart,
                                                              spanEnd,
                                                              samplesPerBeat,
                                                              [&](Beats beat, float checkpointValue, Beats nextBeat) {
                                                                  emitRouteEffectAutomation(beat, checkpointValue, nextBeat);
                                                              });
                                }
                                else
                                {
                                    emitRouteEffectAutomation(spanStart, current.value, spanStart);
                                }
                            }

                            const int firstFutureIndex = nextIndex >= 0
                                ? nextIndex
                                : currentIndex >= 0
                                    ? currentIndex + 1
                                    : 0;
                            for (int i = firstFutureIndex; i < (int) routeLane.points.size(); ++i)
                            {
                                const auto& point = routeLane.points[(size_t) i];
                                if (point.beat < spanStart || point.beat >= spanEnd)
                                    continue;
                                const Beats nextBeat = i + 1 < (int) routeLane.points.size()
                                    ? routeLane.points[(size_t) (i + 1)].beat
                                    : point.beat;
                                emitRouteEffectAutomation(point.beat, point.value, point.curve == AutomationCurve::Hold ? point.beat : nextBeat);
                                if (i + 1 < (int) routeLane.points.size())
                                {
                                    const auto& nextPoint = routeLane.points[(size_t) (i + 1)];
                                    emitAutomationCheckpoints(point,
                                                              nextPoint,
                                                              spanStart,
                                                              spanEnd,
                                                              samplesPerBeat,
                                                              [&](Beats beat, float checkpointValue, Beats checkpointNextBeat) {
                                                                  emitRouteEffectAutomation(beat, checkpointValue, checkpointNextBeat);
                                                              });
                                }
                            }
                        }
                    }
                }

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

                        if (occEnd <= spanStart || occStart >= spanEnd) continue;

                        if (onAutomation && !seg.automation.empty())
                        {
                            const auto targetInstrumentId = seg.instrumentId.isNotEmpty()
                                ? seg.instrumentId
                                : track.instrumentId;
                            const Beats localStart = juce::jlimit(0.0, segLen, spanStart - occStart);
                            const Beats localEnd = juce::jlimit(0.0, segLen, spanEnd - occStart);

                            const auto emitAutomation = [&](const MidiAutomationLane& lane,
                                                            Beats localBeat,
                                                            float value,
                                                            Beats nextBeat)
                            {
                                const Beats absoluteBeat = occStart + localBeat;
                                if (absoluteBeat < spanStart || absoluteBeat >= spanEnd)
                                    return;

                                const int offsetSamples = sampleBaseOffset + (int) std::round((absoluteBeat - spanStart) * samplesPerBeat);
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
                                            const float value = automationCurveValue(current.curve, current.value, nextPoint.value, (localStart - current.beat) / width);
                                            emitAutomation(lane, localStart, value, current.curve == AutomationCurve::Hold ? localStart : nextPoint.beat);
                                            emitAutomationCheckpoints(current,
                                                                      nextPoint,
                                                                      localStart,
                                                                      localEnd,
                                                                      samplesPerBeat,
                                                                      [&](Beats beat, float checkpointValue, Beats nextBeat) {
                                                                          emitAutomation(lane, beat, checkpointValue, nextBeat);
                                                                      });
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
                                    emitAutomation(lane, point.beat, point.value, point.curve == AutomationCurve::Hold ? point.beat : nextBeat);
                                    if (i + 1 < (int) lane.points.size())
                                    {
                                        const auto& nextPoint = lane.points[(size_t) (i + 1)];
                                        emitAutomationCheckpoints(point,
                                                                  nextPoint,
                                                                  localStart,
                                                                  localEnd,
                                                                  samplesPerBeat,
                                                                  [&](Beats beat, float checkpointValue, Beats checkpointNextBeat) {
                                                                      emitAutomation(lane, beat, checkpointValue, checkpointNextBeat);
                                                                  });
                                    }
                                }
                            }
                        }

                        if (seg.kind == SegmentPayloadKind::Midi
                            || seg.kind == SegmentPayloadKind::Mixed
                            || seg.kind == SegmentPayloadKind::Drum)
                        {
                            for (const auto& note : seg.notes)
                            {
                                if (note.startBeat < 0.0 || note.startBeat >= segLen)
                                    continue;

                                const Beats clippedNoteLength = juce::jmin(note.lengthBeats, segLen - note.startBeat);
                                if (clippedNoteLength <= 0.0)
                                    continue;

                                const Beats noteAbs = occStart + note.startBeat;
                                if (noteAbs >= spanStart && noteAbs < spanEnd)
                                {
                                    const double offsetBeats = noteAbs - spanStart;
                                    const int    offsetSamples =
                                        sampleBaseOffset + (int) std::round(offsetBeats * samplesPerBeat);
                                    const int lengthSamples =
                                        juce::jmax(1, (int) std::round(clippedNoteLength * samplesPerBeat));

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
                                        clippedNoteLength,
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

                        if (onAudioClip
                            && (seg.kind == SegmentPayloadKind::Audio || seg.kind == SegmentPayloadKind::Mixed)
                            && seg.audioFileId.isNotEmpty())
                        {
                            const Beats eventBeat = juce::jmax(spanStart, occStart);
                            const Beats eventEnd = juce::jmin(spanEnd, occEnd);
                            if (eventEnd > eventBeat)
                            {
                                const int offsetSamples = sampleBaseOffset + (int) std::round((eventBeat - spanStart) * samplesPerBeat);
                                const int lengthSamples = juce::jmax(1, (int) std::round((eventEnd - eventBeat) * samplesPerBeat));
                                onAudioClip({
                                    track.id,
                                    seg.id,
                                    seg.audioFileId,
                                    juce::jlimit(0, numSamples - 1, offsetSamples),
                                    juce::jlimit(1, juce::jmax(1, numSamples - juce::jlimit(0, numSamples - 1, offsetSamples)), lengthSamples),
                                    juce::jmax(0.0, seg.sourceStartBeat + eventBeat - occStart),
                                    juce::jmax(0.0, eventBeat - occStart),
                                    seg.lengthBeats,
                                    juce::jlimit(0.0, seg.lengthBeats, seg.fadeInBeats),
                                    juce::jlimit(0.0, seg.lengthBeats, seg.fadeOutBeats),
                                    rep,
                                    occStart,
                                    track.gainDb,
                                    track.pan,
                                    seg.audioGainDb,
                                });
                            }
                        }
                    }
                }
            }
        };

        const double start = loopStart.load();
        const double end = loopEnd.load();
        const double range = end - start;
        const bool shouldSplitAtLoop = loopEnabled.load()
            && range > 0.0
            && blockStart <= end
            && blockEnd >= end;

        if (shouldSplitAtLoop)
        {
            double cursorBeat = blockStart;
            int sampleCursor = 0;

            for (int guard = 0; guard < 128 && sampleCursor < numSamples; ++guard)
            {
                const double remainingSamples = (double) (numSamples - sampleCursor);
                const double maxSpanEnd = cursorBeat + remainingSamples * beatsPerSample;
                const bool crossesEnd = cursorBeat <= end && maxSpanEnd >= end;
                const double spanEnd = crossesEnd ? end : maxSpanEnd;

                renderSpan(cursorBeat, spanEnd, sampleCursor);

                const int spanSamples = juce::jlimit(
                    1,
                    numSamples - sampleCursor,
                    (int) std::ceil(juce::jmax(0.0, spanEnd - cursorBeat) * samplesPerBeat));
                sampleCursor += spanSamples;

                if (!crossesEnd)
                    break;

                cursorBeat = start;
            }
        }
        else
        {
            renderSpan(blockStart, blockEnd, 0);
        }

        // Advance time, honoring loop.
        double next = blockEnd;
        if (loopEnabled.load() && blockStart <= end && next >= end)
        {
            if (range > 0)
                next = start + std::fmod(next - start, range);
        }
        positionBeat.store(next);
    }
}
