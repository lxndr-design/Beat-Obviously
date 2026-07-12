#pragma once

#include "Wavetable.h"
#include "../AudioQuality.h"

namespace beat
{
    class WavetableOscillator
    {
    public:
        void prepare(double newSampleRate) noexcept;
        void reset(double newPhase = 0.0) noexcept;
        void setWavetable(const Wavetable* newTable) noexcept;
        void setFrequency(double newFrequencyHz) noexcept;
        void setPosition(float newPosition) noexcept;
        void setPhase(double newPhase) noexcept;
        void setQuality(AudioQuality newQuality) noexcept { quality = newQuality; }

        double getPhase() const noexcept { return phase; }
        double getPhaseIncrement() const noexcept { return phaseDelta; }
        double getFrequency() const noexcept { return frequencyHz; }
        float getPosition() const noexcept { return position; }

        float renderSample() noexcept;
        bool isTableTransitionActive() const noexcept { return tableTransitionRemaining > 0; }

    private:
        struct PlaybackCache
        {
            bool dirty { true };
            int frameSize { 0 };
            const float* frame0Mip0Data { nullptr };
            const float* frame1Mip0Data { nullptr };
            const float* frame0Mip1Data { nullptr };
            const float* frame1Mip1Data { nullptr };
            float frameFrac { 0.0f };
            float mipFrac { 0.0f };
        };

        void markFrameCacheDirty() noexcept { currentCache.dirty = true; previousCache.dirty = true; }
        void updateFrameCache(const Wavetable* source, PlaybackCache& cache) noexcept;
        float readCurrentSample(const Wavetable* source, PlaybackCache& cache) noexcept;

        const Wavetable* table { nullptr };
        const Wavetable* previousTable { nullptr };
        double sampleRate { 44100.0 };
        double frequencyHz { 440.0 };
        double phase { 0.0 };
        double phaseDelta { 440.0 / 44100.0 };
        float position { 0.0f };
        PlaybackCache currentCache;
        PlaybackCache previousCache;
        int tableTransitionLength { 220 };
        int tableTransitionRemaining { 0 };
        AudioQuality quality { AudioQuality::standardLive };
    };
}
