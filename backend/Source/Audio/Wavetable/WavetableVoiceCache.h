#pragma once

#include "../InstrumentVoice.h"
#include "../Oscillator/VoiceStats.h"

#include <memory>

namespace beat::WavetableVoiceCache
{
    std::shared_ptr<const Wavetable> sharedTableForConfig(const InstrumentVoice::Params::WavetableConfig& config);
    VoiceStats::WavetableCache stats() noexcept;
}
