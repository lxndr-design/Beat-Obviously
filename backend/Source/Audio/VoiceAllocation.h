#pragma once

#include <juce_core/juce_core.h>

namespace beat::VoiceAllocation
{
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
