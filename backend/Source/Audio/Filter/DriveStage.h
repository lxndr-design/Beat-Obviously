#pragma once

#include <cmath>

namespace beat::DriveStage
{
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

    inline StereoFrame processOversampled(State& state, StereoFrame sample, float driveGain) noexcept
    {
        constexpr float downsampleAlpha = 0.72f;

        const auto processChannel = [driveGain] (float input)
        {
            return std::tanh(input * driveGain);
        };

        const float leftMidpoint = 0.5f * (state.previousInput.left + sample.left);
        const float rightMidpoint = 0.5f * (state.previousInput.right + sample.right);
        const float leftDownsampled = 0.5f * (processChannel(leftMidpoint) + processChannel(sample.left));
        const float rightDownsampled = 0.5f * (processChannel(rightMidpoint) + processChannel(sample.right));

        state.downsample.left = denormalSafe(state.downsample.left
            + downsampleAlpha * (leftDownsampled - state.downsample.left));
        state.downsample.right = denormalSafe(state.downsample.right
            + downsampleAlpha * (rightDownsampled - state.downsample.right));
        state.previousInput = sample;
        return state.downsample;
    }
}
