#pragma once

#include "Wavetable.h"
#include <array>

namespace beat
{
    enum class BasicWavetableShape
    {
        Sine,
        Saw,
        Square,
        Triangle,
        Pulse
    };

    enum class WavetableWarpMode
    {
        Shape,
        Fold,
        Pinch,
        Mirror
    };

    class WavetableFactory
    {
    public:
        struct CustomFrame
        {
            float brightness { 0.5f };
            float even { 0.2f };
            float fold { 0.1f };
            float formant { 0.12f };
            float notch { 0.08f };
            float skew { 0.0f };
            float tilt { 0.0f };
            float focus { 0.35f };
            float phase { 0.0f };
            std::array<float, 16> partials {};
        };

        static constexpr int defaultFrameCount = 8;
        static constexpr int defaultFrameSize = 2048;

        static Wavetable createBasic(BasicWavetableShape shape,
                                     int frameCount,
                                     int frameSize);

        static Wavetable createBasic(BasicWavetableShape shape,
                                     float warp = 0.0f,
                                     WavetableWarpMode warpMode = WavetableWarpMode::Shape,
                                     int frameCount = defaultFrameCount,
                                     int frameSize = defaultFrameSize);

        static Wavetable createCustom(const std::array<CustomFrame, 4>& frames,
                                      int frameCount,
                                      int frameSize);

        static Wavetable createCustom(const std::array<CustomFrame, 4>& frames,
                                      bool smoothInterpolation,
                                      int frameCount,
                                      int frameSize);

        static Wavetable createCustom(const std::array<CustomFrame, 4>& frames,
                                      float warp = 0.0f,
                                      WavetableWarpMode warpMode = WavetableWarpMode::Shape,
                                      bool smoothInterpolation = false,
                                      float morph = 0.0f,
                                      int frameCount = defaultFrameCount,
                                      int frameSize = defaultFrameSize);
    };
}
