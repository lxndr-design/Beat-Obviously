#pragma once

#include "SourceSlot.h"

#include <algorithm>
#include <array>

namespace beat
{
    class SourceSlotRack
    {
    public:
        // Attachment is a setup-only boundary. The rack does not own slots.
        void attach(SourceSlotIndex index, SourceSlot* source) noexcept
        {
            slots[toIndex(index)] = source;
        }

        SourceSlot* slot(SourceSlotIndex index) noexcept { return slots[toIndex(index)]; }
        const SourceSlot* slot(SourceSlotIndex index) const noexcept { return slots[toIndex(index)]; }

        bool prepare(const SourcePrepareSpec& spec) noexcept
        {
            bool valid = true;
            for (auto* source : slots)
                if (source != nullptr)
                    valid = source->prepare(spec) && valid;
            return valid;
        }

        void reset() noexcept
        {
            for (auto* source : slots)
                if (source != nullptr)
                    source->reset();
        }

        bool noteOn(SourceSlotIndex index, const SourceNoteEvent& event) noexcept
        {
            auto* source = slot(index);
            return source != nullptr && source->noteOn(event);
        }

        void noteOff(uint64_t stableNoteId) noexcept
        {
            for (auto* source : slots)
                if (source != nullptr)
                    source->noteOff(stableNoteId);
        }

        void allNotesOff(bool immediate) noexcept
        {
            for (auto* source : slots)
                if (source != nullptr)
                    source->allNotesOff(immediate);
        }

        void render(juce::AudioBuffer<float>& output, int startSample, int numSamples) noexcept
        {
            for (auto* source : slots)
                if (source != nullptr)
                    source->render(output, startSample, numSamples);
        }

        int latencySamples() const noexcept
        {
            int result = 0;
            for (const auto* source : slots)
                if (source != nullptr)
                    result = std::max(result, source->latencySamples());
            return result;
        }

    private:
        static constexpr size_t toIndex(SourceSlotIndex index) noexcept
        {
            return (size_t) index;
        }

        std::array<SourceSlot*, sourceSlotIndices.size()> slots {};
    };
}
