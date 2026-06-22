#pragma once

#include "VoiceMath.h"

#include <cmath>
#include <utility>

namespace beat::VoiceAetherCache
{
    struct PanGains
    {
        std::pair<float, float> amp { 1.0f, 1.0f };
        std::pair<float, float> oscA { 1.0f, 1.0f };
        std::pair<float, float> oscB { 1.0f, 1.0f };
    };

    struct PitchRates
    {
        double oscA { 1.0 };
        double oscB { 1.0 };
        double sub { 0.5 };
    };

    template <typename Params>
    inline PanGains panGainsFor(const Params& params) noexcept
    {
        return {
            VoiceMath::equalPowerPanGains(params.ampPan),
            VoiceMath::equalPowerPanGains(params.aetherOscA.pan),
            VoiceMath::equalPowerPanGains(params.aetherOscB.pan),
        };
    }

    template <typename Params>
    inline PitchRates pitchRatesFor(const Params& params) noexcept
    {
        return {
            VoiceMath::pitchRate(params.aetherOscA.octave,
                                 params.aetherOscA.semitone,
                                 params.aetherOscA.fineCents),
            VoiceMath::pitchRate(params.aetherOscB.octave,
                                 params.aetherOscB.semitone,
                                 params.aetherOscB.fineCents),
            std::exp2((double) params.aetherSub.octave),
        };
    }
}
