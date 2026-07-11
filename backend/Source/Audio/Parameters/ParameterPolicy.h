#pragma once

#include "ParameterIds.h"

#include <array>
#include <cstddef>
#include <string_view>

namespace beat::ParameterPolicy
{
    enum class RateClass
    {
        discrete,
        smoothedControl,
        sampleAccurateControl,
        audioRate
    };

    enum class Smoothing
    {
        none,
        callerRamp
    };

    struct Metadata
    {
        std::string_view stableId;
        float minimum;
        float maximum;
        RateClass rateClass;
        Smoothing smoothing;
        bool modulationEligible;
    };

    inline constexpr std::array realtimeVoiceParameters {
        Metadata { params::filter::cutoff, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::filter::resonance, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::filter::drive, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::amp::level, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::amp::pan, -1.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::a::position, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::b::position, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::a::fine, -100.0f, 100.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::b::fine, -100.0f, 100.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::a::level, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::b::level, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::a::pan, -1.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::b::pan, -1.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::oscillator::a::phase, 0.0f, 1.0f, RateClass::smoothedControl, Smoothing::callerRamp, false },
        Metadata { params::oscillator::b::phase, 0.0f, 1.0f, RateClass::smoothedControl, Smoothing::callerRamp, false },
        Metadata { params::unison::detune, 0.0f, 100.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::unison::spread, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, true },
        Metadata { params::lfo::rate1, 0.01f, 50.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, false },
        Metadata { params::lfo::depth1, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, false },
        Metadata { params::modulation::sourceMacro1, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, false },
        Metadata { params::modulation::sourceMacro2, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, false },
        Metadata { params::modulation::sourceMacro3, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, false },
        Metadata { params::modulation::sourceMacro4, 0.0f, 1.0f, RateClass::sampleAccurateControl, Smoothing::callerRamp, false },
    };

    inline constexpr const Metadata* metadataAt(size_t index) noexcept
    {
        return index < realtimeVoiceParameters.size() ? &realtimeVoiceParameters[index] : nullptr;
    }

    inline constexpr int indexForStableId(std::string_view stableId) noexcept
    {
        for (size_t index = 0; index < realtimeVoiceParameters.size(); ++index)
            if (realtimeVoiceParameters[index].stableId == stableId)
                return (int) index;
        return -1;
    }

    inline constexpr const Metadata* metadataFor(std::string_view stableId) noexcept
    {
        const int index = indexForStableId(stableId);
        return index >= 0 ? metadataAt((size_t) index) : nullptr;
    }

    inline constexpr bool hasUniqueStableIds() noexcept
    {
        for (size_t a = 0; a < realtimeVoiceParameters.size(); ++a)
            for (size_t b = a + 1; b < realtimeVoiceParameters.size(); ++b)
                if (realtimeVoiceParameters[a].stableId == realtimeVoiceParameters[b].stableId)
                    return false;
        return true;
    }

    inline constexpr int rampLengthFor(size_t index, int requestedSamples) noexcept
    {
        const auto* metadata = metadataAt(index);
        if (metadata == nullptr || metadata->smoothing == Smoothing::none)
            return 0;
        return requestedSamples > 0 ? requestedSamples : 0;
    }
}
