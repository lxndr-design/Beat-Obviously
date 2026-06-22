#pragma once

#include <cstdint>

namespace beat::VoiceStats
{
    struct WavetableCache
    {
        int64_t hits { 0 };
        int64_t misses { 0 };
        int size { 0 };
    };

    struct RenderWork
    {
        int64_t voiceBlocks { 0 };
        int64_t voiceSamples { 0 };
        int64_t oscillatorSamples { 0 };
        int64_t wavetableVoiceSamples { 0 };
        int64_t aetherOscASamples { 0 };
        int64_t aetherOscBSamples { 0 };
        int64_t aetherSubSamples { 0 };
        int64_t aetherNoiseSamples { 0 };
        int64_t filterSamples { 0 };
        int64_t filterDriveSamples { 0 };
        int64_t filterCoefficientUpdates { 0 };
        int64_t filterCutoffUpdates { 0 };
        int64_t filterResonanceUpdates { 0 };
        int64_t modulationSamples { 0 };
        int64_t realtimeRampSamples { 0 };
        int64_t oscillatorRateCalculations { 0 };
        int64_t wavetableFrequencyUpdates { 0 };
        int64_t wavetablePositionUpdates { 0 };
    };
}
