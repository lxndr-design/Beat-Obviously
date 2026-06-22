#pragma once

#include "../Parameters/ParameterIds.h"

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
