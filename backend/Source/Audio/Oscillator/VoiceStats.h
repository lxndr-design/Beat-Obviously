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

    inline void add(RenderWork& target, const RenderWork& delta) noexcept
    {
        target.voiceBlocks += delta.voiceBlocks;
        target.voiceSamples += delta.voiceSamples;
        target.oscillatorSamples += delta.oscillatorSamples;
        target.wavetableVoiceSamples += delta.wavetableVoiceSamples;
        target.aetherOscASamples += delta.aetherOscASamples;
        target.aetherOscBSamples += delta.aetherOscBSamples;
        target.aetherSubSamples += delta.aetherSubSamples;
        target.aetherNoiseSamples += delta.aetherNoiseSamples;
        target.filterSamples += delta.filterSamples;
        target.filterDriveSamples += delta.filterDriveSamples;
        target.filterCoefficientUpdates += delta.filterCoefficientUpdates;
        target.filterCutoffUpdates += delta.filterCutoffUpdates;
        target.filterResonanceUpdates += delta.filterResonanceUpdates;
        target.modulationSamples += delta.modulationSamples;
        target.realtimeRampSamples += delta.realtimeRampSamples;
        target.oscillatorRateCalculations += delta.oscillatorRateCalculations;
        target.wavetableFrequencyUpdates += delta.wavetableFrequencyUpdates;
        target.wavetablePositionUpdates += delta.wavetablePositionUpdates;
    }

    struct RenderWorkBlock
    {
        RenderWork work {};

        void begin(int numSamples, int filterChannels) noexcept
        {
            work = {};
            work.voiceBlocks = 1;
            work.voiceSamples = numSamples;
            work.filterSamples = (int64_t) numSamples * filterChannels;
        }

        void add(const RenderWork& delta) noexcept
        {
            VoiceStats::add(work, delta);
        }

        void addOscillatorSamples(int64_t samples) noexcept
        {
            work.oscillatorSamples += samples;
        }

        void addWavetableRender(int64_t voiceSamples, int64_t frequencyUpdates, int64_t positionUpdates) noexcept
        {
            work.wavetableVoiceSamples += voiceSamples;
            work.wavetableFrequencyUpdates += frequencyUpdates;
            work.wavetablePositionUpdates += positionUpdates;
        }

        void addFilterDriveSamples(int64_t samples) noexcept
        {
            work.filterDriveSamples += samples;
        }

        void addFilterCutoffUpdates(int64_t updates) noexcept
        {
            work.filterCutoffUpdates += updates;
            work.filterCoefficientUpdates += updates;
        }

        void addFilterResonanceUpdates(int64_t updates) noexcept
        {
            work.filterResonanceUpdates += updates;
            work.filterCoefficientUpdates += updates;
        }

        void addModulationSamples(int64_t samples) noexcept
        {
            work.modulationSamples += samples;
        }

        void addRealtimeRampSamples(int64_t samples) noexcept
        {
            work.realtimeRampSamples += samples;
        }

        const RenderWork& snapshot() const noexcept
        {
            return work;
        }
    };
}
