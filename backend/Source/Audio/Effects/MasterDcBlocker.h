#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <cmath>

namespace beat
{
    class MasterDcBlocker
    {
    public:
        void prepare(double sampleRate, int channels) noexcept
        {
            const double rate = std::isfinite(sampleRate) && sampleRate > 0.0 ? sampleRate : 44100.0;
            coefficient = (float) std::exp(-juce::MathConstants<double>::twoPi * cutoffHz / rate);
            channelCount = juce::jlimit(1, (int) states.size(), channels);
            reset();
        }

        void reset() noexcept
        {
            for (auto& state : states)
                state = {};
        }

        void process(juce::AudioBuffer<float>& buffer) noexcept
        {
            const int channels = juce::jmin(channelCount, buffer.getNumChannels());
            for (int channel = 0; channel < channels; ++channel)
            {
                auto& state = states[(size_t) channel];
                auto* samples = buffer.getWritePointer(channel);
                for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
                {
                    const float input = samples[sample];
                    const float output = input - state.previousInput + coefficient * state.previousOutput;
                    state.previousInput = input;
                    state.previousOutput = std::abs(output) < 1.0e-20f ? 0.0f : output;
                    samples[sample] = std::isfinite(output) ? output : 0.0f;
                }
            }
        }

        float getCoefficient() const noexcept { return coefficient; }
        static constexpr double cutoffHz = 5.0;

    private:
        struct State
        {
            float previousInput { 0.0f };
            float previousOutput { 0.0f };
        };

        std::array<State, 32> states {};
        float coefficient { 0.99928767f };
        int channelCount { 2 };
    };
}
