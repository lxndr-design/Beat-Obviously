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
        Pinch
    };

    class WavetableFactory
    {
    public:
        struct CustomFrame
        {
            float brightness { 0.5f };
            float even { 0.2f };
            float fold { 0.1f };
            float skew { 0.0f };
            float phase { 0.0f };
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
                                      float warp = 0.0f,
                                      WavetableWarpMode warpMode = WavetableWarpMode::Shape,
                                      int frameCount = defaultFrameCount,
                                      int frameSize = defaultFrameSize);
    };
}
