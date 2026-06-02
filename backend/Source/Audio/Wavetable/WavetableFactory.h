#pragma once

#include "Wavetable.h"

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

    class WavetableFactory
    {
    public:
        static constexpr int defaultFrameCount = 8;
        static constexpr int defaultFrameSize = 2048;

        static Wavetable createBasic(BasicWavetableShape shape,
                                     int frameCount = defaultFrameCount,
                                     int frameSize = defaultFrameSize);
    };
}
