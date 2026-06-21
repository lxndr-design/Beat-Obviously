#pragma once

#include <cmath>

namespace beat::DriveStage
{
    constexpr int oversampleFactor = 2;

    struct StereoFrame
    {
        float left { 0.0f };
        float right { 0.0f };
    };

    struct State
    {
        StereoFrame previousInput;
        StereoFrame downsample;

        void reset(StereoFrame frame = {}) noexcept
        {
            previousInput = frame;
            downsample = frame;
        }
    };

    inline float denormalSafe(float value) noexcept
    {
        return std::abs(value) < 1.0e-20f ? 0.0f : value;
    }

    inline int workSamplesForChannels(int channels) noexcept
    {
        return channels > 0 ? channels * oversampleFactor : 0;
    }

    inline float processSample(float input, float driveGain) noexcept
    {
        return std::tanh(input * driveGain);
    }

    inline float processMonoOversampled(State& state, float sample, float driveGain) noexcept
    {
        constexpr float downsampleAlpha = 0.72f;

        const float midpoint = 0.5f * (state.previousInput.left + sample);
        const float downsampled = 0.5f * (processSample(midpoint, driveGain) + processSample(sample, driveGain));

        state.downsample.left = denormalSafe(state.downsample.left
            + downsampleAlpha * (downsampled - state.downsample.left));
        state.previousInput.left = sample;
        return state.downsample.left;
    }

    inline StereoFrame processOversampled(State& state, StereoFrame sample, float driveGain) noexcept
    {
        State rightState;
        rightState.previousInput.left = state.previousInput.right;
        rightState.downsample.left = state.downsample.right;

        const StereoFrame processed {
            processMonoOversampled(state, sample.left, driveGain),
            processMonoOversampled(rightState, sample.right, driveGain)
        };

        state.previousInput.right = rightState.previousInput.left;
        state.downsample.right = rightState.downsample.left;
        return processed;
    }
}
