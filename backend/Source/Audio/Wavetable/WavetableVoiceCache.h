#pragma once

#include "../InstrumentVoice.h"

#include <memory>

namespace beat::WavetableVoiceCache
{
    std::shared_ptr<const Wavetable> sharedTableForConfig(const InstrumentVoice::Params::WavetableConfig& config);
    InstrumentVoice::WavetableCacheStats stats() noexcept;
}
