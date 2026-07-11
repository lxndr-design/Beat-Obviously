#pragma once

#include "Wavetable.h"

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

        double getPhase() const noexcept { return phase; }
        double getPhaseIncrement() const noexcept { return phaseDelta; }
        double getFrequency() const noexcept { return frequencyHz; }
        float getPosition() const noexcept { return position; }

        float renderSample() noexcept;

    private:
        void markFrameCacheDirty() noexcept { frameCacheDirty = true; }
        void updateFrameCache() noexcept;
        float readCurrentSample() noexcept;

        const Wavetable* table { nullptr };
        double sampleRate { 44100.0 };
        double frequencyHz { 440.0 };
        double phase { 0.0 };
        double phaseDelta { 440.0 / 44100.0 };
        float position { 0.0f };
        bool frameCacheDirty { true };
        int cachedFrameSize { 0 };
        const float* cachedFrame0Data { nullptr };
        const float* cachedFrame1Data { nullptr };
        float cachedFrameFrac { 0.0f };
    };
}
