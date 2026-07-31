#include "VoiceRenderStats.h"

namespace beat::VoiceRenderStats
{
    namespace
    {
        thread_local VoiceStats::RenderWork renderWork;
    }

    void recordBlock(const VoiceStats::RenderWork& stats) noexcept
    {
        VoiceStats::add(renderWork, stats);
    }

    VoiceStats::RenderWork consume() noexcept
    {
        const auto snapshot = renderWork;
        renderWork = {};
        return snapshot;
    }
}
