#pragma once

#include "VoiceMath.h"

#include <algorithm>
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
        const auto oscillatorRate = [](const auto& oscillator) noexcept {
            const double octaveRate = std::exp2((double) oscillator.octave);
            const double fineRate = std::exp2((double) oscillator.fineCents / 1200.0);
            switch (oscillator.tuningMode)
            {
                case 1:
                    return octaveRate * (double) std::max(1, oscillator.harmonic) * fineRate;
                case 2:
                    return octaveRate
                        * ((double) std::max(0.001f, oscillator.ratioNumerator)
                           / (double) std::max(0.001f, oscillator.ratioDenominator))
                        * fineRate;
                case 3:
                    return octaveRate
                        * std::exp2((double) oscillator.tuningStep / (double) std::max(1, oscillator.tuningDivisions))
                        * fineRate;
                default:
                    return VoiceMath::pitchRate(oscillator.octave, oscillator.semitone, oscillator.fineCents);
            }
        };
        return {
            oscillatorRate(params.aetherOscA),
            oscillatorRate(params.aetherOscB),
            std::exp2((double) params.aetherSub.octave),
        };
    }
}
