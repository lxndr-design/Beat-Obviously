#pragma once

#include "VoiceStats.h"

namespace beat::VoiceRenderStats
{
    void recordBlock(const VoiceStats::RenderWork& stats) noexcept;
    VoiceStats::RenderWork consume() noexcept;
}
