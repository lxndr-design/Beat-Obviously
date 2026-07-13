#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>

namespace beat::RenderBudgets
{
    inline constexpr size_t realtimeQueueEvents = 1024;
    inline constexpr int realtimeEventsDrainedPerBlock = 256;
    inline constexpr size_t blockParameterEvents = 2048;
    inline constexpr size_t blockRouteEvents = 1024;
    inline constexpr size_t pendingNoteOffs = 256;
    inline constexpr size_t instrumentRoutes = 64;
    inline constexpr size_t activeSampleVoices = 192;
    inline constexpr size_t activeAudioClipVoices = 256;

    // Voice DSP uses fixed-size source/stage arrays. These ceilings describe the
    // maximum callback work those arrays can legally produce per rendered voice
    // sample; exceeding one is an invariant violation, not a quality-degradation
    // trigger. Keeping the response telemetry-only preserves deterministic audio.
    inline constexpr int64_t modulationEvaluationsPerVoiceSample = 16;
    inline constexpr int64_t nonlinearEvaluationsPerVoiceSample = 33;

    constexpr int64_t saturatingProduct(int64_t left, int64_t right) noexcept
    {
        if (left <= 0 || right <= 0)
            return 0;
        if (left > std::numeric_limits<int64_t>::max() / right)
            return std::numeric_limits<int64_t>::max();
        return left * right;
    }

    constexpr int64_t voiceModulationWorkCeiling(int64_t voiceSamples) noexcept
    {
        return saturatingProduct(voiceSamples, modulationEvaluationsPerVoiceSample);
    }

    constexpr int64_t voiceNonlinearWorkCeiling(int64_t voiceSamples) noexcept
    {
        return saturatingProduct(voiceSamples, nonlinearEvaluationsPerVoiceSample);
    }

    constexpr bool exceedsVoiceModulationWorkCeiling(int64_t work, int64_t voiceSamples) noexcept
    {
        return work < 0 || work > voiceModulationWorkCeiling(voiceSamples);
    }

    constexpr bool exceedsVoiceNonlinearWorkCeiling(int64_t work, int64_t voiceSamples) noexcept
    {
        return work < 0 || work > voiceNonlinearWorkCeiling(voiceSamples);
    }
}
