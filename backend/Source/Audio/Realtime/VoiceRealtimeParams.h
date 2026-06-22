#pragma once

#include "../Parameters/ParameterIds.h"

#include <juce_core/juce_core.h>

#include <cstddef>
#include <string_view>

namespace beat::VoiceRealtimeParams
{
    enum class Id : size_t
    {
        FilterCutoff,
        FilterResonance,
        FilterDrive,
        AmpLevel,
        AmpPan,
        OscAPosition,
        OscBPosition,
        OscAFine,
        OscBFine,
        OscALevel,
        OscBLevel,
        OscAPan,
        OscBPan,
        UnisonDetune,
        UnisonSpread,
        LfoRate,
        LfoDepth,
        Count,
    };

    inline constexpr size_t count = (size_t) Id::Count;

    inline bool isValid(Id param) noexcept
    {
        return param != Id::Count;
    }

    inline float clampValue(Id param, float value) noexcept
    {
        switch (param)
        {
            case Id::FilterCutoff:
            case Id::FilterResonance:
            case Id::FilterDrive:
            case Id::AmpLevel:
            case Id::OscAPosition:
            case Id::OscBPosition:
            case Id::OscALevel:
            case Id::OscBLevel:
            case Id::UnisonSpread:
            case Id::LfoDepth:
                return juce::jlimit(0.0f, 1.0f, value);
            case Id::AmpPan:
            case Id::OscAPan:
            case Id::OscBPan:
                return juce::jlimit(-1.0f, 1.0f, value);
            case Id::OscAFine:
            case Id::OscBFine:
                return juce::jlimit(-100.0f, 100.0f, value);
            case Id::UnisonDetune:
                return juce::jlimit(0.0f, 100.0f, value);
            case Id::LfoRate:
                return juce::jlimit(0.01f, 50.0f, value);
            case Id::Count:
                break;
        }
        return value;
    }

    inline int indexForParameterId(std::string_view parameterId) noexcept
    {
        if (parameterId == params::filter::cutoff) return (int) Id::FilterCutoff;
        if (parameterId == params::filter::resonance) return (int) Id::FilterResonance;
        if (parameterId == params::filter::drive) return (int) Id::FilterDrive;
        if (parameterId == params::amp::level) return (int) Id::AmpLevel;
        if (parameterId == params::amp::pan) return (int) Id::AmpPan;
        if (parameterId == params::oscillator::a::position) return (int) Id::OscAPosition;
        if (parameterId == params::oscillator::b::position) return (int) Id::OscBPosition;
        if (parameterId == params::oscillator::a::fine) return (int) Id::OscAFine;
        if (parameterId == params::oscillator::b::fine) return (int) Id::OscBFine;
        if (parameterId == params::oscillator::a::level) return (int) Id::OscALevel;
        if (parameterId == params::oscillator::b::level) return (int) Id::OscBLevel;
        if (parameterId == params::oscillator::a::pan) return (int) Id::OscAPan;
        if (parameterId == params::oscillator::b::pan) return (int) Id::OscBPan;
        if (parameterId == params::unison::detune) return (int) Id::UnisonDetune;
        if (parameterId == params::unison::spread) return (int) Id::UnisonSpread;
        if (parameterId == "lfo.1.rate") return (int) Id::LfoRate;
        if (parameterId == "lfo.1.depth") return (int) Id::LfoDepth;
        return -1;
    }
}
