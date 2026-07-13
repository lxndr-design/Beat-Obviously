#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <cstdint>

namespace beat
{
    enum class SourceSlotIndex : uint8_t
    {
        one = 0,
        two = 1,
        three = 2,
    };

    inline constexpr std::array<SourceSlotIndex, 3> sourceSlotIndices {
        SourceSlotIndex::one,
        SourceSlotIndex::two,
        SourceSlotIndex::three,
    };

    enum class SourceLifecycleState : uint8_t
    {
        empty,
        ready,
        active,
        releasing,
    };

    enum class SourceComplexity : uint8_t
    {
        singleSample,
        mappedSample,
        granular,
        spectral,
    };

    struct SourcePrepareSpec
    {
        double sampleRate { 44100.0 };
        int maximumBlockSize { 512 };
        int outputChannels { 2 };
    };

    struct SourceNoteEvent
    {
        int midiNote { 60 };
        float velocity { 1.0f };
        uint64_t stableNoteId { 0 };
    };

    struct SourceRenderTelemetry
    {
        uint64_t renderedSamples { 0 };
        uint64_t renderedVoiceSamples { 0 };
        uint64_t acceptedNoteEvents { 0 };
        uint64_t rejectedNoteEvents { 0 };
    };

    class SourceSlot
    {
    public:
        virtual ~SourceSlot() = default;

        // Lifecycle and publication methods are setup/control-thread boundaries.
        virtual bool prepare(const SourcePrepareSpec& spec) noexcept = 0;
        virtual void reset() noexcept = 0;

        // Note and render methods are fixed-work real-time boundaries.
        virtual bool noteOn(const SourceNoteEvent& event) noexcept = 0;
        virtual void noteOff(uint64_t stableNoteId) noexcept = 0;
        virtual void allNotesOff(bool immediate) noexcept = 0;
        virtual void render(juce::AudioBuffer<float>& output, int startSample, int numSamples) noexcept = 0;

        virtual SourceLifecycleState lifecycleState() const noexcept = 0;
        virtual SourceComplexity complexity() const noexcept = 0;
        virtual int latencySamples() const noexcept = 0;
        virtual int activeVoiceCount() const noexcept = 0;
        virtual uint64_t stateVersion() const noexcept = 0;
        virtual SourceRenderTelemetry telemetry() const noexcept = 0;
    };
}
