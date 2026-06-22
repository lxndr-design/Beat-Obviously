#pragma once

#include "RealtimeRamp.h"
#include "VoiceRealtimeParams.h"

#include <array>
#include <cstddef>

namespace beat
{
    struct VoiceRealtimeRampState
    {
        std::array<RealtimeRamp, VoiceRealtimeParams::count> ramps;
        std::array<size_t, VoiceRealtimeParams::count> activeIndices {};
        int activeCount { 0 };

        RealtimeRamp& ramp(VoiceRealtimeParams::Id param) noexcept
        {
            return ramps[(size_t) param];
        }

        void clearActive() noexcept
        {
            activeCount = 0;
        }

        void activate(VoiceRealtimeParams::Id param) noexcept
        {
            const auto index = (size_t) param;
            for (int i = 0; i < activeCount; ++i)
                if (activeIndices[(size_t) i] == index)
                    return;

            if (activeCount >= (int) activeIndices.size())
                return;

            activeIndices[(size_t) activeCount] = index;
            ++activeCount;
        }

        void deactivate(VoiceRealtimeParams::Id param) noexcept
        {
            const auto index = (size_t) param;
            for (int i = 0; i < activeCount; ++i)
            {
                if (activeIndices[(size_t) i] != index)
                    continue;

                --activeCount;
                if (i != activeCount)
                    activeIndices[(size_t) i] = activeIndices[(size_t) activeCount];
                return;
            }
        }

        template <typename Apply>
        void advance(Apply&& apply) noexcept
        {
            int writeIndex = 0;
            for (int readIndex = 0; readIndex < activeCount; ++readIndex)
            {
                const auto paramIndex = activeIndices[(size_t) readIndex];
                auto& activeRamp = ramps[paramIndex];
                if (!activeRamp.active())
                    continue;
                apply((VoiceRealtimeParams::Id) paramIndex, activeRamp.next());
                if (activeRamp.active())
                {
                    activeIndices[(size_t) writeIndex] = paramIndex;
                    ++writeIndex;
                }
            }
            activeCount = writeIndex;
        }
    };
}
