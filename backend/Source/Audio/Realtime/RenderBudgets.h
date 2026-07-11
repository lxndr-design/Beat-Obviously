#pragma once

#include <cstddef>

namespace beat::RenderBudgets
{
    inline constexpr size_t realtimeQueueEvents = 1024;
    inline constexpr int realtimeEventsDrainedPerBlock = 256;
    inline constexpr size_t blockParameterEvents = 2048;
    inline constexpr size_t blockRouteEvents = 1024;
    inline constexpr size_t pendingNoteOffs = 256;
    inline constexpr size_t instrumentRoutes = 64;
    inline constexpr size_t activeSampleVoices = 192;
    inline constexpr size_t activeAudioClipVoices = 256;
}
