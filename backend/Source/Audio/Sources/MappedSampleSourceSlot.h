#pragma once

#include "SampleSourceSlot.h"

#include <array>
#include <limits>
#include <memory>

namespace beat
{
    struct ImmutableMappedSampleSource
    {
        static constexpr size_t maximumZones = 8;
        std::array<std::shared_ptr<const ImmutableSampleSource>, maximumZones> zones {};
        size_t zoneCount { 0 };

        bool isValid() const noexcept
        {
            if (zoneCount == 0 || zoneCount > maximumZones)
                return false;
            for (size_t index = 0; index < zoneCount; ++index)
                if (!zones[index] || !zones[index]->isValid())
                    return false;
            return true;
        }
    };

    class MappedSampleSourceSlot final : public SourceSlot
    {
    public:
        bool prepare(const SourcePrepareSpec& spec) noexcept override
        {
            prepared = spec;
            bool valid = true;
            for (auto& zone : zoneSlots)
                valid = zone.prepare(spec) && valid;
            return valid;
        }

        bool publish(std::shared_ptr<const ImmutableMappedSampleSource> next) noexcept
        {
            if (activeVoiceCount() != 0 || (next && !next->isValid()))
                return false;
            for (size_t index = 0; index < zoneSlots.size(); ++index)
            {
                const auto source = next && index < next->zoneCount ? next->zones[index] : nullptr;
                if (!zoneSlots[index].publish(source))
                    return false;
            }
            map = std::move(next);
            version.fetch_add(1, std::memory_order_release);
            return true;
        }

        bool configurePlayback(bool reverse, float rate, bool pingPong = false,
                               float releaseTailMs = 4.0f) noexcept
        {
            if (activeVoiceCount() != 0)
                return false;
            bool accepted = true;
            for (auto& zone : zoneSlots)
                accepted = zone.configurePlayback(reverse, rate, pingPong, releaseTailMs) && accepted;
            return accepted;
        }

        void reset() noexcept override
        {
            for (auto& zone : zoneSlots)
                zone.reset();
            acceptedEvents = 0;
            rejectedEvents = 0;
            renderedSamples = 0;
        }

        bool noteOn(const SourceNoteEvent& event) noexcept override
        {
            const auto selection = selectZones(event);
            if (selection.first < 0)
            {
                ++rejectedEvents;
                return false;
            }

            const auto startSelectedZone = [&](int index, float gain)
            {
                if (index < 0 || gain <= 0.000001f)
                    return false;
                auto weightedEvent = event;
                weightedEvent.velocity = std::clamp(event.velocity, 0.0f, 1.0f) * gain;
                return zoneSlots[(size_t) index].noteOn(weightedEvent);
            };
            const bool firstAccepted = startSelectedZone(selection.first, selection.firstGain);
            const bool secondAccepted = startSelectedZone(selection.second, selection.secondGain);
            const bool accepted = firstAccepted || secondAccepted;
            if (accepted) ++acceptedEvents;
            else ++rejectedEvents;
            return accepted;
        }

        void noteOff(uint64_t stableNoteId) noexcept override
        {
            for (auto& zone : zoneSlots)
                zone.noteOff(stableNoteId);
        }

        void allNotesOff(bool immediate) noexcept override
        {
            for (auto& zone : zoneSlots)
                zone.allNotesOff(immediate);
        }

        void render(juce::AudioBuffer<float>& output, int startSample, int numSamples) noexcept override
        {
            if (numSamples <= 0 || output.getNumChannels() <= 0)
                return;
            const int outputStart = std::clamp(startSample, 0, output.getNumSamples());
            const int outputEnd = std::clamp(outputStart + numSamples, outputStart, output.getNumSamples());
            for (int outputSample = outputStart; outputSample < outputEnd; ++outputSample)
            {
                const auto frame = renderFrame();
                output.addSample(0, outputSample, frame.left);
                if (output.getNumChannels() > 1)
                    output.addSample(1, outputSample, frame.right);
            }
        }

        SampleSourceSlot::StereoFrame renderFrame() noexcept
        {
            SampleSourceSlot::StereoFrame result;
            if (!map) return result;
            for (size_t index = 0; index < map->zoneCount; ++index)
            {
                const auto frame = zoneSlots[index].renderFrame();
                result.left += frame.left;
                result.right += frame.right;
            }
            ++renderedSamples;
            return result;
        }

        SourceLifecycleState lifecycleState() const noexcept override
        {
            if (!map) return SourceLifecycleState::empty;
            bool releasing = false;
            for (size_t index = 0; index < map->zoneCount; ++index)
            {
                const auto state = zoneSlots[index].lifecycleState();
                if (state == SourceLifecycleState::active) return state;
                releasing = releasing || state == SourceLifecycleState::releasing;
            }
            return releasing ? SourceLifecycleState::releasing : SourceLifecycleState::ready;
        }

        SourceComplexity complexity() const noexcept override
        {
            return map && map->zoneCount > 1 ? SourceComplexity::mappedSample : SourceComplexity::singleSample;
        }
        int latencySamples() const noexcept override { return 0; }
        int activeVoiceCount() const noexcept override
        {
            int total = 0;
            for (const auto& zone : zoneSlots) total += zone.activeVoiceCount();
            return total;
        }
        uint64_t stateVersion() const noexcept override { return version.load(std::memory_order_acquire); }
        SourceRenderTelemetry telemetry() const noexcept override
        {
            SourceRenderTelemetry total;
            for (const auto& zone : zoneSlots)
            {
                const auto child = zone.telemetry();
                total.renderedVoiceSamples += child.renderedVoiceSamples;
            }
            total.renderedSamples = renderedSamples;
            total.acceptedNoteEvents = acceptedEvents;
            total.rejectedNoteEvents = rejectedEvents;
            return total;
        }

    private:
        struct ZoneSelection
        {
            int first { -1 };
            int second { -1 };
            float firstGain { 1.0f };
            float secondGain { 0.0f };
        };

        ZoneSelection selectZones(const SourceNoteEvent& event) const noexcept
        {
            if (!map || event.midiNote < 0 || event.midiNote > 127)
                return {};
            const int velocity = std::clamp((int) std::round(std::clamp(event.velocity, 0.0f, 1.0f) * 127.0f), 0, 127);
            int best = -1;
            int second = -1;
            int bestSpan = std::numeric_limits<int>::max();
            int secondSpan = std::numeric_limits<int>::max();
            for (size_t index = 0; index < map->zoneCount; ++index)
            {
                const auto& zone = map->zones[index];
                if (!zone || event.midiNote < zone->loNote || event.midiNote > zone->hiNote
                    || velocity < zone->loVelocity || velocity > zone->hiVelocity)
                    continue;
                const int span = (zone->hiNote - zone->loNote) * 128 + (zone->hiVelocity - zone->loVelocity);
                if (span < bestSpan)
                {
                    second = best;
                    secondSpan = bestSpan;
                    best = (int) index;
                    bestSpan = span;
                }
                else if (span < secondSpan)
                {
                    second = (int) index;
                    secondSpan = span;
                }
            }
            if (best < 0 || second < 0)
                return { best, -1, 1.0f, 0.0f };

            const auto& firstZone = *map->zones[(size_t) best];
            const auto& secondZone = *map->zones[(size_t) second];
            const bool identicalBounds = firstZone.loNote == secondZone.loNote
                && firstZone.hiNote == secondZone.hiNote
                && firstZone.loVelocity == secondZone.loVelocity
                && firstZone.hiVelocity == secondZone.hiVelocity;
            if (identicalBounds)
                return { best, -1, 1.0f, 0.0f };

            const auto gainsAcrossOverlap = [](int firstLow, int firstHigh, int secondLow, int secondHigh, int value)
            {
                const int firstCentre = firstLow + firstHigh;
                const int secondCentre = secondLow + secondHigh;
                if (firstCentre == secondCentre)
                    return std::array<float, 2> { 1.0f, 0.0f };
                const int overlapLow = std::max(firstLow, secondLow);
                const int overlapHigh = std::min(firstHigh, secondHigh);
                const float position = overlapHigh == overlapLow ? 0.5f
                    : std::clamp((float) (value - overlapLow) / (float) (overlapHigh - overlapLow), 0.0f, 1.0f);
                const float lowGain = std::cos(position * juce::MathConstants<float>::halfPi);
                const float highGain = std::sin(position * juce::MathConstants<float>::halfPi);
                return firstCentre < secondCentre
                    ? std::array<float, 2> { lowGain, highGain }
                    : std::array<float, 2> { highGain, lowGain };
            };

            auto gains = gainsAcrossOverlap(firstZone.loNote, firstZone.hiNote,
                secondZone.loNote, secondZone.hiNote, event.midiNote);
            if (firstZone.loNote + firstZone.hiNote == secondZone.loNote + secondZone.hiNote)
                gains = gainsAcrossOverlap(firstZone.loVelocity, firstZone.hiVelocity,
                    secondZone.loVelocity, secondZone.hiVelocity, velocity);
            if (gains[1] <= 0.000001f)
                return { best, -1, 1.0f, 0.0f };
            if (gains[0] <= 0.000001f)
                return { second, -1, 1.0f, 0.0f };
            return { best, second, gains[0], gains[1] };
        }

        SourcePrepareSpec prepared;
        std::shared_ptr<const ImmutableMappedSampleSource> map;
        std::array<SampleSourceSlot, ImmutableMappedSampleSource::maximumZones> zoneSlots;
        std::atomic<uint64_t> version { 0 };
        uint64_t acceptedEvents { 0 };
        uint64_t rejectedEvents { 0 };
        uint64_t renderedSamples { 0 };
    };
}
