#pragma once

#include <juce_core/juce_core.h>

#include <cmath>
#include <cstdint>

namespace beat::VoiceAllocation
{
    struct VictimState
    {
        bool released { false };
        float currentLevel { 0.0f };
        uint64_t age { 0 };
        int stableVoiceId { 0 };
    };

    inline bool preferVictim(const VictimState& candidate, const VictimState& current) noexcept
    {
        if (candidate.released != current.released)
            return candidate.released;
        if (std::abs(candidate.currentLevel - current.currentLevel) > 1.0e-7f)
            return candidate.currentLevel < current.currentLevel;
        if (candidate.age != current.age)
            return candidate.age < current.age;
        return candidate.stableVoiceId < current.stableVoiceId;
    }

    struct Policy
    {
        int voiceCount { 1 };
        bool mono { false };
        bool legato { false };
        bool noteStealing { true };
    };

    inline Policy policyFor(int requestedVoices, bool mono, bool legato) noexcept
    {
        Policy policy;
        policy.mono = mono;
        policy.legato = mono && legato;
        policy.voiceCount = mono ? 1 : juce::jlimit(1, 32, requestedVoices);
        policy.noteStealing = true;
        return policy;
    }
}
