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
        OscAPhase,
        OscBPhase,
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
            case Id::OscAPhase:
            case Id::OscBPhase:
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

    template <typename Params>
    inline float initialValueFor(const Params& params, Id param) noexcept
    {
        switch (param)
        {
            case Id::FilterCutoff: return params.cutoff01;
            case Id::FilterResonance: return params.resonance01;
            case Id::FilterDrive: return params.drive01;
            case Id::AmpLevel: return params.ampLevel;
            case Id::AmpPan: return params.ampPan;
            case Id::OscAPosition: return params.aetherOscA.wavetable.position;
            case Id::OscBPosition: return params.aetherOscB.wavetable.position;
            case Id::OscAFine: return params.aetherOscA.fineCents;
            case Id::OscBFine: return params.aetherOscB.fineCents;
            case Id::OscALevel: return params.aetherOscA.level;
            case Id::OscBLevel: return params.aetherOscB.level;
            case Id::OscAPan: return params.aetherOscA.pan;
            case Id::OscBPan: return params.aetherOscB.pan;
            case Id::OscAPhase: return params.aetherOscA.phase;
            case Id::OscBPhase: return params.aetherOscB.phase;
            case Id::UnisonDetune: return params.wavetableDetuneCents;
            case Id::UnisonSpread: return params.wavetableBlend;
            case Id::LfoRate: return params.lfoRateHz;
            case Id::LfoDepth: return params.lfoDepth;
            case Id::Count:
                break;
        }
        return 0.0f;
    }

    template <typename Params>
    inline void applyValue(Params& target, Id param, float value) noexcept
    {
        const float clamped = clampValue(param, value);
        switch (param)
        {
            case Id::FilterCutoff:
                target.cutoff01 = clamped;
                break;
            case Id::FilterResonance:
                target.resonance01 = clamped;
                break;
            case Id::FilterDrive:
                target.drive01 = clamped;
                break;
            case Id::AmpLevel:
                target.ampLevel = clamped;
                break;
            case Id::AmpPan:
                target.ampPan = clamped;
                break;
            case Id::OscAPosition:
                target.wavetablePosition = clamped;
                target.wavetable.position = target.wavetablePosition;
                target.aetherOscA.wavetable.position = target.wavetablePosition;
                break;
            case Id::OscBPosition:
                target.aetherOscB.wavetable.position = clamped;
                break;
            case Id::OscAFine:
                target.aetherOscA.fineCents = clamped;
                break;
            case Id::OscBFine:
                target.aetherOscB.fineCents = clamped;
                break;
            case Id::OscALevel:
                target.aetherOscA.level = clamped;
                break;
            case Id::OscBLevel:
                target.aetherOscB.level = clamped;
                break;
            case Id::OscAPan:
                target.aetherOscA.pan = clamped;
                break;
            case Id::OscBPan:
                target.aetherOscB.pan = clamped;
                break;
            case Id::OscAPhase:
                target.aetherOscA.phase = clamped;
                break;
            case Id::OscBPhase:
                target.aetherOscB.phase = clamped;
                break;
            case Id::UnisonDetune:
                target.wavetableDetuneCents = clamped;
                target.wavetable.detuneCents = target.wavetableDetuneCents;
                target.aetherOscA.wavetable.detuneCents = target.wavetableDetuneCents;
                target.aetherOscB.wavetable.detuneCents = target.wavetableDetuneCents;
                break;
            case Id::UnisonSpread:
                target.wavetableBlend = clamped;
                target.wavetable.blend = target.wavetableBlend;
                target.aetherOscA.wavetable.blend = target.wavetableBlend;
                target.aetherOscB.wavetable.blend = target.wavetableBlend;
                break;
            case Id::LfoRate:
                target.lfoRateHz = clamped;
                break;
            case Id::LfoDepth:
                target.lfoDepth = clamped;
                break;
            case Id::Count:
                break;
        }
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
        if (parameterId == params::oscillator::a::phase) return (int) Id::OscAPhase;
        if (parameterId == params::oscillator::b::phase) return (int) Id::OscBPhase;
        if (parameterId == params::unison::detune) return (int) Id::UnisonDetune;
        if (parameterId == params::unison::spread) return (int) Id::UnisonSpread;
        if (parameterId == "lfo.1.rate") return (int) Id::LfoRate;
        if (parameterId == "lfo.1.depth") return (int) Id::LfoDepth;
        return -1;
    }
}
