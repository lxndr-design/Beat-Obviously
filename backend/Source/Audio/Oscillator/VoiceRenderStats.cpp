#include "VoiceRenderStats.h"

#include <atomic>

namespace beat::VoiceRenderStats
{
    namespace
    {
        std::atomic<int64_t> renderVoiceBlocks { 0 };
        std::atomic<int64_t> renderVoiceSamples { 0 };
        std::atomic<int64_t> renderOscillatorSamples { 0 };
        std::atomic<int64_t> renderWavetableVoiceSamples { 0 };
        std::atomic<int64_t> renderAetherOscASamples { 0 };
        std::atomic<int64_t> renderAetherOscBSamples { 0 };
        std::atomic<int64_t> renderAetherSubSamples { 0 };
        std::atomic<int64_t> renderAetherNoiseSamples { 0 };
        std::atomic<int64_t> renderFilterSamples { 0 };
        std::atomic<int64_t> renderFilterDriveSamples { 0 };
        std::atomic<int64_t> renderNonlinearSamples { 0 };
        std::atomic<int64_t> renderFilterCoefficientUpdates { 0 };
        std::atomic<int64_t> renderFilterCutoffUpdates { 0 };
        std::atomic<int64_t> renderFilterResonanceUpdates { 0 };
        std::atomic<int64_t> renderModulationSamples { 0 };
        std::atomic<int64_t> renderRealtimeRampSamples { 0 };
        std::atomic<int64_t> renderOscillatorRateCalculations { 0 };
        std::atomic<int64_t> renderWavetableFrequencyUpdates { 0 };
        std::atomic<int64_t> renderWavetablePositionUpdates { 0 };
    }

    void recordBlock(const VoiceStats::RenderWork& stats) noexcept
    {
        renderVoiceBlocks.fetch_add(stats.voiceBlocks, std::memory_order_relaxed);
        renderVoiceSamples.fetch_add(stats.voiceSamples, std::memory_order_relaxed);
        renderOscillatorSamples.fetch_add(stats.oscillatorSamples, std::memory_order_relaxed);
        renderWavetableVoiceSamples.fetch_add(stats.wavetableVoiceSamples, std::memory_order_relaxed);
        renderAetherOscASamples.fetch_add(stats.aetherOscASamples, std::memory_order_relaxed);
        renderAetherOscBSamples.fetch_add(stats.aetherOscBSamples, std::memory_order_relaxed);
        renderAetherSubSamples.fetch_add(stats.aetherSubSamples, std::memory_order_relaxed);
        renderAetherNoiseSamples.fetch_add(stats.aetherNoiseSamples, std::memory_order_relaxed);
        renderFilterSamples.fetch_add(stats.filterSamples, std::memory_order_relaxed);
        renderFilterDriveSamples.fetch_add(stats.filterDriveSamples, std::memory_order_relaxed);
        renderNonlinearSamples.fetch_add(stats.nonlinearSamples, std::memory_order_relaxed);
        renderFilterCoefficientUpdates.fetch_add(stats.filterCoefficientUpdates, std::memory_order_relaxed);
        renderFilterCutoffUpdates.fetch_add(stats.filterCutoffUpdates, std::memory_order_relaxed);
        renderFilterResonanceUpdates.fetch_add(stats.filterResonanceUpdates, std::memory_order_relaxed);
        renderModulationSamples.fetch_add(stats.modulationSamples, std::memory_order_relaxed);
        renderRealtimeRampSamples.fetch_add(stats.realtimeRampSamples, std::memory_order_relaxed);
        renderOscillatorRateCalculations.fetch_add(stats.oscillatorRateCalculations, std::memory_order_relaxed);
        renderWavetableFrequencyUpdates.fetch_add(stats.wavetableFrequencyUpdates, std::memory_order_relaxed);
        renderWavetablePositionUpdates.fetch_add(stats.wavetablePositionUpdates, std::memory_order_relaxed);
    }

    VoiceStats::RenderWork consume() noexcept
    {
        return {
            renderVoiceBlocks.exchange(0, std::memory_order_relaxed),
            renderVoiceSamples.exchange(0, std::memory_order_relaxed),
            renderOscillatorSamples.exchange(0, std::memory_order_relaxed),
            renderWavetableVoiceSamples.exchange(0, std::memory_order_relaxed),
            renderAetherOscASamples.exchange(0, std::memory_order_relaxed),
            renderAetherOscBSamples.exchange(0, std::memory_order_relaxed),
            renderAetherSubSamples.exchange(0, std::memory_order_relaxed),
            renderAetherNoiseSamples.exchange(0, std::memory_order_relaxed),
            renderFilterSamples.exchange(0, std::memory_order_relaxed),
            renderFilterDriveSamples.exchange(0, std::memory_order_relaxed),
            renderNonlinearSamples.exchange(0, std::memory_order_relaxed),
            renderFilterCoefficientUpdates.exchange(0, std::memory_order_relaxed),
            renderFilterCutoffUpdates.exchange(0, std::memory_order_relaxed),
            renderFilterResonanceUpdates.exchange(0, std::memory_order_relaxed),
            renderModulationSamples.exchange(0, std::memory_order_relaxed),
            renderRealtimeRampSamples.exchange(0, std::memory_order_relaxed),
            renderOscillatorRateCalculations.exchange(0, std::memory_order_relaxed),
            renderWavetableFrequencyUpdates.exchange(0, std::memory_order_relaxed),
            renderWavetablePositionUpdates.exchange(0, std::memory_order_relaxed),
        };
    }
}
