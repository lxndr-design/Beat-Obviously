#pragma once

#include "../Parameters/ParameterIds.h"
#include "../Parameters/ParameterPolicy.h"

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
        Macro1,
        Macro2,
        Macro3,
        Macro4,
        Macro5,
        Macro6,
        Macro7,
        Macro8,
        Count,
    };

    inline constexpr size_t count = (size_t) Id::Count;
    static_assert(count == ParameterPolicy::realtimeVoiceParameters.size());
    static_assert(ParameterPolicy::hasUniqueStableIds());

    inline bool isValid(Id param) noexcept
    {
        return param != Id::Count;
    }

    inline float clampValue(Id param, float value) noexcept
    {
        if (const auto* metadata = ParameterPolicy::metadataAt((size_t) param))
            return juce::jlimit(metadata->minimum, metadata->maximum, value);
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
            case Id::Macro1: return params.macroValues[0];
            case Id::Macro2: return params.macroValues[1];
            case Id::Macro3: return params.macroValues[2];
            case Id::Macro4: return params.macroValues[3];
            case Id::Macro5: return params.macroValues[4];
            case Id::Macro6: return params.macroValues[5];
            case Id::Macro7: return params.macroValues[6];
            case Id::Macro8: return params.macroValues[7];
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
            case Id::Macro1:
                target.macroValues[0] = clamped;
                break;
            case Id::Macro2:
                target.macroValues[1] = clamped;
                break;
            case Id::Macro3:
                target.macroValues[2] = clamped;
                break;
            case Id::Macro4:
                target.macroValues[3] = clamped;
                break;
            case Id::Macro5:
                target.macroValues[4] = clamped;
                break;
            case Id::Macro6:
                target.macroValues[5] = clamped;
                break;
            case Id::Macro7:
                target.macroValues[6] = clamped;
                break;
            case Id::Macro8:
                target.macroValues[7] = clamped;
                break;
            case Id::Count:
                break;
        }
    }

    inline int indexForParameterId(std::string_view parameterId) noexcept
    {
        return ParameterPolicy::indexForStableId(parameterId);
    }
}
