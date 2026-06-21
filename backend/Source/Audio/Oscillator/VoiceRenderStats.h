#pragma once

#include "../InstrumentVoice.h"

namespace beat::VoiceRenderStats
{
    void recordBlock(const InstrumentVoice::RenderWorkStats& stats) noexcept;
    InstrumentVoice::RenderWorkStats consume() noexcept;
}
