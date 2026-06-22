#pragma once

#include "RealtimeParameterQueue.h"

#include <array>
#include <cstddef>

namespace beat::VoiceNoteAutomation
{
    inline constexpr size_t maxEvents = 128;
    inline constexpr size_t maxPendingContexts = 64;

    struct PitchEvent
    {
        int sampleOffset { 0 };
        float frequencyHz { 440.0f };
        int rampSamples { 0 };
    };

    struct Context
    {
        int midiNoteNumber { -1 };
        int eventCount { 0 };
        std::array<RealtimeParameterChange, maxEvents> events {};
        int pitchEventCount { 0 };
        std::array<PitchEvent, maxEvents> pitchEvents {};
    };
}
