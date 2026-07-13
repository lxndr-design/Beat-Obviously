#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>

namespace beat
{
    /**
     * Non-owning, render-scope output targets for Aether's two fixed source-send
     * buses. AudioEngine owns and clears the buffers; voices only accumulate
     * into them while JUCE renders the corresponding synth synchronously.
     */
    class AetherSourceBusContext
    {
    public:
        static constexpr size_t busCount = 2;
        using Buffers = std::array<juce::AudioBuffer<float>*, busCount>;

        class ScopedTargets
        {
        public:
            explicit ScopedTargets(Buffers next) noexcept
                : previous(current)
            {
                current = next;
            }

            ~ScopedTargets() noexcept { current = previous; }

            ScopedTargets(const ScopedTargets&) = delete;
            ScopedTargets& operator=(const ScopedTargets&) = delete;

        private:
            Buffers previous {};
        };

        static void add(size_t bus, int sample, float left, float right) noexcept
        {
            if (bus >= current.size())
                return;
            auto* target = current[bus];
            if (target == nullptr || sample < 0 || sample >= target->getNumSamples())
                return;

            const int channels = target->getNumChannels();
            if (channels > 0)
                target->addSample(0, sample, left);
            if (channels > 1)
                target->addSample(1, sample, right);
            for (int channel = 2; channel < channels; ++channel)
                target->addSample(channel, sample, (left + right) * 0.5f);
        }

    private:
        inline static thread_local Buffers current {};
    };
}
