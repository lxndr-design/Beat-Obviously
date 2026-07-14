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
            const int selected = selectZone(event);
            if (selected < 0)
            {
                ++rejectedEvents;
                return false;
            }
            const bool accepted = zoneSlots[(size_t) selected].noteOn(event);
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
        int selectZone(const SourceNoteEvent& event) const noexcept
        {
            if (!map || event.midiNote < 0 || event.midiNote > 127)
                return -1;
            const int velocity = std::clamp((int) std::round(std::clamp(event.velocity, 0.0f, 1.0f) * 127.0f), 0, 127);
            int best = -1;
            int bestSpan = std::numeric_limits<int>::max();
            for (size_t index = 0; index < map->zoneCount; ++index)
            {
                const auto& zone = map->zones[index];
                if (!zone || event.midiNote < zone->loNote || event.midiNote > zone->hiNote
                    || velocity < zone->loVelocity || velocity > zone->hiVelocity)
                    continue;
                const int span = (zone->hiNote - zone->loNote) * 128 + (zone->hiVelocity - zone->loVelocity);
                if (span < bestSpan)
                {
                    best = (int) index;
                    bestSpan = span;
                }
            }
            return best;
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
